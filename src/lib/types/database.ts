/* ============================================================
   Types ESCEN — Modèle de Données
   ============================================================ */

// ─── Statuts ───────────────────────────────────────────────
export type ReleveStatus = "active" | "cancelled" | "replaced";
export type VerificationResult = "success" | "failed";
export type AdminRole = "admin" | "gestionnaire";

// ─── Note individuelle ──────────────────────────────────────
// NB: type alias et non interface — les interfaces n'ont pas d'index
// signature implicite, or postgrest-js v2.111 exige Row/Insert/Update
// assignables à Record<string, unknown> (GenericTable / GenericSchema).
export type ReleveNote = {
  matiere: string;
  code: string;
  credit: number;
  note: number;
  mention?: string;
};

// ─── Relevé de notes ────────────────────────────────────────
export type Releve = {
  id: string;
  student_name: string;
  student_id: string;
  student_email: string;
  promo: string;
  notes_data: ReleveNote[];
  mention: string;
  moyenne: number;
  pdf_url: string;
  status: ReleveStatus;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
  replaced_by: string | null;
};

// ─── Vérification ───────────────────────────────────────────
export type Verification = {
  id: string;
  /** Miroir texte de l'id (colonne générée) — permet la recherche ilike
   *  de la référence affichée dans le filigrane anti-capture. */
  id_text: string;
  releve_id: string | null;
  attempted_id: string;
  ip_address: string;
  user_agent: string;
  result: VerificationResult;
  error_type: string;
  /** Signaux de détection d'automatisation (webdriver, headless_ua, …) */
  signals: string[];
  timestamp: string;
};

// ─── Log administrateur ──────────────────────────────────────
export type AdminLog = {
  id: string;
  admin_id: string | null;
  admin_email: string;
  action: string;
  target_releve_id: string | null;
  details: Record<string, unknown>;
  timestamp: string;
};

// ─── Rôle administrateur (RLS is_admin) ──────────────────────
export type AdminRoleRow = {
  user_id: string;
  role: AdminRole;
  created_at: string;
};

// ─── Rate Limiting ──────────────────────────────────────────
export type RateLimit = {
  id: string;
  ip_address: string;
  endpoint: string;
  attempt_count: number;
  window_start: string;
  blocked_until: string | null;
};

// ─── Alerte anti-fraude ──────────────────────────────────────
export type FraudAlert = {
  id: string;
  identifier: string;
  attempt_count: number;
  ip_address: string;
  alerted_at: string;
};

// ─── Inscription au lancement (formulaire d'accueil) ─────────
export type NotifySubscriber = {
  id: string;
  email: string;
  created_at: string;
};

// ─── Marqueurs d'envoi d'emails périodiques (digest quotidien) ─
export type EmailDigest = {
  digest_type: string;
  /** Fin de la période couverte par le dernier envoi (début de la suivante) */
  period_end: string;
  sent_at: string;
};

// ─── Supabase Database type ──────────────────────────────────
export interface Database {
  public: {
    Tables: {
      releves: {
        Row: Releve;
        Insert: Omit<Releve, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<Releve, "id">>;
        Relationships: [];
      };
      verifications: {
        Row: Verification;
        // NB: id optionnel à l'insertion — la base le génère (gen_random_uuid),
        // mais /api/verify fournit le sien pour la traçabilité du filigrane.
        // id_text est généré par la base (GENERATED ALWAYS) — non insérable.
        Insert: Omit<Verification, "id" | "id_text" | "timestamp"> & { id?: string };
        Update: Partial<Omit<Verification, "id" | "id_text">>;
        Relationships: [
          {
            // Permet le select typé `*, releves!inner(...)` (routes admin logs / export)
            foreignKeyName: "verifications_releve_id_fkey";
            columns: ["releve_id"];
            isOneToOne: false;
            referencedRelation: "releves";
            referencedColumns: ["id"];
          }
        ];
      };
      admin_logs: {
        Row: AdminLog;
        Insert: Omit<AdminLog, "id" | "timestamp">;
        Update: Partial<Omit<AdminLog, "id">>;
        Relationships: [];
      };
      admin_roles: {
        Row: AdminRoleRow;
        Insert: Pick<AdminRoleRow, "user_id" | "role">;
        Update: Partial<Pick<AdminRoleRow, "role">>;
        Relationships: [];
      };
      rate_limits: {
        Row: RateLimit;
        Insert: Omit<RateLimit, "id">;
        Update: Partial<Omit<RateLimit, "id">>;
        Relationships: [];
      };
      fraud_alerts: {
        Row: FraudAlert;
        Insert: Omit<FraudAlert, "id" | "alerted_at">;
        Update: Partial<Omit<FraudAlert, "id">>;
        Relationships: [];
      };
      notify_subscribers: {
        Row: NotifySubscriber;
        Insert: Omit<NotifySubscriber, "id" | "created_at">;
        Update: Partial<Omit<NotifySubscriber, "id">>;
        Relationships: [];
      };
      email_digests: {
        Row: EmailDigest;
        Insert: EmailDigest;
        Update: Partial<EmailDigest>;
        Relationships: [];
      };
    };
    // NB: l'overload Views de from() est déclarée après celle de Tables,
    // donc un Record<string, never> ne piège pas les noms de tables.
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
}

// ─── Locale ─────────────────────────────────────────────────

export type Locale = "fr" | "en";

// ─── Types API ───────────────────────────────────────────────

// Réponse de vérification (page publique)
export interface VerifyResponse {
  success: boolean;
  data?: {
    releve: Releve;
    /** Identifiant de la vérification enregistrée — référence de traçabilité
     *  utilisée dans le filigrane anti-capture (consultable dans l'historique). */
    verificationId?: string;
  };
  error?: {
    // NB: un relevé annulé renvoie "not_found" (anti-fraude : indistinguable
    // d'un identifiant inconnu pour le public).
    code: "not_found" | "rate_limited" | "server_error" | "captcha_failed" | "bot_detected" | "locked";
    message: string;
  };
}

// Réponse API générique
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    page: number;
    per_page: number;
    total: number;
  };
}

// Statistiques du tableau de bord
export interface DashboardStats {
  activeReleves: number;
  cancelledReleves: number;
  totalVerifications: number;
  todayVerifications: number;
}

// Session admin
export interface AdminSession {
  id: string;
  email: string;
  role: AdminRole;
}
