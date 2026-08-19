import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { SavDirection, SavMessage } from "@/lib/sav/types";

/**
 * Lecture de la boîte support@ (Namecheap Private Email).
 *
 * L'agent SAV travaille dans le webmail, donc ses réponses ne transitent
 * jamais par notre app : le dossier Sent du serveur est la seule trace de son
 * activité. INBOX et Sent sont donc lus ensemble, puis fusionnés en fils.
 */

export type SavImapConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
};

export function getSavImapConfig(): SavImapConfig | null {
  const host = process.env.SAV_IMAP_HOST?.trim();
  const user = process.env.SAV_IMAP_USER?.trim();
  const password = process.env.SAV_IMAP_PASSWORD;
  if (!host || !user || !password) return null;

  const port = Number(process.env.SAV_IMAP_PORT) || 993;
  return { host, port, user, password, secure: port === 993 };
}

export function isSavConfigured() {
  return Boolean(getSavImapConfig());
}

/** Les adresses de la maison — tout le reste est « le client ». */
function houseAddresses(config: SavImapConfig) {
  const extra = (process.env.SAV_TEAM_ADDRESSES || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return new Set([config.user.toLowerCase(), ...extra]);
}

type Address = { address?: string | null; name?: string | null };

function firstExternal(candidates: Address[][], house: Set<string>) {
  for (const group of candidates) {
    for (const entry of group) {
      const address = entry.address?.toLowerCase().trim();
      if (address && !house.has(address)) {
        return { address, name: entry.name?.trim() || "" };
      }
    }
  }
  return null;
}

/** Un « Re: Re: TR: sujet » et « sujet » appartiennent au même fil. */
export function normalizeSubject(value: string) {
  return value
    .replace(/^(\s*(re|ré|rép|fw|fwd|tr)\s*(\[\d+\])?\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const REFUND_PATTERNS =
  /\b(refund|rembours|money back|chargeback|charge back|dispute|cancel my (order|subscription)|annul)/i;

export function looksLikeRefund(text: string) {
  return REFUND_PATTERNS.test(text);
}

async function connect(config: SavImapConfig) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });
  await client.connect();
  return client;
}

/** Le nom du dossier « envoyés » varie selon les serveurs ; on le découvre. */
async function findSentMailbox(client: ImapFlow) {
  const boxes = await client.list();
  const special = boxes.find((box) => box.specialUse === "\\Sent");
  if (special) return special.path;

  const byName = boxes.find((box) => /^(inbox[./])?sent(\s|$|[-_ ]?(items|mail))/i.test(box.path));
  return byName?.path ?? null;
}

type FetchOptions = {
  /** Date ISO (YYYY-MM-DD) à partir de laquelle lire. */
  since: string;
  /** Corps complets : coûteux, réservé à l'ouverture d'un fil. */
  withBodies?: boolean;
  /** Garde-fou : au-delà, on tronque en gardant les plus récents. */
  limit?: number;
};

async function readMailbox(
  client: ImapFlow,
  mailbox: string,
  direction: SavDirection,
  house: Set<string>,
  options: FetchOptions
): Promise<SavMessage[]> {
  const lock = await client.getMailboxLock(mailbox);
  const out: SavMessage[] = [];

  try {
    const found = await client.search(
      { since: new Date(`${options.since}T00:00:00Z`) },
      { uid: true }
    );
    // imapflow renvoie `false` quand la recherche échoue côté serveur.
    const uids = Array.isArray(found) ? found : [];
    if (!uids.length) return out;

    // Les plus récents d'abord : si la boîte déborde, on garde ce qui compte.
    const wanted = options.limit ? uids.slice(-options.limit) : uids;

    for await (const message of client.fetch(
      wanted,
      { uid: true, envelope: true, source: Boolean(options.withBodies) },
      { uid: true }
    )) {
      const envelope = message.envelope;
      if (!envelope) continue;

      const from = (envelope.from || []) as Address[];
      const to = (envelope.to || []) as Address[];
      const cc = (envelope.cc || []) as Address[];

      // Sur un entrant le client est l'expéditeur, sur un sortant le destinataire.
      const external =
        direction === "in"
          ? firstExternal([from, to, cc], house)
          : firstExternal([to, cc, from], house);
      if (!external) continue;

      // Le corps complet n'est jamais gardé en liste (mémoire + données clients) :
      // seul un aperçu est conservé, suffisant pour repérer une demande de refund.
      let preview = "";
      if (options.withBodies && message.source) {
        const parsed = await simpleParser(message.source);
        preview = (parsed.text || parsed.html || "")
          .toString()
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 400);
      }

      out.push({
        id: `${direction}-${message.uid}`,
        direction,
        client: external.address,
        clientName: external.name,
        subject: envelope.subject || "(sans objet)",
        date: (envelope.date ?? new Date()).toISOString(),
        preview,
      });
    }
  } finally {
    lock.release();
  }

  return out;
}

export type RawMailbox = {
  messages: SavMessage[];
  warnings: string[];
};

/**
 * Corps des messages d'un fil, chargés à la demande.
 * Les identifiants portent leur origine (`in-1234` / `out-1234`), donc on ne
 * rouvre que les dossiers réellement concernés.
 */
export async function fetchSavBodies(ids: string[]): Promise<Map<string, string>> {
  const config = getSavImapConfig();
  if (!config) throw new Error("SAV non configuré (SAV_IMAP_* manquantes)");

  const wanted = { in: [] as number[], out: [] as number[] };
  for (const id of ids) {
    const [direction, uid] = id.split("-");
    const parsed = Number(uid);
    if (!Number.isFinite(parsed)) continue;
    if (direction === "in") wanted.in.push(parsed);
    else if (direction === "out") wanted.out.push(parsed);
  }

  const bodies = new Map<string, string>();
  const client = await connect(config);

  try {
    const targets: Array<{ mailbox: string; direction: SavDirection; uids: number[] }> = [];
    if (wanted.in.length) targets.push({ mailbox: "INBOX", direction: "in", uids: wanted.in });
    if (wanted.out.length) {
      const sentBox = await findSentMailbox(client);
      if (sentBox) targets.push({ mailbox: sentBox, direction: "out", uids: wanted.out });
    }

    for (const target of targets) {
      const lock = await client.getMailboxLock(target.mailbox);
      try {
        for await (const message of client.fetch(
          target.uids,
          { uid: true, source: true },
          { uid: true }
        )) {
          if (!message.source) continue;
          const parsed = await simpleParser(message.source);
          bodies.set(
            `${target.direction}-${message.uid}`,
            (parsed.text || parsed.html || "").toString().trim()
          );
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => client.close());
  }

  return bodies;
}

export async function fetchSavMessages(options: FetchOptions): Promise<RawMailbox> {
  const config = getSavImapConfig();
  if (!config) throw new Error("SAV non configuré (SAV_IMAP_* manquantes)");

  const house = houseAddresses(config);
  const warnings: string[] = [];
  const client = await connect(config);

  try {
    const inbox = await readMailbox(client, "INBOX", "in", house, {
      ...options,
      withBodies: true,
    });

    const sentBox = await findSentMailbox(client);
    let sent: SavMessage[] = [];
    if (sentBox) {
      // Sortants : enveloppe seule — on mesure le volume et les délais, pas le contenu.
      sent = await readMailbox(client, sentBox, "out", house, options);
    } else {
      warnings.push(
        "Dossier « Envoyés » introuvable sur le serveur : l'activité sortante ne peut pas être mesurée."
      );
    }

    return { messages: [...inbox, ...sent], warnings };
  } finally {
    await client.logout().catch(() => client.close());
  }
}
