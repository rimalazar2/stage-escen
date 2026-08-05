import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types/database";
import { sendVerificationDigest } from "./resend";

/* ============================================================
   Digest quotidien — récapitulatif des vérifications pour l'admin
   ============================================================
   Réalité du terrain : une école n'a pas besoin d'un email à CHAQUE
   vérification (flot d'emails), mais d'un bilan régulier. Ce module envoie
   un récapitulatif au plus une fois toutes les 24 h, sans dépendre d'un
   cron externe : le premier événement du jour (réussi OU échoué — une
   journée d'attaque sans aucun succès doit quand même être signalée)
   déclenche l'envoi du bilan de la période écoulée. Le marqueur
   `email_digests` évite les doublons. Fonctionne en dev comme en
   production (Vercel, sans job planifié).
   ------------------------------------------------------------ */

const DIGEST_TYPE = "verification_digest";
const DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Envoie le digest s'il est dû (aucun envoi dans les 24 dernières heures),
 * puis marque l'envoi. Silencieux et non bloquant en cas d'erreur.
 *
 * NB: à utiliser dans un contexte `after()` (exécution post-réponse) —
 * jamais sur le chemin critique de la requête.
 *
 * Limite acceptée : deux événements quasi simultanés (course) peuvent tous
 * deux lire « dû » et envoyer un doublon. Négligeable à cette échelle ;
 * l'upsert sur digest_type garantit de toute façon un marqueur unique.
 */
export async function sendVerificationDigestIfDue(
  adminSupabase: SupabaseClient<Database>,
  now: Date = new Date()
): Promise<void> {
  try {
    // ── 1. Un digest a-t-il déjà été envoyé récemment ? ──
    const { data: marker } = await adminSupabase
      .from("email_digests")
      .select("period_end, sent_at")
      .eq("digest_type", DIGEST_TYPE)
      .maybeSingle();

    const lastSent = marker?.sent_at ? new Date(marker.sent_at) : null;
    if (lastSent && now.getTime() - lastSent.getTime() < DIGEST_INTERVAL_MS) {
      return; // déjà envoyé dans les 24 h — rien à faire
    }

    // ── 2. Période couverte ──
    // Sans marqueur : 24 h glissantes. Avec marqueur ancien : depuis la fin
    // de la période précédente (aucune vérification perdue entre deux envois).
    const periodStart = marker?.period_end
      ? new Date(marker.period_end)
      : new Date(now.getTime() - DIGEST_INTERVAL_MS);
    const periodStartISO = periodStart.toISOString();
    const periodEndISO = now.toISOString();

    // ── 3. Statistiques de la période ──
    const base = adminSupabase.from("verifications");
    const [total, success, failed, bot] = await Promise.all([
      base
        .select("id", { count: "exact", head: true })
        .gte("timestamp", periodStartISO),
      base
        .select("id", { count: "exact", head: true })
        .eq("result", "success")
        .gte("timestamp", periodStartISO),
      base
        .select("id", { count: "exact", head: true })
        .eq("result", "failed")
        .gte("timestamp", periodStartISO),
      base
        .select("id", { count: "exact", head: true })
        .eq("error_type", "bot_detected")
        .gte("timestamp", periodStartISO),
    ]);

    // ── 4. Dernières vérifications (pour l'email) ──
    const { data: recent } = await base
      .select("timestamp, result, error_type, releves(student_name)")
      .gte("timestamp", periodStartISO)
      .order("timestamp", { ascending: false })
      .limit(5);

    // ── 5. Envoi + marquage ──
    const sent = await sendVerificationDigest({
      periodStart: periodStartISO,
      periodEnd: periodEndISO,
      total: total.count ?? 0,
      successCount: success.count ?? 0,
      failedCount: failed.count ?? 0,
      botCount: bot.count ?? 0,
      recent: (recent ?? []).map((r) => ({
        studentName:
          (r.releves as { student_name?: string } | null)?.student_name ?? null,
        result: r.result,
        errorType: r.error_type,
        timestamp: r.timestamp,
      })),
    });

    // On ne marque l'envoi que s'il a réellement abouti (sinon on retentera
    // au prochain événement — sans coût, Resend n'est simplement pas configuré
    // ou a échoué).
    if (!sent) return;

    await adminSupabase.from("email_digests").upsert(
      {
        digest_type: DIGEST_TYPE,
        period_end: periodEndISO,
        sent_at: now.toISOString(),
      },
      { onConflict: "digest_type" }
    );
  } catch (error) {
    // Jamais bloquant : un échec de digest ne doit pas casser la vérification.
    console.error("[digest] Échec de l'envoi du récapitulatif :", error);
  }
}
