import { Resend } from "resend";

/**
 * Module Resend — envoi des emails d'alerte anti-fraude.
 *
 * NB : sans RESEND_API_KEY configuré, toutes les fonctions sont des
 * no-ops silencieux (l'app reste fonctionnelle en local sans email).
 */

// Instance Resend (lazy : pas de throw si la clé manque)
const getResend = () => {
  const apiKey = process.env.RESEND_API_KEY;
  return apiKey ? new Resend(apiKey) : null;
};

/**
 * Échappe les caractères HTML dans une chaîne.
 * Indispensable : l'identifiant d'un relevé est contrôlé par l'attaquant
 * (champ `id` du POST /api/verify) et ne doit jamais injecter de HTML
 * dans l'email reçu par la scolarité/DSI.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface FraudAlertParams {
  /** Identifiant de relevé qui subit les tentatives répétées */
  identifier: string;
  /** IP hachée (RGPD) de l'origine des tentatives */
  ipAddress: string;
  /** Nombre de tentatives échouées sur cet identifiant */
  attemptCount: number;
  /** Fenêtre de détection (ms) */
  timeWindowMs: number;
}

/**
 * Envoie une alerte email de comportement anormal (tentatives répétées
 * sur un même identifiant) à la scolarité / DSI.
 *
 * Silencieux si Resend n'est pas configuré, ou en cas d'erreur d'envoi
 * (l'échec d'alerte ne doit jamais casser la route de vérification).
 */
export async function sendFraudAlert(params: FraudAlertParams): Promise<void> {
  const resend = getResend();
  const from = process.env.RESEND_EMAIL_FROM;
  const to = process.env.RESEND_ALERT_TO;

  if (!resend || !from || !to) return;

  const minutes = Math.round(params.timeWindowMs / 60_000);

  const identifierEscaped = escapeHtml(params.identifier);
  const ipEscaped = escapeHtml(params.ipAddress);

  try {
    await resend.emails.send({
      from,
      to,
      subject: `[ESCEN] Alerte sécurité — ${params.attemptCount} tentatives sur un identifiant`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #1D2B6B; margin-top: 0;">Alerte sécurité — ESCEN</h2>
          <p style="color: #334155;">Un comportement anormal a été détecté sur la page de vérification des relevés.</p>
          <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
            <tr>
              <td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold; width: 40%; border-radius: 6px 0 0 6px;">Identifiant visé</td>
              <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-family: monospace;">${identifierEscaped}</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold;">Tentatives échouées</td>
              <td style="padding: 8px 12px; border: 1px solid #e2e8f0;"><strong>${params.attemptCount}</strong> en ${minutes} min</td>
            </tr>
            <tr>
              <td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold;">IP d'origine (hash)</td>
              <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-family: monospace;">${ipEscaped}</td>
            </tr>
          </table>
          <p style="color: #64748b; font-size: 13px;">Il peut s'agir d'une tentative de devinette d'identifiants. Le système a déjà bloqué temporairement l'origine. Consultez l'historique dans l'espace d'administration.</p>
        </div>
      `,
    });
  } catch (error) {
    console.error("[resend] Échec d'envoi de l'alerte anti-fraude :", error);
  }
}

// ─── Notifications de vérification ───────────────────────────

export interface VerificationNotificationParams {
  /** Nom de l'étudiant (affiché dans les emails) */
  studentName: string;
  /** Email de l'étudiant (vide → pas de notification étudiant) */
  studentEmail: string;
  /** Identifiant du relevé vérifié */
  releveId: string;
  /** Date/heure de la vérification */
  verifiedAt: Date;
}

/**
 * Envoi générique d'un email transactionnel via Resend.
 * Silencieux (no-op) si la clé API ou l'expéditeur ne sont pas configurés,
 * ou en cas d'erreur — une notification ne doit jamais casser une route.
 */
async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const resend = getResend();
  const from = process.env.RESEND_EMAIL_FROM;
  if (!resend || !from || !params.to) return false;

  try {
    await resend.emails.send({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
    });
    return true;
  } catch (error) {
    console.error("[resend] Échec d'envoi de l'email :", error);
    return false;
  }
}

/**
 * Notifie l'étudiant que son relevé vient d'être vérifié.
 * Envoyé UNIQUEMENT si le relevé possède un email étudiant valide.
 *
 * NB : un lien de vérification N'EST PAS inclus volontairement — ce serait
 * un vecteur de phishing (le destinataire pourrait partager son lien, ou un
 * attaquant pourrait usurper l'expéditeur). L'email informe simplement.
 */
export async function sendStudentVerificationNotification(
  params: VerificationNotificationParams
): Promise<void> {
  const email = params.studentEmail.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

  const name = escapeHtml(params.studentName);
  const date = escapeHtml(
    params.verifiedAt.toLocaleString("fr-FR", {
      dateStyle: "medium",
      timeStyle: "short",
    })
  );

  await sendEmail({
    to: email,
    subject: "Votre relevé ESCEN a été vérifié",
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #1D2B6B; margin-top: 0;">Bonjour ${name},</h2>
        <p style="color: #334155;">Votre relevé de notes ESCEN a été vérifié avec succès par un tiers.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
          <tr>
            <td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold; width: 40%; border-radius: 6px 0 0 6px;">Document vérifié</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-family: monospace;">${escapeHtml(params.releveId)}</td>
          </tr>
          <tr>
            <td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold;">Date de vérification</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${date}</td>
          </tr>
        </table>
        <p style="color: #64748b; font-size: 13px;">Si vous n'êtes pas à l'origine de cette vérification, contactez la scolarité de l'ESCEN.</p>
      </div>
    `,
  });
}

// ─── Notification étudiant : changement de statut du relevé ─────────

export type ReleveStatusAction =
  | "cancelled" // annulé (plus consultable)
  | "replaced" // remplacé par une nouvelle version (QR toujours valide)
  | "active" // réactivé (retour en arrière)
  | "locked" // verrouillé (consultation suspendue)
  | "unlocked"; // déverrouillé (de nouveau consultable)

export interface ReleveStatusNotificationParams {
  studentName: string;
  studentEmail: string;
  releveId: string;
  action: ReleveStatusAction;
  /** Pour un remplacement : nom de la nouvelle version publiée */
  replacementName?: string;
}

const RELEVE_STATUS_MESSAGES: Record<
  ReleveStatusAction,
  { title: string; body: string }
> = {
  cancelled: {
    title: "Votre relevé de notes a été annulé",
    body: "Votre relevé de notes ESCEN a été annulé : il n'est plus consultable par les tiers. Si vous pensez qu'il s'agit d'une erreur, contactez la scolarité.",
  },
  replaced: {
    title: "Votre relevé de notes a été remplacé par une nouvelle version",
    body: "Une nouvelle version officielle de votre relevé a été publiée. Le QR code déjà imprimé reste valide : il affiche désormais la version à jour du document.",
  },
  active: {
    title: "Votre relevé de notes est de nouveau actif",
    body: "Votre relevé de notes ESCEN a été réactivé : il est de nouveau consultable par les tiers.",
  },
  locked: {
    title: "Votre relevé de notes est temporairement indisponible",
    body: "La consultation de votre relevé est temporairement suspendue. Vous serez informé(e) dès qu'il sera de nouveau consultable.",
  },
  unlocked: {
    title: "Votre relevé de notes est de nouveau consultable",
    body: "Votre relevé de notes ESCEN est de nouveau disponible à la consultation.",
  },
};

/**
 * Informe l'étudiant par email lorsqu'un administrateur change le statut de
 * son relevé (annulation, remplacement, réactivation, verrouillage).
 * Envoyé UNIQUEMENT si le relevé possède un email étudiant valide.
 *
 * NB: aucun lien de vérification n'est inclus volontairement (anti-phishing) —
 * l'email informe simplement. Silencieux si Resend n'est pas configuré.
 */
export async function sendStudentReleveStatusNotification(
  params: ReleveStatusNotificationParams
): Promise<void> {
  const email = params.studentEmail.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;

  const { title, body } = RELEVE_STATUS_MESSAGES[params.action];
  const name = escapeHtml(params.studentName);
  const replacementLine =
    params.action === "replaced" && params.replacementName
      ? `<tr>
          <td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold; width: 40%; border-radius: 6px 0 0 6px;">Nouvelle version</td>
          <td style="padding: 8px 12px; border: 1px solid #e2e8f0;">${escapeHtml(params.replacementName)}</td>
        </tr>`
      : "";

  await sendEmail({
    to: email,
    subject: `[ESCEN] ${title}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #1D2B6B; margin-top: 0;">Bonjour ${name},</h2>
        <p style="color: #334155;">${escapeHtml(title)}.</p>
        <p style="color: #334155;">${escapeHtml(body)}</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
          <tr>
            <td style="padding: 8px 12px; background: #f1f5f9; font-weight: bold; width: 40%; border-radius: 6px 0 0 6px;">Relevé (ID)</td>
            <td style="padding: 8px 12px; border: 1px solid #e2e8f0; font-family: monospace;">${escapeHtml(params.releveId)}</td>
          </tr>
          ${replacementLine}
        </table>
        <p style="color: #64748b; font-size: 13px;">Pour toute question, contactez la scolarité de l'ESCEN.</p>
      </div>
    `,
  });
}

// ─── Récapitulatif quotidien (remplace l'email admin par vérification) ─

export interface DigestEntry {
  studentName: string | null;
  result: "success" | "failed";
  errorType: string;
  timestamp: string;
}

export interface VerificationDigestParams {
  periodStart: string;
  periodEnd: string;
  total: number;
  successCount: number;
  failedCount: number;
  botCount: number;
  recent: DigestEntry[];
}

/**
 * Envoie le récapitulatif quotidien des vérifications à l'administration
 * (RESEND_ALERT_TO) : total + répartition (succès / échecs / robots) +
 * dernières vérifications. Envoyé au plus une fois par 24 h (voir
 * `sendVerificationDigestIfDue` dans src/lib/digests.ts).
 *
 * Retourne `true` si un email a réellement été transmis à Resend (utile
 * pour ne pas marquer l'envoi quand Resend n'est pas configuré).
 */
export async function sendVerificationDigest(
  params: VerificationDigestParams
): Promise<boolean> {
  const to = process.env.RESEND_ALERT_TO;
  if (!to) return false;

  const from = new Date(params.periodStart).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  // NB: "Échecs" inclut les tentatives de robots (résultat failed aussi) —
  // la ligne "Robots" les détaille à part.
  const footnote =
    params.botCount > 0
      ? `<p style="color:#94a3b8;font-size:12px;">Dont ${params.botCount} tentative(s) de robot bloquée(s) (comptées dans les échecs).</p>`
      : "";
  const toDate = new Date(params.periodEnd).toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const recentRows = params.recent
    .map((r) => {
      const name = escapeHtml(r.studentName ?? "—");
      const ts = new Date(r.timestamp).toLocaleString("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      });
      const badge =
        r.result === "success"
          ? `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;">Succès</span>`
          : `<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;">Échec</span>`;
      return `
        <tr>
          <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;">${name}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:12px;">${ts}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;text-align:right;">${badge}</td>
        </tr>`;
    })
    .join("");

  const sendEmailResult = await sendEmail({
    to,
    subject: `[ESCEN] Récapitulatif — ${params.total} vérification${params.total > 1 ? "s" : ""} (24 h)`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
        <h2 style="color: #1D2B6B; margin-top: 0;">Récapitulatif des vérifications — ESCEN</h2>
        <p style="color: #64748b; font-size: 13px;">Période : ${from} → ${toDate}</p>
        <table style="width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 14px;">
          <tr>
            <td style="padding: 10px 12px; background: #f1f5f9; border-radius: 8px 0 0 8px; width: 25%; text-align:center;">
              <div style="font-size:22px;font-weight:bold;color:#1D2B6B;">${params.total}</div>
              <div style="font-size:11px;color:#64748b;">Total</div>
            </td>
            <td style="padding: 10px 12px; background: #f8fafc; width: 25%; text-align:center;">
              <div style="font-size:22px;font-weight:bold;color:#15803d;">${params.successCount}</div>
              <div style="font-size:11px;color:#64748b;">Succès</div>
            </td>
            <td style="padding: 10px 12px; background: #f1f5f9; width: 25%; text-align:center;">
              <div style="font-size:22px;font-weight:bold;color:#b91c1c;">${params.failedCount}</div>
              <div style="font-size:11px;color:#64748b;">Échecs</div>
            </td>
            <td style="padding: 10px 12px; background: #f8fafc; border-radius: 0 8px 8px 0; width: 25%; text-align:center;">
              <div style="font-size:22px;font-weight:bold;color:#c2410c;">${params.botCount}</div>
              <div style="font-size:11px;color:#64748b;">Robots</div>
            </td>
          </tr>
        </table>
        <p style="color: #334155; font-weight: 600; margin-bottom: 8px;">Dernières vérifications</p>
        <table style="width: 100%; border-collapse: collapse; margin: 0 0 16px; font-size: 14px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:6px 12px;font-size:11px;color:#64748b;text-transform:uppercase;">Étudiant</th>
              <th style="text-align:left;padding:6px 12px;font-size:11px;color:#64748b;text-transform:uppercase;">Date</th>
              <th style="text-align:right;padding:6px 12px;font-size:11px;color:#64748b;text-transform:uppercase;">Résultat</th>
            </tr>
          </thead>
          <tbody>${recentRows || "<tr><td colspan='3' style='padding:12px;color:#94a3b8;text-align:center;'>Aucune vérification détaillée.</td></tr>"}</tbody>
        </table>
        ${footnote}
        <p style="color: #64748b; font-size: 13px;">Détail complet : espace d'administration → Historique des vérifications.</p>
      </div>
    `,
  });

  // Renvoie le résultat réel de l'envoi (sendEmail ne lève jamais) : le
  // marqueur 24 h ne doit être posé que si l'email est réellement parti.
  return sendEmailResult;
}
