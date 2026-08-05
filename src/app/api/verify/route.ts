import { NextRequest, NextResponse, after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  sendFraudAlert,
  sendStudentVerificationNotification,
} from "@/lib/resend";
import { sendVerificationDigestIfDue } from "@/lib/digests";
import { isTurnstileEnabled, verifyTurnstileToken } from "@/lib/turnstile";
import { analyzeBotRisk } from "@/lib/bot-detection";
import { resolveActiveReleve, toPublicReleve } from "@/lib/releves";
import type { Database } from "@/lib/types/database";
import crypto from "crypto";

// ─── Configuration rate limiting ─────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_BLOCK_MS = 300_000; // 5 minutes

// ─── Configuration détection automatisation / scraping ──────
// Blocage court (même durée que le rate limit) : un bot détecté est déjà
// refusé à chaque requête ; un blocage long punirait à tort les visiteurs
// légitimes derrière une IP partagée (NAT, campus, proxy d'entreprise).
const BOT_BLOCK_MS = 300_000; // 5 minutes
const BOT_ATTEMPT_COUNT = 99; // compteur arbitraire (> seuil) pour la ligne de blocage

// ─── Configuration détection fraude ──────────────────────────
const FRAUD_THRESHOLD = 5; // tentatives échouées sur un même identifiant
const FRAUD_WINDOW_MS = 15 * 60_000; // fenêtre de détection : 15 min
const FRAUD_COOLDOWN_MS = 24 * 60 * 60_000; // 1 alerte max / identifiant / 24 h

/**
 * Hash une adresse IP (RGPD).
 */
function hashIP(ip: string): string {
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

/**
 * Vérifie et met à jour le rate limiting pour une IP.
 *
 * Logique :
 * - On récupère la dernière ligne pour cette IP/endpoint (sans filtre
 *   de fenêtre, pour que le blocage de 5 min reste visible après 1 min).
 * - Si bloqué_until est dans le futur → refus.
 * - Sinon on compte les tentatives dans la fenêtre de 1 min (window_start).
 * - Au 5e essai dans la fenêtre → blocage 5 min.
 */
async function checkRateLimit(
  supabase: SupabaseClient<Database>,
  ipHash: string
): Promise<{ allowed: boolean }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS);

  const rateLimitTable = supabase.from("rate_limits");
  const { data: recentAttempts } = await rateLimitTable
    .select("attempt_count, blocked_until, window_start")
    .eq("ip_address", ipHash)
    .eq("endpoint", "/api/verify")
    .order("window_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Vérifier si bloqué (indépendant de la fenêtre de 1 min)
  if (recentAttempts?.blocked_until) {
    const blockedUntil = new Date(recentAttempts.blocked_until);
    if (blockedUntil > now) {
      return { allowed: false };
    }
  }

  // La tentative précédente est-elle dans la fenêtre de 1 min ?
  const inWindow =
    recentAttempts?.window_start &&
    new Date(recentAttempts.window_start) >= windowStart;

  const newCount = (inWindow ? (recentAttempts?.attempt_count ?? 0) : 0) + 1;

  if (newCount >= RATE_LIMIT_MAX_ATTEMPTS) {
    const blockedUntil = new Date(
      now.getTime() + RATE_LIMIT_BLOCK_MS
    ).toISOString();

    // Mettre à jour la ligne existante (pas de doublon) ou en créer une
    if (recentAttempts) {
      await rateLimitTable
        .update({
          attempt_count: newCount,
          window_start: now.toISOString(),
          blocked_until: blockedUntil,
        })
        .eq("ip_address", ipHash)
        .eq("endpoint", "/api/verify");
    } else {
      await rateLimitTable.insert({
        ip_address: ipHash,
        endpoint: "/api/verify",
        attempt_count: newCount,
        window_start: now.toISOString(),
        blocked_until: blockedUntil,
      });
    }

    return { allowed: false };
  }

  // Une ligne existe (même hors fenêtre) → la mettre à jour pour éviter
  // les doublons (window_start à now + compteur réinitialisé si hors fenêtre)
  if (recentAttempts) {
    await rateLimitTable
      .update({
        attempt_count: newCount,
        window_start: now.toISOString(),
        blocked_until: null,
      })
      .eq("ip_address", ipHash)
      .eq("endpoint", "/api/verify");
  } else {
    // Première tentative → insérer
    await rateLimitTable.insert({
      ip_address: ipHash,
      endpoint: "/api/verify",
      attempt_count: newCount,
      window_start: now.toISOString(),
      blocked_until: null,
    });
  }

  return { allowed: true };
}

/**
 * Log une vérification dans la base.
 */
async function logVerification(
  supabase: SupabaseClient<Database>,
  params: {
    releve_id: string | null;
    attempted_id?: string;
    ip_address: string;
    user_agent: string;
    result: "success" | "failed";
    error_type: string;
    /** Signaux de détection d'automatisation (journalisation enrichie) */
    signals?: string[];
  },
  /** Identifiant pré-généré (utile pour récupérer l'ID sans relecture) */
  id?: string
): Promise<string | null> {
  // NB: pas de `.select("id")` exploitable ici — la RLS autorise le public à
  // INSÉRER une vérification mais pas à la RELIRE ; un select retomberait à
  // null. On passe donc l'identifiant pré-généré quand il est nécessaire.
  await supabase.from("verifications").insert({
    // NB: spread conditionnel — le type Insert de la table n'a pas de champ
    // `id` (généré côté base) ; on ne l'ajoute que s'il est pré-fourni.
    ...(id ? { id } : {}),
    releve_id: params.releve_id,
    attempted_id: params.attempted_id ?? "",
    ip_address: params.ip_address,
    user_agent: params.user_agent,
    result: params.result,
    error_type: params.error_type,
    signals: params.signals ?? [],
  });
  return id ?? null;
}

/**
 * Détecte un comportement anormal : trop d'échecs sur un même
 * identifiant dans la fenêtre de détection. Si le seuil est atteint
 * et qu'aucune alerte n'a été envoyée pour cet identifiant dans les
 * 24 dernières heures → envoi d'un email à la scolarité/DSI.
 *
 * Robuste : tout échec est silencieux (jamais bloquant pour la route).
 */
async function detectFraudAndAlert(
  identifier: string,
  ipHash: string
): Promise<void> {
  try {
    const adminSupabase = await createAdminClient();
    const since = new Date(Date.now() - FRAUD_WINDOW_MS).toISOString();

    // Compter les échecs sur cet identifiant dans la fenêtre.
    // NB: on exclut les échecs captcha_failed — un bot rejeté par le CAPTCHA
    // ne doit pas faire gonfler le compteur de fraude (ce rôle revient au
    // CAPTCHA lui-même), sinon une fausse alerte serait envoyée.
    const { count } = await adminSupabase
      .from("verifications")
      .select("id", { count: "exact", head: true })
      .eq("attempted_id", identifier)
      .eq("result", "failed")
      .neq("error_type", "captcha_failed")
      .neq("error_type", "bot_detected")
      // NB: un document verrouillé échoue toujours par définition — des
      // tentatives répétées dessus (étudiants curieux) ne sont pas de la
      // fraude, seulement du bruit.
      .neq("error_type", "locked")
      .gte("timestamp", since);

    if (!count || count < FRAUD_THRESHOLD) return;

    // Cooldown : pas plus d'une alerte par identifiant toutes les 24 h
    const cooldownSince = new Date(
      Date.now() - FRAUD_COOLDOWN_MS
    ).toISOString();
    const { data: existing } = await adminSupabase
      .from("fraud_alerts")
      .select("id")
      .eq("identifier", identifier)
      .gte("alerted_at", cooldownSince)
      .maybeSingle();

    if (existing) return;

    await sendFraudAlert({
      identifier,
      ipAddress: ipHash,
      attemptCount: count,
      timeWindowMs: FRAUD_WINDOW_MS,
    });

    await adminSupabase.from("fraud_alerts").insert({
      identifier,
      attempt_count: count,
      ip_address: ipHash,
    });
  } catch (error) {
    // Ne jamais casser la vérification à cause d'un problème d'alerte
    console.error("[fraud] Échec détection/alerte :", error);
  }
}

/**
 * POST /api/verify
 * Vérifie un identifiant de relevé et enregistre la tentative.
 * Protégé par rate limiting.
 * Ajoute un délai fixe pour éviter les timing attacks.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const supabase = await createClient();

    // ── Récapitulatif quotidien (admin) ────────────────────
    // Planifié pour TOUTES les tentatives, réussies comme échouées : une
    // journée d'attaque sans aucun succès doit quand même être signalée à
    // l'administration. Le garde 24 h (table email_digests) évite les
    // doublons ; exécution post-réponse via after() (jamais bloquant).
    after(async () => {
      const adminSupabase = await createAdminClient().catch(() => null);
      if (adminSupabase) {
        await sendVerificationDigestIfDue(adminSupabase, new Date());
      }
    });

    // ── CAPTCHA anti-robot (Turnstile) ─────────────────────
    // Désactivé en dev (pas de clés) ; en prod, un jeton valide est requis
    // AVANT le rate limiting : les robots rejetés ne consomment pas de quota.
    const body = await request.json().catch(() => ({}));
    const { id, turnstileToken, clientSignals } = body as {
      id?: string;
      turnstileToken?: string;
      clientSignals?: unknown;
    };

    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    const ipHash = hashIP(ip);

    // ── Détection d'outils d'automatisation / scraping ─────
    // Défense en profondeur : Turnstile gère les robots « visibles », cette
    // couche repère les appels scriptés (headless, webdriver, UA scraper,
    // payload client absent). Un bot détecté est journalisé et son IP bloquée
    // pendant 1 h (rate_limits) — les tentatives suivantes seront refusées.
    const botRisk = analyzeBotRisk(
      request.headers.get("user-agent") ?? "",
      clientSignals
    );
    if (botRisk.blocked) {
      // Observabilité : journal serveur des signaux qui ont déclenché le refus
      // (utile pour régler la précision du détecteur sans toucher la base).
      console.warn("[bot-detection] Refusé :", botRisk.signals, { ipHash });

      await logVerification(supabase, {
        releve_id: null,
        attempted_id: typeof id === "string" ? id : "",
        ip_address: ipHash,
        user_agent: request.headers.get("user-agent") ?? "",
        result: "failed",
        error_type: "bot_detected",
        signals: botRisk.signals,
      });

      await blockIp(supabase, ipHash);

      await delay(Math.max(0, 200 - (Date.now() - startTime)));

      return NextResponse.json(
        { success: false, error: { code: "bot_detected", message: "" } },
        { status: 403 }
      );
    }

    if (isTurnstileEnabled()) {
      const captchaOk = await verifyTurnstileToken(turnstileToken, ip);

      if (!captchaOk) {
        await logVerification(supabase, {
          releve_id: null,
          attempted_id: typeof id === "string" ? id : "",
          ip_address: ipHash,
          user_agent: request.headers.get("user-agent") ?? "",
          result: "failed",
          error_type: "captcha_failed",
          signals: botRisk.signals,
        });

        await delay(Math.max(0, 200 - (Date.now() - startTime)));

        return NextResponse.json(
          { success: false, error: { code: "captcha_failed", message: "" } },
          { status: 400 }
        );
      }
    }

    // ── Rate limiting ──────────────────────────────────────
    const { allowed } = await checkRateLimit(supabase, ipHash);
    if (!allowed) {
      await logVerification(supabase, {
        releve_id: null,
        ip_address: ipHash,
        user_agent: request.headers.get("user-agent") ?? "",
        result: "failed",
        error_type: "rate_limited",
        signals: botRisk.signals,
      });

      return NextResponse.json(
        {
          success: false,
          error: { code: "rate_limited", message: "" },
        },
        { status: 429 }
      );
    }

    if (!id || typeof id !== "string" || id.length < 8) {
      await logVerification(supabase, {
        releve_id: null,
        attempted_id: typeof id === "string" ? id : "",
        ip_address: ipHash,
        user_agent: request.headers.get("user-agent") ?? "",
        result: "failed",
        error_type: "invalid_id",
        signals: botRisk.signals,
      });

      // Ajouter un délai artificiel pour masquer les timing attacks
      await delay(Math.max(0, 200 - (Date.now() - startTime)));

      return NextResponse.json(
        { success: false, error: { code: "not_found", message: "" } },
        { status: 200 }
      );
    }

    // ── Chercher le relevé (version active) ─────────────────
    // Résolution via la chaîne de remplacement : le QR code d'une ancienne
    // version affiche la version officielle à jour. Un relevé annulé ou une
    // ancienne version à la chaîne cassée retombent dans "not_found"
    // (anti-fraude : indistinguable d'un identifiant inconnu).
    const releve = await resolveActiveReleve(supabase, id);

    if (!releve) {
      await logVerification(supabase, {
        releve_id: null,
        attempted_id: id,
        ip_address: ipHash,
        user_agent: request.headers.get("user-agent") ?? "",
        result: "failed",
        error_type: "invalid_id",
        signals: botRisk.signals,
      });

      // Détection fraude : plusieurs échecs sur le même identifiant
      await detectFraudAndAlert(id, ipHash);

      await delay(Math.max(0, 200 - (Date.now() - startTime)));

      return NextResponse.json(
        { success: false, error: { code: "not_found", message: "" } },
        { status: 200 }
      );
    }

    // ── Document verrouillé (décision d'administration) ────
    // Le verrouillage suspend temporairement la consultation (litige,
    // examen, vérification interne) SANS annuler le document. Le visiteur
    // voit un message sobre — l'existence du document est révélée (choix
    // produit), mais aucun contenu n'est exposé.
    if (releve.locked_at) {
      await logVerification(supabase, {
        releve_id: releve.id,
        attempted_id: id,
        ip_address: ipHash,
        user_agent: request.headers.get("user-agent") ?? "",
        result: "failed",
        error_type: "locked",
        signals: botRisk.signals,
      });

      await delay(Math.max(0, 200 - (Date.now() - startTime)));

      return NextResponse.json(
        { success: false, error: { code: "locked", message: "" } },
        { status: 403 }
      );
    }

    // ── Succès ─────────────────────────────────────────────
    // L'UUID est généré côté serveur (crypto.randomUUID) pour servir de
    // référence de traçabilité dans le filigrane — sans relecture RLS.
    const verificationId = crypto.randomUUID();
    await logVerification(
      supabase,
      {
        releve_id: releve.id,
        ip_address: ipHash,
        user_agent: request.headers.get("user-agent") ?? "",
        result: "success",
        error_type: "",
        signals: botRisk.signals,
      },
      verificationId
    );

    // Email étudiant post-réponse via after() — garanti en environnement
    // serverless (Vercel) alors qu'un simple `void` non-attendu serait tué au
    // freeze du runtime. Un échec d'envoi ne doit jamais affecter la réponse.
    // (Le récapitulatif admin quotidien est, lui, planifié en amont pour
    // couvrir aussi les tentatives échouées.)
    const notifParams = {
      studentName: releve.student_name,
      studentEmail: releve.student_email ?? "",
      releveId: releve.id,
      verifiedAt: new Date(),
    };
    after(async () => {
      await sendStudentVerificationNotification(notifParams);
    });

    // NB: le champ student_email est retiré de la réponse publique (RGPD) ;
    // verificationId alimente le filigrane anti-capture (traçabilité).
    return NextResponse.json({
      success: true,
      data: { releve: toPublicReleve(releve), verificationId },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "server_error", message: "" } },
      { status: 500 }
    );
  }
}

/**
 * Bloque une IP dans rate_limits (upsert de la ligne existante, ou insertion).
 * checkRateLimit refusera ensuite toute tentative tant que `blocked_until`
 * est dans le futur — même logique d'upsert que le blocage du rate limit,
 * pour garantir une seule ligne par IP/endpoint.
 */
async function blockIp(
  supabase: SupabaseClient<Database>,
  ipHash: string
): Promise<void> {
  const blockedUntil = new Date(Date.now() + BOT_BLOCK_MS).toISOString();
  const { data: existing } = await supabase
    .from("rate_limits")
    .select("id")
    .eq("ip_address", ipHash)
    .eq("endpoint", "/api/verify")
    .maybeSingle();

  if (existing) {
    await supabase
      .from("rate_limits")
      .update({
        attempt_count: BOT_ATTEMPT_COUNT,
        window_start: new Date().toISOString(),
        blocked_until: blockedUntil,
      })
      .eq("ip_address", ipHash)
      .eq("endpoint", "/api/verify");
  } else {
    await supabase.from("rate_limits").insert({
      ip_address: ipHash,
      endpoint: "/api/verify",
      attempt_count: BOT_ATTEMPT_COUNT,
      window_start: new Date().toISOString(),
      blocked_until: blockedUntil,
    });
  }
}

/**
 * Promise-based delay helper.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
