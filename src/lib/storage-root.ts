/**
 * Le dossier où l'outil écrit ses données (data/, .msgate-cache/, .phoenix-cache/).
 *
 * Sur le PC : le dossier du projet, comme toujours. Sur Vercel, le dossier du
 * projet est en lecture seule (« ENOENT: mkdir '/var/task/data' ») : seul
 * /tmp accepte l'écriture. Ce qui y est écrit vit tant que l'instance du
 * serveur vit (quelques minutes à quelques heures), pas plus : c'est un
 * dépannage pour que les écrans marchent en ligne, pas un stockage durable.
 */
export const STORAGE_ROOT = process.env.VERCEL ? "/tmp/msgate" : process.cwd();

/** Vrai quand ce qui est écrit ne survivra pas (site en ligne) : à signaler à l'écran. */
export const EPHEMERAL_STORAGE = Boolean(process.env.VERCEL);
