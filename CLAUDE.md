@AGENTS.md

# Mise en ligne (MSGate Health Ecosystem)

- Site en ligne : https://www.mabillmafia.com (domaine Namecheap, compte scalexbyecom ; l'apex mabillmafia.com redirige vers www). Adresse Vercel de secours : https://msgate-health-ecosystem.vercel.app. Projet Vercel `madys-projects-84d03991/msgate-health-ecosystem`, plan Hobby.
- Le projet Vercel n'est relié à AUCUN dépôt Git : un `git push` ne déploie rien. On déploie depuis ce dossier, sur le PC de Mady, avec la CLI (déjà connectée sous madychaieb22-2408) :

```bash
npx -y vercel@latest --prod --yes
```

- Avant tout déploiement : `npx tsc --noEmit` puis `npm run lint` doivent passer, et `npm run build` doit réussir en local.
- Plan Hobby : `export const maxDuration` d'une route API ne doit jamais dépasser 300 (le déploiement est refusé au-delà). 600 a été refusé le 31/10/2026.
- Variables d'environnement de prod : Vercel → Settings → Environment Variables (jamais dans le code). `APP_HOSTS=mabillmafia.com,www.mabillmafia.com` y est posé ; `src/proxy.ts` connaît déjà le domaine via `TOOL_DOMAIN`.
- Après déploiement, vérifier : https://www.mabillmafia.com (200), /login (200), et que https://mabillmafia.com redirige en 308 vers www.
- Secrets : `.env.local` (ignoré par git) ; ne jamais lire ni coller ses valeurs dans une réponse.
