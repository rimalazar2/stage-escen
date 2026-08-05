# ESCEN — Vérification sécurisée des relevés de notes

Système de vérification par **QR code** des relevés de notes ESCEN : une page publique de contrôle d'authenticité, un espace d'administration complet, une traçabilité totale et une protection anti-fraude.

Built with **Next.js 16**, **TypeScript**, **Tailwind CSS v4** et **Supabase**.

## Stack

- **Framework:** Next.js 16 (App Router, convention `proxy`)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4 (design system ESCEN : navy `#1D2B6B`, cyan `#00B7D9`)
- **Base de données:** Supabase (PostgreSQL + RLS + cron de purge RGPD)
- **Email:** Resend (alertes anti-fraude + notification étudiant + récapitulatif admin quotidien)
- **Anti-robot:** Cloudflare Turnstile + détection d'automatisation (signaux client + User-Agent)
- **Icônes:** Google Material Symbols (remplacent les emojis)

## Pages

| Route | Description |
|---|---|
| `/` | Page d'accueil — compte à rebours + formulaire de notification au lancement (`/api/notify`) |
| `/verify` | Vérification publique par identifiant (UUID ou QR code) |
| `/verify/[id]` | Résultat de vérification d'un relevé |
| `/admin/login` | Connexion administrateur (Supabase Auth) |
| `/admin/dashboard` | Statistiques (relevés actifs/annulés, vérifications, aujourd'hui) |
| `/admin/releves` | Gestion des relevés (création, annulation, remplacement, **verrouillage**) |
| `/admin/logs` | Historique des vérifications (filtres enrichis, signaux bots, détail) |
| `/admin/fraude` | Alertes anti-fraude (identifiants ciblés par des tentatives répétées) |

## API

| Route | Méthode | Rôle |
|---|---|---|
| `/api/verify` | POST | Vérifie un identifiant + journalise la tentative (rate limiting + CAPTCHA + détection fraude/bots) ; renvoie un `verificationId` pour le filigrane |
| `/api/releve/[id]` | GET | Détail d'un relevé actif |
| `/api/releve/[id]/qrcode` | GET | QR code du relevé (PNG) |
| `/api/releve/[id]/pdf` | GET | PDF officiel du relevé (**admin uniquement** — session requise) |
| `/api/notify` | POST | Inscription email « me notifier au lancement » (idempotent, rate limiting) |
| `/api/admin/login` | POST / DELETE | Connexion / déconnexion admin |
| `/api/admin/releves` | GET / POST | Liste / création des relevés |
| `/api/admin/releves/[id]` | GET / PATCH / DELETE | Détail / modification / suppression |
| `/api/admin/releves/[id]/status` | PUT | Annulation / remplacement / réactivation / **verrouillage** — l'étudiant est prévenu par email à chaque changement |
| `/api/admin/stats` | GET | Statistiques du dashboard |
| `/api/admin/verifications` | GET | Historique des vérifications (filtres : résultat, erreur, signaux, période, identifiant) |
| `/api/admin/verifications/export` | GET | Export CSV (audit) |
| `/api/admin/fraude` | GET | Liste des alertes anti-fraude |

## Sécurité & anti-fraude

- **Réponses génériques** : un relevé annulé ou inconnu renvoie le même `not_found` (aucun indice au fraudeur)
- **QR code « éternel »** : une ancienne version remplacée continue de fonctionner — elle affiche la version officielle à jour (fonction SQL `resolve_active_releve`, chaîne `replaced_by`)
- **Rate limiting** par IP (table `rate_limits`, fenêtre glissante + blocage 5 min)
- **CAPTCHA Turnstile** avant le rate limiting (les robots ne consomment pas de quota)
- **Détection d'automatisation / scraping** : signaux client (`navigator.webdriver`, marqueurs ChromeDriver, UA headless, payload absent…) → 403 `bot_detected`, IP bloquée 5 min, signaux journalisés
- **Détection de fraude** : ≥ 5 échecs sur un même identifiant en 15 min → email d'alerte à la scolarité/DSI (cooldown 24 h / identifiant)
- **Verrouillage de document** : l'admin peut suspendre temporairement la consultation (litige, examen) — le visiteur voit un message sobre, le document n'est ni annulé ni modifié
- **Consultation seule** : la page publique est en lecture seule — clic droit, sélection, impression et raccourcis bloqués ; l'accès PDF exige une session admin (404 générique sinon)
- **Filigrane anti-capture traçable** : date + référence de vérification répétées en diagonale sur le document — toute capture diffusée peut être reliée à la vérification d'origine dans l'historique
- **Notifications email** (Resend) : l'étudiant est prévenu immédiatement à chaque vérification **et à chaque changement de statut de son relevé** (annulation, remplacement, réactivation, verrouillage) ; l'administration reçoit un **récapitulatif quotidien** (total, succès, échecs, robots — au plus 1 email/24 h, sans cron)
- **IP hachées** (SHA-256, RGPD), purges automatiques (vérifications > 5 ans, rate_limits > 24 h)
- **RLS** : les relevés actifs sont publics ; tout le reste (vérifications, logs, fraud_alerts, subscribers) est réservé aux admins
- **`proxy.ts`** protège toutes les routes `/admin` (redirection vers le login si non connecté)

## Guide de déploiement (Vercel)

1. **Base de données** : créez un projet [Supabase](https://supabase.com) puis appliquez le schéma :
   ```bash
   npx tsx scripts/setup-db.ts   # exécute supabase-schema.sql (idempotent) + rôle admin
   npx tsx scripts/seed.ts       # (optionnel) données de test
   ```
2. **Réseau / secrets** : sur le dashboard Vercel, ajoutez les variables d'env `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `RESEND_EMAIL_FROM`, `RESEND_ALERT_TO`, `NEXT_PUBLIC_SITE_URL`.
3. **Domaine** : pointez le domaine vers Vercel (ex. `verif.escen-university.fr`) et renseignez `NEXT_PUBLIC_SITE_URL`.
4. **Emails** : vérifiez le domaine Resend en production (le mode dev `onboarding@resend.dev` ne livre qu'à l'adresse du compte) et mettez `RESEND_ALERT_TO` sur la boîte de la scolarité/DSI.
5. **CAPTCHA** : créez les clés Cloudflare Turnstile (dash.cloudflare.com → Turnstile) et configurez les DEUX clés ensemble.
6. **Cron de purge RGPD** : activez l'extension `pg_cron` dans le dashboard Supabase (les jobs de purge sont créés automatiquement par le schéma).

## Configuration (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<clé anon>
SUPABASE_SERVICE_ROLE_KEY=<clé service role>
SUPABASE_DB_PASSWORD=<mot de passe base>          # setup-db.ts
NEXT_PUBLIC_SITE_URL=https://...
RESEND_API_KEY=<clé Resend>
RESEND_EMAIL_FROM=alerts@escen-university.fr      # domaine vérifié en prod
RESEND_ALERT_TO=<scolarité/DSI>
TURNSTILE_SECRET_KEY=<secret>                     # production
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key>         # production
ADMIN_SEED_EMAIL=admin@escen.university
ADMIN_SEED_PASSWORD=<mot de passe admin>
```

## Dev

```bash
npm install
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000).

## Scripts

```bash
npx tsx scripts/setup-db.ts          # applique supabase-schema.sql (idempotent) + rôle admin
npx tsx scripts/seed.ts              # données de test (6 étudiants, vérifications, admin)
npx tsx scripts/test-replacement.ts  # test E2E du flux de remplacement (QR « éternel »)
```

## Build

```bash
npm run build
npm start
```

## Design

- **Style:** Academic Minimalism + Digital Premium
- **Palette:** Bleu marine (#1D2B6B), Cyan (#00B7D9), gris neutre
- **Typographie:** Inter, sereine et lisible
- **Accessibilité:** WCAG AA, `aria-live`, `prefers-reduced-motion`

## Documentation

- [Cahier des charges](docs/Cahier_des_charges_QRCode_Verification.md)
- [Schéma SQL](supabase-schema.sql)
