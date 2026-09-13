# Hermes — couche d'accès en lecture seule

Ce dossier est la seule porte par laquelle l'agent Hermes lit le CRM.

```
Hermes  →  POST /api/hermes/tools/<name>  (Authorization: Bearer HERMES_API_KEY)
        →  src/hermes/run.ts        validation, chronométrage, journal, enveloppe
        →  src/hermes/tools/*.ts    un outil = une fonction de lecture
        →  src/lib/**               la logique métier existante, inchangée
```

## Règles

- **Lecture seule, par construction.** Un outil ne reçoit aucun store et la
  règle ESLint `no-restricted-imports` sur `src/hermes/tools/**` interdit les
  modules et fonctions d'écriture (Airtable, Meta, Phoenix refund, stores,
  fichiers, Kie). Un import interdit fait échouer le lint.
- **Clé dédiée.** `HERMES_API_KEY` dans l'environnement, 24 caractères minimum,
  comparée en temps constant. Le cookie de session des personnes n'ouvre pas
  ces routes ; la clé n'ouvre rien d'autre.
- **Aucun secret en sortie.** Les outils construisent leur JSON champ par
  champ à partir de chiffres et de libellés ; jamais de jeton, d'identifiant
  bancaire, de document, de données personnelles d'IBO ni de clé d'API.
- **Journal.** Chaque appel écrit `{ at, tool, ok, durationMs, bytes }` dans
  `.msgate-cache/hermes-audit.json` (copié dans Supabase). Ni clé, ni charge
  utile.

## Ajouter un outil

1. Créer `src/hermes/tools/<nom>.ts` exportant un `ReadonlyTool` : nom,
   description, schéma zod d'entrée, `run()` qui n'importe que des lectures.
2. L'inscrire dans `src/hermes/registry.ts`.
3. Il apparaît dans `GET /api/hermes/tools` et répond sur
   `POST /api/hermes/tools/<nom>`.

## Outils

| Outil | Rôle |
|---|---|
| `get_business_overview` | Revenus par catégorie, dépenses pub, ROAS, remboursements, chargebacks, abonnements, taux d'approbation, alertes Disputifier, boutiques et produits, sur une fenêtre de dates |
