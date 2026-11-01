@AGENTS.md

# Mise en ligne (MSGate Health Ecosystem)

- Site en ligne : https://www.mabillmafia.com, servi depuis le 01/11/2026 par le VPS Hostinger `srv1998631.hstgr.cloud` (185.97.146.171) avec **Coolify**, à côté de mvdyprince.fr. DNS chez Namecheap (compte scalexbyecom) : A `@` et A `www` → 185.97.146.171 ; Coolify sert le https et redirige l'apex vers www.
- Application Coolify « msgate » (UUID `mruzxrpvi1pzpeucwalktgsr`), dépôt public `pattaya-web/msgate-health-ecosystem`, branche `main`, construite avec le `Dockerfile` (Next en `output: "standalone"`).
- Données sur disque persistant : `/data/msgate/{data,msgate-cache,phoenix-cache}` → `/app/data`, `/app/.msgate-cache`, `/app/.phoenix-cache` (dossiers à l'uid 1000, l'image tourne en `node`). Le serveur fait foi : ne jamais recopier les données du PC par-dessus après la bascule.
- Déployer : pousser `main` sur GitHub, puis depuis ce dossier :

```bash
node scripts/deploy.mjs
```

  (jeton API lu dans `~/.msgate-coolify-token`, jamais dans le dépôt ; il expire 30 jours après sa création, le 01/12/2026 environ : en recréer un dans Coolify → Keys & Tokens, droits read + write + deploy.)
- Avant tout déploiement : `npx tsc --noEmit` puis `npm run lint` doivent passer.
- Variables d'environnement de prod : Coolify → application msgate → Environment Variables (ou l'API). Toute valeur contenant `$` (AUTH_USERS) doit être marquée « littérale » (`is_literal`), sinon Coolify mange les `$` et la connexion casse. `PUBLIC_BASE_URL` et `MEDIA_PUBLIC_URL` = https://www.mabillmafia.com.
- Après déploiement, vérifier : https://www.mabillmafia.com (200), /login (200), https://mabillmafia.com redirige vers www, et `/api/auth/version` renvoie une version `local-…` (build du serveur).
- L'ancien projet Vercel (`madys-projects-84d03991/msgate-health-ecosystem`) n'est plus servi par le domaine ; ne plus y déployer.
- Secrets : `.env.local` (ignoré par git) ; ne jamais lire ni coller ses valeurs dans une réponse.
