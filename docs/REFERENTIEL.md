# 📘 Référentiel technique — ESCEN Verification

Système de vérification de relevés de notes par QR Code.
Livrable de stage — document de référence pour les types, routes API, libs, composants et pages du projet.

---

## 1. Vue d'ensemble

| Élément | Valeur |
|---|---|
| Framework | **Next.js 16.2.12** (App Router, `proxy.ts` — `middleware` déprécié) |
| Langage | TypeScript 5 |
| React | 19.2.4 |
| Base de données | Supabase / PostgreSQL (`supabase-schema.sql`) |
| Auth | Supabase Auth (email + mot de passe, session cookies) |
| Emails | Resend (`resend` 6.18.1) |
| QR Code | `qrcode` 1.5.4 |
| PDF | `pdfkit` 0.19.1 |
| Styles | Tailwind CSS 4 |
| CAPTCHA | Cloudflare Turnstile (optionnel, actif en prod) |
| Scripts | `dev` · `build` · `start` · `lint` · `setup-db` · `seed` |

---

## 2. Structure du projet

```
src/
  app/                      # Routes App Router (pages + API)
    admin/                  # Espace admin (dashboard, releves, logs, fraude)
    api/                    # Routes API (voir §4)
    verify/                 # Page publique de vérification
    layout.tsx · page.tsx   # Accueil (coming soon) + layout racine
  components/
    admin/                  # AdminSidebar, CreateReleveForm, DataTable
    verify/                 # VerifyForm, VerificationResult, ReleveDisplay, TurnstileWidget
    Icon.tsx                # Icônes Material Symbols (remplace les emojis)
    CountdownTimer · EmailForm · SiteFooter · SocialProof
  lib/
    types/database.ts       # Tous les types du projet (voir §3)
    releves.ts              # Résolution + sanitisation publique
    resend.ts               # Tous les emails
    digests.ts              # Récapitulatif quotidien admin
    turnstile.ts            # Vérification CAPTCHA
    bot-detection.ts        # Détection automatisation/scraping
    qr.ts · pdf.ts · dates.ts
    i18n/                   # FR/EN (config.ts + locales)
    supabase/               # client.ts (navigateur) · server.ts (serveur) · proxy.ts (middleware)
  proxy.ts                  # Rafraîchit la session + protège /admin
scripts/                    # setup-db.ts · seed.ts · load-env.ts · test-replacement.ts
supabase-schema.sql         # Schéma complet (idempotent, RLS incluse)
docs/                       # Cahier des charges, SUIVI, REFERENTIEL
```

---

## 3. Modèle de données

### 3.1 Types — `src/lib/types/database.ts`

**Enums / unions :**

| Type | Valeurs |
|---|---|
| `ReleveStatus` | `"active" \| "cancelled" \| "replaced"` |
| `VerificationResult` | `"success" \| "failed"` |
| `AdminRole` | `"admin" \| "gestionnaire"` |
| `Locale` | `"fr" \| "en"` |

**`ReleveNote`** — une note individuelle :
`matiere: string` · `code: string` · `credit: number` · `note: number` · `mention?: string`

**`Releve`** — un relevé de notes :

| Champ | Type | Note |
|---|---|---|
| `id` | `string` | UUID (généré par la base) |
| `student_name` | `string` | Nom complet |
| `student_id` | `string` | N° étudiant (unique) |
| `student_email` | `string` | Obligatoire (notifications) |
| `promo` | `string` | Ex. « Licence 3 2025-2026 » |
| `notes_data` | `ReleveNote[]` | Notes au format JSONB |
| `mention` | `string` | Mention obtenue |
| `moyenne` | `number` | Moyenne générale |
| `pdf_url` | `string` | Réservé admin |
| `status` | `ReleveStatus` | `active` / `cancelled` / `replaced` |
| `locked_at` | `string \| null` | Non-null = consultation suspendue |
| `created_at` / `updated_at` | `string` | `updated_at` auto via trigger |
| `replaced_by` | `string \| null` | Chaîne de remplacement |

**`Verification`** — une tentative de vérification (traçabilité) :

| Champ | Type | Note |
|---|---|---|
| `id` | `string` | UUID — **référence du filigrane** |
| `id_text` | `string` | Colonne générée `id::text` (recherche `ilike`) |
| `releve_id` | `string \| null` | FK vers `releves` (null si échec) |
| `attempted_id` | `string` | Identifiant saisi (fraude) |
| `ip_address` | `string` | **Hashée** (RGPD) |
| `user_agent` | `string` | Navigateur |
| `result` | `VerificationResult` | `success` / `failed` |
| `error_type` | `string` | `invalid_id` · `rate_limited` · `locked` · `bot_detected` · `captcha_failed` · `""` |
| `signals` | `string[]` | Signaux d'automatisation détectés |
| `timestamp` | `string` | Défaut `now()` |

**Autres types :**

| Type | Rôle | Champs |
|---|---|---|
| `AdminLog` | Log d'action admin | `id, admin_id, admin_email, action, target_releve_id, details (JSONB), timestamp` |
| `AdminRoleRow` | Rôle admin | `user_id, role, created_at` |
| `RateLimit` | Anti-brute-force | `id, ip_address, endpoint, attempt_count, window_start, blocked_until` |
| `FraudAlert` | Alerte anti-fraude | `id, identifier, attempt_count, ip_address, alerted_at` |
| `NotifySubscriber` | Inscription accueil | `id, email (unique), created_at` |
| `EmailDigest` | Marqueur digest 24 h | `digest_type (PK), period_end, sent_at` |

**Types API :**

| Interface | Rôle |
|---|---|
| `VerifyResponse` | Réponse `/api/verify` — `data.releve` (public) + `data.verificationId` ; `error.code ∈ {not_found, rate_limited, server_error, captcha_failed, bot_detected, locked}` |
| `ApiResponse<T>` | Réponse générique — `success, data?, error?, pagination?` |
| `DashboardStats` | `activeReleves, cancelledReleves, totalVerifications, todayVerifications` |
| `AdminSession` | `id, email, role` |

**`Database`** — typage Supabase complet (Tables `Row/Insert/Update` pour `releves`, `verifications`, `admin_logs`, `admin_roles`, `rate_limits`, `fraud_alerts`, `notify_subscribers`, `email_digests`). NB : `Insert` de `verifications` autorise un `id` optionnel (pré-généré côté serveur pour le filigrane).

### 3.2 Types emails — `src/lib/resend.ts`

| Type | Rôle |
|---|---|
| `FraudAlertParams` | `identifier, ipAddress, attemptCount, timeWindowMs` |
| `VerificationNotificationParams` | `studentName, studentEmail, releveId, verifiedAt` |
| `ReleveStatusAction` | `"cancelled" \| "replaced" \| "active" \| "locked" \| "unlocked"` |
| `ReleveStatusNotificationParams` | + `replacementName?` (remplacement) |
| `DigestEntry` | `studentName, result, errorType, timestamp` |
| `VerificationDigestParams` | `periodStart, periodEnd, total, successCount, failedCount, botCount, recent[]` |

### 3.3 Base de données — `supabase-schema.sql` (résumé)

**Tables :** `releves` · `verifications` (avec `id_text` généré + index) · `admin_logs` · `fraud_alerts` · `rate_limits` · `notify_subscribers` · `email_digests` · `admin_roles`.

**Fonctions SQL :**
- `update_updated_at()` — trigger `updated_at` sur `releves`
- `is_admin()` — SECURITY DEFINER, lit `admin_roles` pour `auth.uid()`
- `resolve_active_releve(p_id uuid)` — RECURSIVE CTE qui suit `replaced_by` (profondeur max 10) et renvoie la version `active` (ou rien). SECURITY DEFINER, RLS strictes conservées.

**RLS (politiques clés) :**
- `releves` : SELECT public si `status='active'` ; SELECT/INSERT/UPDATE admin via `is_admin()`
- `verifications` : INSERT public (traçabilité) ; SELECT admin uniquement
- `rate_limits` : SELECT/INSERT/UPDATE publics (IP hashées)
- `admin_logs`, `fraud_alerts`, `notify_subscribers` (SELECT) : admin uniquement
- `notify_subscribers` : INSERT public
- `admin_roles` : aucune policy publique (accès `is_admin()` / service role)

**Purge automatique (pg_cron, si extension active) :** vérifications > 5 ans supprimées (hebdo, RGPD) ; `rate_limits` nettoyés après 24 h.

---

## 4. Routes API

### 4.1 Publiques

#### `POST /api/verify` — Vérifie un identifiant de relevé
- **Body** : `{ id: string, turnstileToken?: string, clientSignals?: string[] }`
- **Protections (dans l'ordre)** :
  1. **Digest quotidien** planifié pour toutes les tentatives (`after()`)
  2. **Détection bots** (`analyzeBotRisk`) → 403 `bot_detected`, IP bloquée 5 min, journalisée
  3. **Turnstile** (si configuré) → 400 `captcha_failed`
  4. **Rate limiting** : 5 tentatives / min / IP, blocage 5 min → 429 `rate_limited`
  5. Validation `id` (≥ 8 caractères) → 200 `not_found` (indistinguable, anti-fraude)
  6. Résolution via `resolve_active_releve` → 200 `not_found` si inconnu/annulé + **détection fraude** (≥ 5 échecs / 15 min / identifiant → alerte email, cooldown 24 h)
  7. **Verrouillage** (`locked_at`) → 403 `locked`
  8. **Succès** → `{ success: true, data: { releve: toPublicReleve(releve), verificationId } }` + email étudiant via `after()`
- **Anti-timing** : délai fixe de 200 ms sur les réponses d'échec.
- **RGPD** : `student_email`, `pdf_url`, `locked_at`, `replaced_by` retirés de la réponse (`toPublicReleve`).
- **Traçabilité** : `verificationId` (UUID généré serveur) = référence affichée dans le filigrane.

#### `GET /api/releve/[id]` — Détail public d'un relevé
- Réponse : `{ success, data: { releve: toPublicReleve(releve) } }`
- 404 `not_found` (id < 8 chars, inconnu, annulé) · 403 `locked` · 500 `server_error`

#### `GET /api/releve/[id]/qrcode` — QR Code PNG
- PNG 512 px, niveau M, pointe vers `/verify/[id]`, ne contient **aucune donnée personnelle**.
- 404 si l'identifiant ne résout pas vers une version active. `Cache-Control: public, max-age=3600`.

#### `GET /api/releve/[id]/pdf` — PDF officiel (**admin uniquement**)
- **Réservé aux admins authentifiés** : un visiteur non connecté reçoit 404 `not_found` (aucun indice d'existence).
- Génère le PDF (bandeau ESCEN, infos étudiant, tableau des notes, moyenne, mention, QR code) via `pdfkit`.
- Sert la version active (la chaîne de remplacement s'applique aussi). Nom de fichier basé sur le n° étudiant. `Cache-Control: public, no-cache`.

#### `POST /api/notify` — Inscription au lancement (accueil)
- Body : `{ email }`. Idempotent (contrainte UNIQUE, 23505 traité comme succès).
- Rate limit : 5 / min / IP (endpoint dédié `rate_limits`), appliqué **avant** validation email.

### 4.2 Admin (toutes protégées : 401 si non authentifié)

#### `POST /api/admin/login` · `DELETE /api/admin/login` (logout)
- `signInWithPassword` Supabase → `{ success, data: { user, session } }`. 401 si identifiants incorrects.

#### `GET /api/admin/stats` — Dashboard
- Compteurs : `activeReleves`, `cancelledReleves`, `totalVerifications`, `todayVerifications` (journée Europe/Paris via `startOfTodayParis`).

#### `GET /api/admin/releves` — Liste des relevés
- Query : `q` (recherche `ilike` sur name/id/promo), `status`, `page`, `per_page` (≤ 50).

#### `POST /api/admin/releves` — Création d'un relevé
- Body : `student_name`, `student_id`, `student_email` (obligatoire + validé regex), `promo`, `notes_data`, `moyenne`, `mention`.
- Statut initial `active`. Journalise `admin_logs` (action `create`). Retourne 201.

#### `GET /api/admin/releves/[id]` — Détail d'un relevé
- Retourne `{ releve, verifications (50 dernières), predecessors (versions que ce relevé remplace) }`.
- Journalise `view` dans `admin_logs`.

#### `PUT /api/admin/releves/[id]/status` — Statut / verrouillage
- **Body** :
  - `{ lock: true | false }` → verrouille / déverrouille (réservé aux relevés `active`) ; anti no-op (400 si déjà dans l'état).
  - `{ status: "cancelled" | "replaced" | "active", replaced_by? }` → annule, remplace (le remplaçant doit être actif et différent), ou réactive ; anti no-op (400 si statut identique).
- **Emails étudiant** envoyés via `after()` (jamais bloquant) : `locked`, `unlocked`, `cancelled`, `replaced` (avec nom de la nouvelle version), `active`.
- Journalise `admin_logs` : `lock` / `unlock` / `cancel` / `replace` / `reactivate`.

#### `GET /api/admin/verifications` — Historique des vérifications
- Query : `page`, `per_page` (≤ 100), `result` (`success`/`failed`), `error_type`, `signals=yes` (signaux non vides), `q` (recherche sur `attempted_id` **et** `id_text` — la référence du filigrane est retrouvable), `from`/`to` (dates).
- Left join `releves(student_name, student_id)`.

#### `GET /api/admin/verifications/export` — Export CSV
- CSV complet (Date, ID relevé, Étudiant, ID étudiant, Résultat, Type d'erreur, IP hashée, Navigateur), inner join `releves`. Journalise `export`.

#### `GET /api/admin/fraude` — Alertes anti-fraude
- Liste paginée (`page`, `per_page` ≤ 100) de `fraud_alerts` (1 alerte max / identifiant / 24 h).

### 4.3 Non-API

- `src/app/robots.ts` · `src/app/sitemap.ts` — SEO.

---

## 5. Libs

| Fichier | Rôle | Exports principaux |
|---|---|---|
| `lib/releves.ts` | Résolution + public | `resolveActiveReleve(supabase, id)` (RPC `resolve_active_releve`), `toPublicReleve(releve)` (liste blanche RGPD) |
| `lib/resend.ts` | Emails | `sendFraudAlert`, `sendStudentVerificationNotification`, `sendStudentReleveStatusNotification`, `sendVerificationDigest` (+ `escapeHtml`, `sendEmail`) — tous no-ops si Resend non configuré, jamais bloquants |
| `lib/digests.ts` | Digest quotidien | `sendVerificationDigestIfDue(adminSupabase, now)` — max 1 envoi / 24 h (marqueur `email_digests`), période continue (`period_end`), compteurs + 5 dernières, marquage seulement si envoi réel |
| `lib/turnstile.ts` | CAPTCHA | `isTurnstileEnabled()` (exige les 2 clés), `verifyTurnstileToken(token, ip?)` (fail-open sur erreur réseau, fail-closed sur jeton absent/invalide) |
| `lib/bot-detection.ts` | Anti-scraping | `BOT_UA_PATTERNS`, `detectAutomationClient()` (signaux JS : `navigator.webdriver`, `cdc_chromedriver`, `html[webdriver]`, `headless_ua`, `no_languages`, `no_plugins_no_languages`), `analyzeBotRisk(ua, clientSignals)` (ajoute `server_ua_bot`, `missing_payload`, dédoublonne) |
| `lib/qr.ts` | QR Code | `getAppBaseUrl()`, `getVerifyUrl(id)`, `generateQRCodeBuffer(id)`, `generateQRCodeDataUrl(id)` |
| `lib/pdf.ts` | PDF officiel | `generateRelevePDF(releve)` — pdfkit, couleurs ESCEN, multi-pages, QR intégré |
| `lib/dates.ts` | Fuseau Paris | `startOfTodayParis()` (gère CEST/CET), `getParisOffsetMinutes` |
| `lib/i18n/config.ts` | i18n | `getTranslations(locale)`, `useTranslations(locale)`, `detectLocale(acceptLanguage)`, `defaultLocale = "fr"` |
| `lib/supabase/client.ts` | Navigateur | `createClient()` — `createBrowserClient` (clés anon) |
| `lib/supabase/server.ts` | Serveur | `createClient()` (session cookies), `createAdminClient()` (service role, contourne RLS) |
| `lib/supabase/proxy.ts` | Proxy | `createProxyClient(request)` — convention `proxy` (Next.js 16) |
| `components/Icon.tsx` | Icônes | `IconName` (29 noms Material Symbols) + composant `<Icon name size filled label />` |

---

## 6. Composants UI

| Composant | Chemin | Rôle |
|---|---|---|
| `Icon` | `components/Icon.tsx` | Icônes vectorielles Material Symbols (ligatures), `filled` pour état actif |
| `VerifyForm` | `components/verify/VerifyForm.tsx` | Formulaire public d'identifiant + signaux client + Turnstile |
| `TurnstileWidget` | `components/verify/TurnstileWidget.tsx` | Widget CAPTCHA (actif si clés présentes) |
| `VerificationResult` | `components/verify/VerificationResult.tsx` | Affiche le résultat + transmet `verificationId` |
| `ReleveDisplay` | `components/verify/ReleveDisplay.tsx` | Carte protégée du document + **filigrane anti-capture** (diagonale, date + réf 8 caractères) |
| `AdminSidebar` | `components/admin/AdminSidebar.tsx` | Navigation admin (dashboard, relevés, historique, alertes fraude, déconnexion) |
| `CreateReleveForm` | `components/admin/CreateReleveForm.tsx` | Formulaire de création (notes dynamiques, email obligatoire) |
| `DataTable` | `components/admin/DataTable.tsx` | Tableau générique (colonnes, pagination, filtres) |
| `CountdownTimer` | `components/CountdownTimer.tsx` | Compte à rebours accueil |
| `EmailForm` | `components/EmailForm.tsx` | Inscription au lancement (accueil) |
| `SiteFooter` | `components/SiteFooter.tsx` | Pied de page |
| `SocialProof` | `components/SocialProof.tsx` | Preuve sociale accueil |

---

## 7. Pages

| Route | Fichier | Accès | Rôle |
|---|---|---|---|
| `/` | `app/page.tsx` | Public | Accueil (coming soon) |
| `/verify` | `app/verify/page.tsx` | Public | Saisie d'identifiant |
| `/verify/[id]` | `app/verify/[id]/page.tsx` | Public | Résultat + document filigrané (anti-capture, anti-download) |
| `/admin/login` | `app/admin/login/page.tsx` | Public | Connexion admin |
| `/admin/dashboard` | `app/admin/dashboard/page.tsx` | Admin | Stats + dernières vérifications |
| `/admin/releves` | `app/admin/releves/page.tsx` | Admin | Liste + création de relevés |
| `/admin/releves/[id]` | `app/admin/releves/[id]/page.tsx` | Admin | Détail, verrouillage, annulation, remplacement, PDF |
| `/admin/logs` | `app/admin/logs/page.tsx` | Admin | Historique (filtres, modale de détail, export) |
| `/admin/fraude` | `app/admin/fraude/page.tsx` | Admin | Alertes anti-fraude |

**Protection** : `src/proxy.ts` redirige vers `/admin/login` toute route `/admin/*` sans session (paramètre `redirect`).

---

## 8. Scripts (`scripts/`)

| Script | Rôle |
|---|---|
| `setup-db.ts` | Applique `supabase-schema.sql` (idempotent) |
| `seed.ts` | Données de démonstration (relevés + vérifications) |
| `load-env.ts` | Charge `.env.local` pour les scripts |
| `test-replacement.ts` | Teste la chaîne de remplacement (ancien QR → version active) |
| `generate-cahier-des-charges.js` | Génère le cahier des charges |

---

## 9. Variables d'environnement

| Variable | Rôle |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL du projet Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé anon (navigateur) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé service (admin, digest, fraud) |
| `RESEND_API_KEY` | Clé API emails (absente = emails désactivés) |
| `RESEND_EMAIL_FROM` | Expéditeur des emails |
| `RESEND_ALERT_TO` | Destinataire admin (alertes + digest) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` | CAPTCHA (les 2 requises pour l'activer) |
| `NEXT_PUBLIC_SITE_URL` | Base des liens QR (prod : ex. `https://verif.escen-university.fr`) |

---

## 10. Sécurité — synthèse

| Couche | Mécanisme |
|---|---|
| Anti-brute-force | Rate limiting 5/min/IP + blocage 5 min (`rate_limits`) |
| Anti-robot | Cloudflare Turnstile (prod) + détection automatisation (client + serveur) |
| Anti-fraude | Seuil d'échecs par identifiant (5/15 min) → alerte email, cooldown 24 h (`fraud_alerts`) |
| Anti-scraping | `bot_detected` refusé 403, IP bloquée, signaux journalisés |
| Anti-capture | Filigrane traçable : date + référence `verificationId` (8 premiers chars) ; le visiteur ne peut ni télécharger ni enregistrer le document |
| RGPD | IP hashées (sha256 tronqué 16), `student_email` jamais exposé publiquement (`toPublicReleve`), purge 5 ans |
| Anti-phishing | Aucun lien dans les emails ; échappement HTML de toutes les valeurs injectées |
| Timing | Délai fixe 200 ms sur les échecs de `/api/verify` |
| RLS | `status='active'` seul lisible publiquement ; admin via `is_admin()` SECURITY DEFINER |
