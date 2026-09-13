import { mkdir, readdir, readFile, rename, rm, writeFile } from "fs/promises";
import path from "path";
import { persistJson, readMirror } from "@/lib/storage";
import { defaultEcomSite, type EcomSite } from "@/lib/ecom-sites/types";

const CACHE_DIR = path.join(process.cwd(), ".msgate-cache");
const CACHE_FILE = path.join(CACHE_DIR, "ecom-sites.json");
/** Le fichier d'avant chaque écriture, pour pouvoir revenir en arrière. */
const BACKUP_FILE = path.join(CACHE_DIR, "ecom-sites.bak.json");
/** Les dix derniers états ayant perdu des entrées, datés. */
const HISTORY_DIR = path.join(CACHE_DIR, "ecom-sites-history");

type Store = { sites: EcomSite[] };

/*
 * L'état ET le drapeau de chargement vivent sur globalThis.
 *
 * `mem` y était déjà, mais `loaded` était une variable de module — donc remise
 * à false à chaque rechargement à chaud, c'est-à-dire à chaque fichier édité en
 * développement. La lecture repartait alors et REMPLAÇAIT la mémoire par le
 * disque. Quand le disque avait pris du retard — une écriture concurrente qui
 * avait échoué sur le `.tmp` partagé — les sites absents du fichier
 * disparaissaient de la mémoire, et l'écriture suivante gravait cette perte.
 * Deux catalogues y sont passés. Les deux valeurs doivent donc avoir la même
 * durée de vie.
 */
type Shared = { store: Store; loaded: boolean; queue: Promise<unknown> };

const globals = globalThis as typeof globalThis & {
  /** Forme d'avant : le store posé directement, sans drapeau ni file. */
  __msgateEcomSites?: Store | Shared;
};

/*
 * La forme a changé, la mémoire vivante ne doit pas être jetée pour autant.
 *
 * En développement le processus tourne pendant des jours : au moment du
 * déploiement de ce fichier, la clé porte encore l'ancien objet, et ses sites
 * n'existent peut-être plus que là. On l'adopte au lieu de repartir de zéro.
 */
const legacy = globals.__msgateEcomSites;
const state: Shared =
  legacy && "store" in legacy
    ? legacy
    : {
        store: legacy && Array.isArray((legacy as Store).sites) ? (legacy as Store) : { sites: [] },
        // Une reprise n'est pas une lecture : le disque reste la référence.
        loaded: false,
        queue: Promise.resolve(),
      };
globals.__msgateEcomSites = state;

const mem = state.store;

export function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "site"
  );
}

function uid() {
  return `es-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Lecture du store, sans jamais détruire ce qu'on a déjà.
 *
 * La version précédente faisait `catch { mem.sites = [] }` puis `loaded = true`.
 * Un seul raté de lecture — et sous Windows un EBUSY pendant le `rename` d'un
 * `persist()` concurrent est courant — vidait la mémoire et la déclarait
 * chargée. La première écriture suivante recopiait ce vide sur le disque et
 * jusque dans le miroir Supabase. Un dossier de sites a été perdu comme ça.
 *
 * Désormais seul un fichier réellement absent vaut « store vide ». Toute autre
 * erreur laisse la mémoire intacte et ne marque rien comme chargé : la lecture
 * sera retentée, et rien ne s'écrase entre-temps.
 */
async function load(): Promise<Store> {
  if (state.loaded) return mem;
  try {
    const raw = await readFile(CACHE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Store;
    const fromDisk = Array.isArray(parsed.sites) ? parsed.sites : [];

    /*
     * Le disque complète la mémoire, il ne la remplace pas.
     *
     * La mémoire ne peut être qu'en avance : toute modification passe par une
     * écriture, et une suppression retire l'entrée ici avant d'écrire. Un
     * fichier plus court que la mémoire signale donc une écriture perdue, pas
     * une suppression — et l'écraser gravait la perte. On garde ce qu'on a, on
     * ajoute ce que le fichier apporte en plus.
     */
    const known = new Set(mem.sites.map((site) => site.id));
    mem.sites = [...mem.sites, ...fromDisk.filter((site) => !known.has(site.id))];
    state.loaded = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      /* Pas de fichier : premier démarrage sur cette machine, ou un hébergeur
         au disque vide (Vercel). La copie Supabase, si elle existe, fait foi. */
      const remote = await readMirror(CACHE_FILE);
      if (remote) {
        try {
          const parsed = JSON.parse(remote) as Store;
          const known = new Set(mem.sites.map((site) => site.id));
          mem.sites = [...mem.sites, ...(Array.isArray(parsed.sites) ? parsed.sites : []).filter((site) => !known.has(site.id))];
        } catch {
          // Copie illisible : on part de ce qu'on a en mémoire.
        }
      }
      state.loaded = true;
    }
    // Sinon : on garde la mémoire telle quelle et on retentera au prochain appel.
  }
  return mem;
}

/**
 * Écriture, avec un filet.
 *
 * Le fichier précédent est conservé en `.bak` avant chaque remplacement : si un
 * jour une écriture part quand même de travers, il reste de quoi revenir en
 * arrière au lieu de constater la perte.
 */
async function writeStore() {
  // Un disque en lecture seule (hébergeur) n'empêche pas d'écrire : la copie Supabase prend le relais plus bas.
  await mkdir(CACHE_DIR, { recursive: true }).catch(() => undefined);

  /*
   * Un store vidé n'écrase pas un fichier plein tant qu'on n'a pas relu.
   *
   * C'est la dernière barrière : supprimer le dernier site est légitime, mais
   * cela passe par `load()` d'abord, donc `loaded` est vrai. Une mémoire vide
   * jamais chargée, elle, n'est pas une suppression — c'est un accident.
   */
  if (!mem.sites.length && !state.loaded) return;

  const payload = JSON.stringify({ sites: mem.sites }, null, 2);

  /*
   * Un historique, pas une seule sauvegarde.
   *
   * Le `.bak` unique était écrasé à l'écriture suivante : deux enregistrements
   * après un accident, il ne restait plus rien à restaurer. Les dix derniers
   * états sont gardés, datés, et seulement quand le contenu rétrécit — c'est le
   * seul cas où l'on veut pouvoir revenir en arrière.
   */
  try {
    const previous = await readFile(CACHE_FILE, "utf8");
    if (previous.trim() && previous !== payload) {
      await writeFile(BACKUP_FILE, previous);
      const before = (JSON.parse(previous) as Store).sites?.length ?? 0;
      if (before > mem.sites.length) {
        await mkdir(HISTORY_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        await writeFile(path.join(HISTORY_DIR, `ecom-sites-${stamp}-${before}.json`), previous);
        const kept = (await readdir(HISTORY_DIR)).sort().slice(0, -10);
        await Promise.all(kept.map((name) => rm(path.join(HISTORY_DIR, name)).catch(() => {})));
      }
    }
  } catch {
    // Pas de fichier précédent à sauver : rien à faire.
  }

  /*
   * Un fichier temporaire par écriture.
   *
   * Elles partageaient toutes le même `.tmp` : deux écritures qui se
   * chevauchent, et la première renomme le fichier de la seconde, qui échoue
   * alors sur un fichier absent. Son contenu était perdu, le disque restait en
   * retard, et le rechargement suivant ramenait ce retard en mémoire.
   */
  await persistJson(CACHE_FILE, payload, async () => {
    const tmp = `${CACHE_FILE}.${process.pid}.${Date.now().toString(36)}.tmp`;
    await writeFile(tmp, payload);
    await rename(tmp, CACHE_FILE);
  });
}

/**
 * Les écritures se suivent au lieu de se croiser.
 *
 * Deux requêtes qui enregistrent en même temps — ce qui arrive dès qu'une
 * génération se termine pendant qu'on tape — lançaient deux `persist()`
 * entrelacés. La file les sérialise : chacune attend la précédente.
 */
function persist() {
  state.queue = state.queue.then(writeStore, writeStore);
  return state.queue;
}

export async function listEcomSites() {
  const store = await load();
  return [...store.sites].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getEcomSite(id: string) {
  const store = await load();
  return store.sites.find((site) => site.id === id) || null;
}

export async function getEcomSiteBySlug(slug: string) {
  const store = await load();
  return store.sites.find((site) => site.slug === slug) || null;
}

/** Une requête arrivant sur un domaine client est routée vers le bon site. */
export async function getEcomSiteByDomain(host: string) {
  const store = await load();
  const clean = host.toLowerCase().replace(/^www\./, "").replace(/:\d+$/, "");
  return store.sites.find((site) => site.domain.toLowerCase().replace(/^www\./, "") === clean) || null;
}

export async function createEcomSite(input: Partial<EcomSite> & { brandName: string }) {
  const store = await load();
  const now = new Date().toISOString();
  let slug = slugify(input.slug || input.brandName);
  const taken = new Set(store.sites.map((site) => site.slug));
  if (taken.has(slug)) slug = `${slug}-${uid().slice(-4)}`;

  const site: EcomSite = {
    ...defaultEcomSite(),
    ...input,
    id: uid(),
    slug,
    createdAt: now,
    updatedAt: now,
    brandName: input.brandName.trim(),
  };
  store.sites.unshift(site);
  await persist();
  return site;
}

export async function updateEcomSite(id: string, patch: Partial<EcomSite>) {
  const store = await load();
  const site = store.sites.find((item) => item.id === id);
  if (!site) return null;
  Object.assign(site, patch, { updatedAt: new Date().toISOString(), id: site.id, slug: site.slug });
  await persist();
  return site;
}

/** Duplique un site pour en ouvrir un nouveau sans ressaisir la structure. */
export async function cloneEcomSite(id: string, brandName: string) {
  const source = await getEcomSite(id);
  if (!source) return null;
  const copy: Partial<EcomSite> = { ...source };
  // Le nouveau site prend sa propre identité : domaine et descripteur sont
  // repartis à vide plutôt que de dupliquer ceux d'une autre LLC.
  delete copy.id;
  delete copy.slug;
  delete copy.createdAt;
  delete copy.updatedAt;
  return createEcomSite({ ...copy, brandName, domain: "", billingDescriptor: "" });
}

export async function deleteEcomSite(id: string) {
  const store = await load();
  const next = store.sites.filter((site) => site.id !== id);
  if (next.length === store.sites.length) return false;
  store.sites = next;
  await persist();
  return true;
}
