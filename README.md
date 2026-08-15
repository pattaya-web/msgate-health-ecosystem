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

## Identifiants de démonstration

| Rôle | Email | Mot de passe |
|------|-------|--------------|
| Admin | `admin@msgate.internal` | `demo1234` |
| Operator | `operator@msgate.internal` | `demo1234` |
| Viewer | `viewer@msgate.internal` | `demo1234` |

- **Admin** : accès total
- **Operator** : peut modifier incidents, alertes et KPI
- **Viewer** : lecture seule

L’auth demo fonctionne via `localStorage` sans Supabase. Branchez Supabase Auth ensuite avec les variables `NEXT_PUBLIC_SUPABASE_*`.

## Variables d’environnement

Voir `.env.example` :

- `DATA_PROVIDER=mock` (ou `airtable` plus tard)
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, tables IBO/BANK/MID/SOP (server-only)

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
