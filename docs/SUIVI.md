# 📋 Suivi du projet — ESCEN · Vérification sécurisée des relevés

> **Dernière mise à jour : 05/08/2026 (session : icônes Google + notifications email + verrouillage + journalisation enrichie + filigrane anti-capture + digest quotidien + livrable)**
> Ce fichier est la **source de vérité** de l'avancement. Il est mis à jour à chaque fin de session.
> Légende : ✅ Fait · 🔄 En cours · ⏳ À faire · 🚫 Bloqué

---

## 🥇 Lot 1 — Page publique de vérification

**Objectif** : permettre à un recruteur de vérifier un relevé en quelques secondes, depuis un téléphone, sans compte.

| Tâche | Statut | Notes |
|---|---|---|
| Page publique de vérification (`/verify`) | ✅ | Formulaire par identifiant + affichage du relevé |
| Identifiant unique impossible à deviner (UUID) | ✅ | Généré à la création du relevé |
| QR Code intégré au relevé | ✅ | `src/lib/qr.ts` — **éternel** : un QR remplacé affiche la version à jour (`resolve_active_releve`) |
| PDF du relevé | ✅ | `src/lib/pdf.ts` (API `/api/releve/[id]/pdf`) |
| Message d'erreur générique (sans indice utile) | ✅ | `not_found` pour ID faux **et** relevé annulé |
| Protection anti-robots : rate limiting | ✅ | Seuil + délai artificiel 200 ms |
| CAPTCHA **dès le lancement** (décidé) | ✅ | **Cloudflare Turnstile** — widget invisible + vérification serveur `siteverify`, vérifié AVANT le rate limiting, dégradation gracieuse en dev (sans clés) |
| **Détection d'automatisation / scraping** | ✅ | `src/lib/bot-detection.ts` : signaux client (webdriver, ChromeDriver, UA headless) + patterns User-Agent serveur + payload obligatoire → 403 `bot_detected`, IP bloquée 5 min, signaux journalisés — **testé** (curl sans payload → 403, navigateur automatisé → 403, navigateur réel → OK) |
| **Consultation seule (anti-capture)** | ✅ | Clic droit / sélection / glisser / impression / raccourcis bloqués + masquage `@media print` ; **PDF admin uniquement** (session requise, 404 générique sinon — testé curl) ; bouton « Télécharger le PDF » retiré de la page publique |
| Performance < 2 s | ✅ | Test E2E : réponses API immédiates (valide / invalide / annulé) |

---

## 🥈 Lot 2 — Traçabilité des vérifications

**Objectif** : garder une trace de chaque vérification et alerter en cas d'abus.

| Tâche | Statut | Notes |
|---|---|---|
| Enregistrement de chaque vérification (date, heure, résultat) | ✅ | Table `verifications` + colonne `attempted_id` |
| Historique consultable par la scolarité / DSI uniquement | ✅ | RLS + espace admin |
| Alerte email en cas de comportement anormal | ✅ | Resend : ≥ 5 échecs sur un même identifiant en 15 min → alerte (cooldown 24 h) — **testé le 01/08/2026 : email délivré** (`delivered`), sujet « [ESCEN] Alerte sécurité » |
| **Journalisation enrichie** | ✅ | Colonne `signals` (text[]) : signaux d'automatisation stockés à chaque tentative + page `/admin/logs` avec filtres (résultat, type d'erreur, signaux, identifiant, période) + **modale de détail** par vérification — testé via API |
| **Page Alertes fraude** | ✅ | `/admin/fraude` + API `/api/admin/fraude` : identifiants ciblés, tentatives, IP, date — testé via API |
| **Notifications email de vérification** | ✅ | Resend : l'**étudiant** est prévenu à **chaque** vérification réussie (réactivité). L'**admin** reçoit un **récapitulatif quotidien** (table `email_digests`, au plus 1/24 h — total, succès, échecs, robots + dernières vérifications), déclenché sans cron par le premier passage du jour (fonctionne en dev et Vercel) |
| **Filigrane anti-capture de traçabilité** | ✅ | `verificationId` renvoyé par `/api/verify` → filigrane en diagonale (date + réf.) répété sur le document affiché. Toute capture diffusée est rattachable à la vérification d'origine dans l'historique (colonne générée `id_text` pour la recherche par référence) — **testé** (verificationId présent en réponse, retrouvé dans les logs admin) |
| **Email étudiant : changement de statut** | ✅ | L'étudiant est prévenu à chaque action admin sur son relevé : annulation, remplacement (avec le nom de la nouvelle version), réactivation, verrouillage/déverrouillage (via `after()`, jamais bloquant) — **testé E2E** (lock/unlock/cancel/reactivate → emails programmés, logs `lock`/`unlock`/`cancel`/`replace`/`reactivate`) |
| Export de l'historique (audit) | ✅ | API `/api/admin/verifications/export` |
| Purge RGPD après 5 ans | ✅ | **Cron pg_cron** `purge-verifications-5y` (hebdo, lundi 03:00) + cleanup `rate_limits` 24 h — idempotent, actif si pg_cron dispo |

---

## 🥉 Lot 3 — Espace d'administration

**Objectif** : la scolarité et la DSI gèrent le système sans développeur pour les tâches courantes.

| Tâche | Statut | Notes |
|---|---|---|
| Connexion sécurisée (`/admin/login`) | ✅ | RLS `is_admin()` + `admin_roles` |
| Tableau de bord avec statistiques | ✅ | `/admin/dashboard` |
| Liste + recherche des relevés | ✅ | `/admin/releves` |
| Annulation d'un relevé (fraude / erreur) | ✅ | Statut `cancelled` → `not_found` au public |
| Création manuelle d'un relevé | ✅ | `CreateReleveForm` |
| Journal des actions admin | ✅ | Table `admin_logs` (actions `create`, `cancel`, `replace`, `lock`, `unlock`, `view`, `export`) |
| Gestion du remplacement (statut `replaced`) | ✅ | Fonction SQL `resolve_active_releve` (chaîne `replaced_by` suivie côté base, SECURITY DEFINER) : le QR code d'une ancienne version affiche la version officielle à jour. Bouton « Remplacer » + validation du remplaçant (actif) dans l'admin — **testé E2E le 03/08/2026** (`scripts/test-replacement.ts`) |
| **Verrouillage / déverrouillage d'un document** | ✅ | Colonne `locked_at` : l'admin suspend temporairement la consultation (bouton dans le détail, badge « Verrouillé » dans la liste) — le visiteur voit un message sobre, le document reste valide ; `locked` exclu du compteur de fraude — **testé E2E via API** (lock → 403 `locked`, unlock → succès) |
| **Email étudiant obligatoire** | ✅ | Champ `student_email` (schéma + formulaire admin + seeds) — utilisé pour les notifications de vérification |

---

## 🏗️ Lot 4 — Infrastructure & déploiement

| Tâche | Statut | Notes |
|---|---|---|
| Schéma SQL versionné | ✅ | `supabase-schema.sql` (tables, enum, RLS, index) |
| **Appliquer le schéma à jour** (fraud_alerts + attempted_id + student_email + locked_at + signals + email_digests) | ✅ | `npm run setup-db` OK (05/08/2026) — correctifs idempotents `ALTER TABLE IF NOT EXISTS` + colonnes `signals` (text[]) + table `email_digests` |
| **Seed des données de test** | ✅ | `npm run seed` OK (6 étudiants + admin + 7 vérifications) |
| Test de bout en bout (création → QR → vérif → alerte) | ✅ | API validée : ID valide → succès, ID invalide/court/annulé → `not_found` générique |
| Build de production | ✅ | `npm run build` OK (toutes routes compilées) |
| Lint & typecheck | ✅ | `npm run lint` : **0 problème** (37 → 0 — suppression des casts `as any` par typage réel, correction `react-hooks/refs`, `<Link>` login, entités échappées, code mort supprimé) + `tsc --noEmit` : **0 erreur** |
| Déploiement Vercel + domaine `verif.escen-university.fr` | ⏳ | Domaine décidé, réservation à confirmer |
| Vérification domaine Resend (`alerts@escen-university.fr`) | ⏳ | En production uniquement (dev : `onboarding@resend.dev` ne livre qu'à l'adresse du compte — **testé**) |
| Récupération automatique des relevés (API scolarité) | ⏳ | Nécessite un échange avec l'équipe scolarité |
| API `/api/notify` (formulaire email de l'accueil) | ✅ | Route implémentée (idempotent, rate limiting) — voir `src/app/api/notify/route.ts` |
| Mise à jour du `README.md` | ✅ | Documente l'ensemble du système (pages, API, sécurité, config) |

---

## ✅ Décisions actées

| # | Décision | Lot |
|---|---|---|
| 1 | CAPTCHA **dès le lancement** (pas seulement en cas d'abus) | 1 |
| 2 | Historique des vérifications conservé **5 ans**, puis purge automatique | 2 |
| 3 | Domaine de vérification : `verif.escen-university.fr` | 4 |
| 4 | Alertes anti-fraude par email (Resend) vers la scolarité / DSI | 2 |
| 5 | **PDF jamais public** : l'accès nécessite une session admin ; la page publique est en consultation seule (anti-capture) | 1 |
| 6 | **Notifications de vérification** : étudiant (champ email obligatoire) + admin, à chaque succès | 2 |
| 7 | **Verrouillage** : suspension temporaire avec message sobre (≠ annulation, ≠ 404 générique) | 3 |
| 8 | **Icônes** : Google Material Symbols partout (fini les emojis) | 1 |
| 9 | **Filigrane anti-capture** : trace de vérification (date + réf.) sur le document — dissuasif et traçable | 2 |
| 10 | **Récapitulatif admin quotidien** (au lieu d'un email par vérification) ; étudiant notifié immédiatement | 2 |
| 11 | **Étudiant informé de tout changement de statut** de son relevé (annulation, remplacement, verrouillage) | 3 |

## ❓ Questions restées ouvertes (cahier des charges §8)

- ~~Téléchargement PDF autorisé au public ?~~ → **Acté : non** (consultation seule, PDF admin)
- ~~Site en français seulement ou bilingue ?~~ → **Acté : FR + EN**
- Montrer toutes les notes ou un résumé (moyenne, mention) ?
- Information supplémentaire demandée au recruteur (nom, date de naissance) ?
- Volume annuel de relevés (dimensionnement) ?

---

## 🚀 Prochaine action (recommandée)

1. **Obtenir les clés Cloudflare Turnstile** (dash.cloudflare.com → Turnstile) et les mettre dans `.env.local` → active le CAPTCHA
2. ~~Déclencher l'alerte anti-fraude~~ ✅ **Fait le 01/08/2026** (email délivré) — en prod : remettre `RESEND_ALERT_TO` sur la scolarité/DSI + vérifier le domaine Resend
3. Déployer sur Vercel + domaine `verif.escen-university.fr`

---

## 🗂️ Correspondance GitHub Issues

Chaque lot ci-dessus correspond à un **milestone GitHub**. Les tâches `⏳` non terminées seront ouvertes en Issues au fur et à mesure :

- **Milestone « Lot 1 — Page publique »** : CAPTCHA, mesure de performance
- **Milestone « Lot 2 — Traçabilité »** : purge RGPD 5 ans
- **Milestone « Lot 3 — Admin »** : ✅ flux de remplacement terminé (aucune issue ouverte)
- **Milestone « Lot 4 — Déploiement »** : setup-db + seed, test E2E, Vercel, domaine, API scolarité, /api/notify, README

---

## 🗓️ Journal des sessions

| Date | Contenu | Commit |
|---|---|---|
| 05/08/2026 | **Travail complet** : icônes Google Material Symbols (composant `Icon`, toutes les pages) · champ `student_email` obligatoire + notifications email (étudiant immédiat, **digest admin quotidien** via table `email_digests`) · **verrouillage de document** (colonne `locked_at`, UI admin, code `locked` public) · **journalisation enrichie** (signaux bots stockés, filtres + détail dans `/admin/logs`, page `/admin/fraude`) · **filigrane anti-capture** (verificationId traçable, recherche par `id_text`) · **emails étudiant de changement de statut** (annulation/remplacement/réactivation/verrouillage) · masquage RGPD de l'email dans les réponses publiques · schéma appliqué (setup-db) · README + SUIVI + cahier des charges mis à jour | — |
| 03/08/2026 | Flux de remplacement « QR code éternel » (`resolve_active_releve`, test E2E 6/6, bouton « Remplacer » admin, bandeau « version mise à jour ») + **nettoyage lint complet (37 → 0)** + génération du CR JOURNÉE 3 | `07c4b0b` |
| 01/08/2026 | Alerte anti-fraude testée (email Resend délivré), CAPTCHA Turnstile, purge RGPD 5 ans, setup-db + seed | — |
