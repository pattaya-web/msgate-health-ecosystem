# MSGate Health Ecosystem

Cockpit interne de pilotage opérationnel : santé système, infrastructure, alertes, recovery, SOP et KPI business hebdomadaires.

Airtable reste la source de vérité détaillée. Cette app est un dashboard de synthèse.

## Stack

- Next.js (App Router) + TypeScript
- Tailwind CSS + composants style shadcn/ui
- Lucide Icons + Recharts
- Zod + React Hook Form
- Supabase (schéma + auth prêts)
- Couche `IDataProvider` avec `MockDataProvider` (actif) et `AirtableDataProvider` (prêt)

## Installation

```bash
npm install --legacy-peer-deps
cp .env.example .env.local
npm run dev
```

Ouvrir [http://localhost:3000](http://localhost:3000).

## Authentification

Les comptes sont définis côté serveur, dans `AUTH_USERS`, avec des mots de passe
hachés (scrypt). Le login pose un cookie de session signé par `AUTH_SECRET` ;
toute route `/api/*` exige ce cookie, sauf le cron `/api/sav/digest` et les
deux appels publics des boutiques (formulaire de contact, commande). Un compte
`viewer` ne peut faire que des lectures ; une mutation venue d'une autre origine
est refusée.

```bash
# Secret de signature (32 caractères minimum)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# Hash d'un mot de passe, à coller dans AUTH_USERS
echo -n 'le mot de passe' | node scripts/hash-password.mjs
```

`AUTH_USERS` est un tableau JSON sur une ligne :
`[{"email":"admin@example.com","role":"admin","hash":"$scrypt$…"}]`, rôles
`admin`, `operator` ou `viewer`. Dans `.env.local`, échappe les `$` du hash en
`\$` (Next développe les `$` comme des variables) ; dans Vercel, colle le hash
tel quel. En production les deux variables sont obligatoires. En développement local, sans `AUTH_USERS`, les comptes de
démonstration (`admin@msgate.internal` / `demo1234`, operator, viewer) restent
utilisables.

## Variables d’environnement

Voir `.env.example` :

- `DATA_PROVIDER=mock` (ou `airtable` plus tard)
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, tables IBO/BANK/MID/SOP (server-only)

## SAV

La page `/sav` lit la boîte support en IMAP. L'agent SAV répondant depuis le
webmail, le dossier « Envoyés » du serveur est la seule trace de son activité :
INBOX et Sent sont lus ensemble puis fusionnés en fils.

### Lecture de la boîte (obligatoire)

| Variable | Rôle |
|---|---|
| `SAV_IMAP_HOST` | Serveur IMAP (ex. `mail.privateemail.com` chez Namecheap) |
| `SAV_IMAP_USER` | Adresse complète de la boîte support |
| `SAV_IMAP_PASSWORD` | Mot de passe de la boîte |
| `SAV_IMAP_PORT` | `993` par défaut (TLS implicite) |
| `SAV_TEAM_ADDRESSES` | Adresses maison supplémentaires, séparées par des virgules — tout le reste est considéré comme « le client » |

Sans les trois premières, `/sav` répond « SAV non configuré » et n'ouvre aucune
connexion.

### Analyse de cohérence

Le bouton **Analyser** fait relire par Claude chaque échange « demande client →
réponse SAV » et rend un verdict : `ok`, `partial` (une partie de la demande
reste sans réponse) ou `off` (la réponse tombe à côté). L'appel passe par le
même passe-plat Kie que les copies Meta, donc rien à configurer en plus de
`KIE_API_KEY`. Les verdicts sont gardés une heure par fil et ne sont recalculés
que si le fil a bougé.

### Alertes Telegram

| Variable | Rôle |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Token du bot (BotFather) |
| `TELEGRAM_CHAT_ID` | Conversation ou canal destinataire |
| `CRON_SECRET` | Protège `/api/sav/digest` — sans lui la route répond 503 |
| `SAV_ALERT_HOURS` | Seuil « sans réponse » remonté dans l'alerte (12 par défaut) |
| `SAV_DIGEST_WINDOW_HOURS` | Fenêtre couverte par le digest (24 par défaut) |
| `SAV_DIGEST_ONLY_ALERTS` | `1` pour n'envoyer que s'il y a quelque chose à signaler |

Le digest quotidien est déclenché par le cron déclaré dans `vercel.json`
(`0 17 * * *` UTC, soit 19 h à Paris en été). Vercel envoie automatiquement
`Authorization: Bearer $CRON_SECRET`. Pour le tester à la main :

```bash
curl -H "x-cron-secret: $CRON_SECRET" https://<domaine>/api/sav/digest
```

## Migration Supabase

1. Créer un projet Supabase
2. Exécuter `supabase/migrations/001_initial_schema.sql` dans le SQL Editor
3. Créer les utilisateurs Auth et une ligne correspondante dans `public.users` avec le rôle
4. Renseigner `.env.local`

## Structure des dossiers

```
src/
  app/
    (app)/          # routes protégées (sidebar)
      page.tsx      # Dashboard
      ecosystem/
      recovery/
      sop/
      business/
      alerts/
      settings/
    login/
  components/
    ui/             # design system
    layout/         # sidebar + shell
    dashboard/
    shared/
  lib/
    airtable/       # client, mappers, sync, types
    auth/
    mock/           # seed data
    providers/      # IDataProvider + mock + airtable
    supabase/
    health-score.ts
  types/
supabase/migrations/
```

## Lancer le projet

```bash
npm run dev      # développement
npm run build    # build production
npm run start    # serveur production
```

## Données mockées incluses

- 8 IBO actifs (références anonymisées `IBO #n`)
- 18 banques (dont 3 en ouverture)
- 16 MIDs (dont 2 underwriting, 1 closed)
- 3 alertes actives
- 2 recovery cases
- 11 SOP
- 12 semaines de KPI business
- System Health calculé dynamiquement (~92 avec les règles demo)

## Connexion Airtable (à faire ensuite)

1. Remplir les variables `AIRTABLE_*` dans `.env.local`
2. Aligner les noms de champs Airtable avec `src/lib/airtable/mappers.ts`
3. Passer `DATA_PROVIDER=airtable`
4. Brancher `AirtableDataProvider` sur `syncFromAirtable()` dans `src/lib/airtable/sync.ts`
5. (Optionnel) Persister le résultat de sync dans Supabase

Clés Airtable : **jamais** préfixées `NEXT_PUBLIC_` — uniquement côté serveur.

## Priorités produit

1. System Health
2. Infrastructure
3. Alerts
4. Recovery
5. SOP
6. Business hebdomadaire
