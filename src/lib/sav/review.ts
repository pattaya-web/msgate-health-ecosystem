import { kieClaude } from "@/lib/studio/kie";
import { fetchSavBodies } from "@/lib/sav/imap";
import type {
  SavExchangeReview,
  SavMessage,
  SavThread,
  SavThreadReview,
  SavVerdict,
} from "@/lib/sav/types";

/**
 * Contrôle de cohérence des réponses SAV.
 *
 * Le board mesure déjà le volume et les délais ; ce qu'il ne dit pas, c'est si
 * la réponse envoyée répond vraiment à la question posée. Chaque échange
 * « ce que le client demande → ce que le SAV répond » est soumis à Claude via
 * le même passe-plat que les copies Meta (cf. lib/studio/kie).
 */

/** Au-delà, on ne juge que les échanges les plus récents du fil. */
const MAX_EXCHANGES = 6;
/** Les mails SAV traînent des signatures et des historiques cités : on tronque. */
const MAX_CHARS = 2000;
/** Un verdict ne change plus tant que le fil n'a pas bougé. */
const CACHE_TTL_MS = 60 * 60 * 1000;

const VERDICTS = new Set<SavVerdict>(["ok", "partial", "off"]);
const SEVERITY: Record<SavVerdict, number> = { ok: 0, partial: 1, off: 2 };

type Entry = { at: number; value: SavThreadReview };

const cache = ((globalThis as typeof globalThis & {
  __msgateSavReviews?: Map<string, Entry>;
}).__msgateSavReviews ??= new Map<string, Entry>());

const cacheKey = (thread: SavThread) => `${thread.id}:${thread.lastMessageAt}`;

export function findCachedReview(thread: SavThread): SavThreadReview | null {
  const hit = cache.get(cacheKey(thread));
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) return null;
  return hit.value;
}

/**
 * Un client qui relance trois fois avant d'obtenir une réponse n'a pas eu trois
 * échanges, il en a eu un : les messages consécutifs de même sens sont donc
 * regroupés, et la réponse est jugée face à l'ensemble de ce qui précède.
 */
type Exchange = { asked: SavMessage[]; replied: SavMessage[] };

export function pairExchanges(messages: SavMessage[]): Exchange[] {
  const exchanges: Exchange[] = [];
  let asked: SavMessage[] = [];
  let replied: SavMessage[] = [];

  const flush = () => {
    if (asked.length && replied.length) exchanges.push({ asked, replied });
    asked = [];
    replied = [];
  };

  for (const message of messages) {
    if (message.direction === "in") {
      // Un nouvel entrant après une réponse ouvre l'échange suivant.
      if (replied.length) flush();
      asked.push(message);
    } else if (asked.length) {
      replied.push(message);
    }
    // Un sortant sans entrant qui le précède (relance à froid) n'est pas jugeable.
  }
  flush();

  return exchanges;
}

/** Enlève l'historique cité et la signature : seul le message du jour compte. */
function cleanBody(raw: string) {
  const withoutQuotes = raw
    .split(/\n/)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");

  return withoutQuotes
    .split(/^\s*(-- |__+\s*$|On .{0,80} wrote:|Le .{0,80} a écrit\s*:)/m)[0]
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CHARS);
}

function buildPrompt(thread: SavThread, exchanges: Exchange[], bodies: Map<string, string>) {
  const blocks = exchanges.map((exchange, index) => {
    const asked = exchange.asked
      .map((message) => cleanBody(bodies.get(message.id) || message.body || message.preview || ""))
      .filter(Boolean)
      .join("\n---\n");
    const replied = exchange.replied
      .map((message) => cleanBody(bodies.get(message.id) || message.body || ""))
      .filter(Boolean)
      .join("\n---\n");

    return `## Échange ${index + 1}\n\nCLIENT :\n${asked || "(vide)"}\n\nRÉPONSE SAV :\n${replied || "(vide)"}`;
  });

  return `Tu contrôles la qualité d'un service après-vente e-commerce. Pour chaque échange ci-dessous, juge si la RÉPONSE SAV répond réellement à ce que le CLIENT demande.

Verdicts possibles :
- "ok" : la réponse traite la demande, même brièvement.
- "partial" : la réponse traite une partie de la demande et en laisse une autre sans réponse.
- "off" : la réponse est à côté du sujet, contredit le message du client, ou répond à une autre question.

Règles de jugement :
- Juge le fond, pas le ton, la longueur, l'orthographe ni la politesse.
- Une réponse courte mais juste est "ok".
- Une réponse type/copiée-collée qui tombe juste reste "ok" ; si elle ignore la question posée, c'est "off".
- Un accusé de réception qui annonce un traitement à venir est "ok" si le client demandait un délai, "partial" s'il posait une question précise restée sans réponse.
- Le client écrit parfois mal ou dans une autre langue : juge l'intention.

Objet du fil : ${thread.subject}

${blocks.join("\n\n")}

Réponds UNIQUEMENT par un tableau JSON, un objet par échange, dans l'ordre :
[{"exchange": 1, "verdict": "ok|partial|off", "reason": "une phrase en français, factuelle, qui dit ce qui manque ou pourquoi c'est à côté"}]
Pour un verdict "ok", "reason" peut rester une phrase courte.`;
}

/** Le modèle encadre parfois son JSON de texte ou de balises Markdown. */
function parseVerdicts(raw: string, expected: number) {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) throw new Error("Analyse illisible");

  const parsed = JSON.parse(raw.slice(start, end + 1)) as Array<{
    exchange?: number;
    verdict?: string;
    reason?: string;
  }>;
  if (!Array.isArray(parsed)) throw new Error("Analyse illisible");

  // Un verdict hors nomenclature est écarté plutôt que ramené à « ok » :
  // mieux vaut un échange non jugé qu'un échange déclaré bon à tort.
  return parsed
    .slice(0, expected)
    .map((row, index) => ({
      index: typeof row.exchange === "number" ? row.exchange - 1 : index,
      verdict: row.verdict as SavVerdict,
      reason: (row.reason || "").toString().trim().slice(0, 300),
    }))
    .filter((row) => VERDICTS.has(row.verdict));
}

export async function reviewThread(
  thread: SavThread,
  options: { force?: boolean } = {}
): Promise<SavThreadReview> {
  if (!options.force) {
    const cached = findCachedReview(thread);
    if (cached) return cached;
  }

  const all = pairExchanges(thread.messages);
  // Les échanges anciens ont déjà été jugés lors des passages précédents.
  const exchanges = all.slice(-MAX_EXCHANGES);

  const empty: SavThreadReview = {
    threadId: thread.id,
    client: thread.client,
    clientName: thread.clientName,
    subject: thread.subject,
    lastMessageAt: thread.lastMessageAt,
    reviewedAt: new Date().toISOString(),
    exchanges: [],
    worst: null,
  };
  if (!exchanges.length) return empty;

  // Les corps ne sont pas dans la liste : seuls les messages jugés sont rechargés.
  const needed = exchanges
    .flatMap((exchange) => [...exchange.asked, ...exchange.replied])
    .filter((message) => !message.body)
    .map((message) => message.id);
  const bodies = needed.length ? await fetchSavBodies(needed) : new Map<string, string>();

  const raw = await kieClaude(buildPrompt(thread, exchanges, bodies), 2000);
  const verdicts = parseVerdicts(raw, exchanges.length);

  const reviewed: SavExchangeReview[] = [];
  for (const verdict of verdicts) {
    const exchange = exchanges[verdict.index];
    if (!exchange) continue;
    reviewed.push({
      clientMessageId: exchange.asked[exchange.asked.length - 1].id,
      replyMessageId: exchange.replied[0].id,
      verdict: verdict.verdict,
      reason: verdict.reason,
    });
  }

  const worst = reviewed.reduce<SavVerdict | null>(
    (acc, row) => (acc === null || SEVERITY[row.verdict] > SEVERITY[acc] ? row.verdict : acc),
    null
  );

  const value: SavThreadReview = { ...empty, exchanges: reviewed, worst };
  cache.set(cacheKey(thread), { at: Date.now(), value });
  return value;
}

/** Le passe-plat Claude tient plusieurs appels de front sans se faire limiter. */
const CONCURRENCY = 4;

/** Les fils sans aucun aller-retour n'ont rien à juger : inutile de payer un appel. */
export function isReviewable(thread: SavThread) {
  return thread.inboundCount > 0 && thread.outboundCount > 0;
}

export async function reviewMany(
  threads: SavThread[],
  options: { force?: boolean } = {}
): Promise<{ reviews: SavThreadReview[]; failed: number }> {
  const queue = [...threads];
  const reviews: SavThreadReview[] = [];
  let failed = 0;

  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      try {
        reviews.push(await reviewThread(next, options));
      } catch {
        // Un fil illisible ne doit pas faire tomber le lot entier.
        failed += 1;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, threads.length) }, worker));
  return { reviews, failed };
}
