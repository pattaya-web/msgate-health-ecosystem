import { NextResponse } from "next/server";
import { readPdf } from "@/lib/ecom-sites/pdf-text";
import { kieClaude } from "@/lib/studio/kie";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Extraction des informations d'entité depuis un document déposé.
 *
 * On ne devine jamais un champ absent : un formulaire pré-rempli avec une
 * adresse inventée est pire qu'un formulaire vide, parce que l'erreur file
 * ensuite dans le footer et les politiques, où le processeur la recoupe avec le
 * dossier de la LLC. Tout champ non trouvé revient vide, avec la liste de ce
 * qui manque.
 */

type Doc = {
  fileName?: string;
  text?: string;
  /** PDF déposé, en data URL ou base64 nu. */
  pdfBase64?: string;
};

/** `docs` permet de déposer tout le dossier d'un coup ; les champs se cumulent. */
type Body = Doc & { docs?: Doc[] };

const REASON_HINT: Record<string, string> = {
  scanned: "PDF scanné (que des images) — ouvre-le, copie le texte et colle-le, ou fournis la version texte.",
  encrypted: "PDF protégé par mot de passe — enlève la protection puis redépose-le.",
  garbled: "Texte extrait illisible (police non standard) — copie-colle le texte plutôt.",
  unreadable: "Aucun texte exploitable dans ce PDF.",
};

export type LlcExtract = {
  legalName: string;
  stateOfIncorporation: string;
  addressLine: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  supportEmail: string;
  supportPhone: string;
  /** Numéro d'immatriculation / EIN, utile pour recouper le dossier. */
  registrationNumber: string;
  missing: string[];
};

const EMPTY: LlcExtract = {
  legalName: "",
  stateOfIncorporation: "",
  addressLine: "",
  city: "",
  region: "",
  postalCode: "",
  country: "United States",
  supportEmail: "",
  supportPhone: "",
  registrationNumber: "",
  missing: [],
};

const FIELDS: Array<keyof Omit<LlcExtract, "missing">> = [
  "legalName",
  "stateOfIncorporation",
  "addressLine",
  "city",
  "region",
  "postalCode",
  "country",
  "supportEmail",
  "supportPhone",
  "registrationNumber",
];

function parseJson(raw: string): Partial<LlcExtract> {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Lecture du document impossible");
  return JSON.parse(candidate.slice(start, end + 1)) as Partial<LlcExtract>;
}

const STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";

/** Suffixes de voie : c'est ce qui sépare la rue de la ville sans virgule. */
const STREET_SUFFIX =
  "ST|STREET|AVE|AVENUE|RD|ROAD|BLVD|BOULEVARD|DR|DRIVE|LN|LANE|WAY|CT|COURT|PL|PLACE|TER|TERRACE|TRL|TRAIL|PKWY|PARKWAY|HWY|HIGHWAY|CIR|CIRCLE|SQ|SQUARE|LOOP|RUN|PATH|CV|COVE";

/** Compléments qui font encore partie de la rue, jamais de la ville. */
const UNIT = "SUITE|STE|UNIT|APT|APARTMENT|FLOOR|FL|RM|ROOM|BLDG|BUILDING|PMB|BOX|#";

/**
 * Adresse américaine, lue sur un texte aplati.
 *
 * L'ancre est le couple « code d'état + code postal », de loin le motif le plus
 * fiable d'un document officiel. On remonte ensuite vers le début : le numéro
 * ouvre la rue, un suffixe de voie la referme, et ce qui reste avant l'état est
 * la ville. Cette approche encaisse les trois formes rencontrées en pratique :
 * séparée par des virgules, sur deux lignes, ou sans aucune ponctuation.
 */
function extractAddress(flat: string): Partial<LlcExtract> {
  const anchor = new RegExp(`(.{12,140}?)\\b(${STATES})\\b[,.\\s]+(\\d{5}(?:-\\d{4})?)\\b`, "g");

  for (const match of flat.matchAll(anchor)) {
    const before = match[1];
    const region = match[2];
    const postalCode = match[3];

    /**
     * Plusieurs numéros peuvent précéder l'état — « 1450 … SUITE 1200 MIAMI ».
     * Partir du dernier attraperait le numéro de suite ; on essaie donc chaque
     * départ, du plus proche au plus lointain, et on garde le premier qui donne
     * une rue et une ville cohérentes.
     */
    // Une boîte postale n'a pas de suffixe de voie : elle est reconnue à part.
    const box = before.match(
      /\b(P\.?\s?O\.?\s+BOX|POST OFFICE BOX)\s+([\w-]+)\s*,?\s*([A-Za-z .'-]{2,40}?)[,.\s]*$/i
    );
    if (box) {
      return {
        addressLine: `${box[1]} ${box[2]}`.replace(/\s+/g, " ").trim(),
        city: box[3].trim(),
        region,
        postalCode,
      };
    }

    // La virgule compte autant que l'espace : « 1187, Reno » est un départ valide.
    const starts = [...before.matchAll(/\b\d{1,6}\b(?=[\s,]+\S)/g)].reverse();
    const cut = new RegExp(
      `^(.*?\\b(?:${STREET_SUFFIX})\\b\\.?(?:\\s+(?:${UNIT})\\b\\.?\\s*[\\w-]+)?)\\s*,?\\s*(.*)$`,
      "i"
    );

    for (const start of starts) {
      const chunk = before.slice(start.index).replace(/[,\s]+$/, "").trim();
      const split = chunk.match(cut);

      let addressLine = "";
      let city = "";
      if (split) {
        addressLine = split[1].trim();
        city = split[2].trim();
      } else if (chunk.includes(",")) {
        // Pas de suffixe reconnu mais une virgule : elle fait la coupure.
        const at = chunk.lastIndexOf(",");
        addressLine = chunk.slice(0, at).trim();
        city = chunk.slice(at + 1).trim();
      } else {
        continue;
      }

      city = city.replace(/^[,.\s]+|[,.\s]+$/g, "");

      /**
       * Une rue réduite à un nombre — « 3 » attrapé dans « Apt 3 » — n'est pas
       * une adresse : on exige un numéro ET du texte, sur au moins deux mots,
       * sinon on remonte au candidat de départ précédent.
       */
      const plausible =
        /\d/.test(addressLine) &&
        /[A-Za-z]{2}/.test(addressLine) &&
        addressLine.trim().split(/\s+/).length >= 2;

      // Une « ville » de cinq mots est en réalité du texte avalé par erreur.
      if (!plausible || !city || city.split(/\s+/).length > 4) continue;

      return { addressLine, city, region, postalCode };
    }
  }

  return {};
}

/**
 * Repli sans modèle de langage : les statuts américains suivent des formes
 * assez régulières pour qu'une lecture par motifs récupère l'essentiel, et ça
 * évite de dépendre d'un service tiers pour un simple pré-remplissage.
 */
function extractByPattern(text: string): Partial<LlcExtract> {
  const flat = text.replace(/\s+/g, " ");
  const out: Partial<LlcExtract> = {};

  const name = flat.match(/\b([A-Z0-9][A-Za-z0-9&'.\- ]{2,60}?\s+(?:LLC|L\.L\.C\.|LIMITED LIABILITY COMPANY))\b/);
  if (name) out.legalName = name[1].trim();

  const state = flat.match(
    /\b(?:State of|laws of(?: the State of)?|organized in|incorporated in)\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)/
  );
  if (state) out.stateOfIncorporation = state[1].trim();

  Object.assign(out, extractAddress(flat));

  const email = flat.match(/[\w.+-]+@[\w-]+\.[\w.]{2,}/);
  if (email) out.supportEmail = email[0];

  const phone = flat.match(/(?:\+1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  if (phone) out.supportPhone = phone[0].trim();

  const ein = flat.match(/\b(?:EIN|E\.I\.N\.|Employer Identification Number)[:\s#]*([\d-]{9,11})/i);
  if (ein) out.registrationNumber = ein[1].trim();

  return out;
}

function buildPrompt(text: string, fileName?: string) {
  return `Extract the legal entity details from this US business document${fileName ? ` (file: ${fileName})` : ""}.

DOCUMENT:
${text.slice(0, 12000)}

Rules:
- Copy values EXACTLY as written in the document. Do not normalise, expand abbreviations, or correct spelling.
- If a field is not present in the document, return an empty string. NEVER guess or invent a value.
- "region" is the two-letter US state code of the business address.
- "stateOfIncorporation" is the full state name the company is organised under.

Return ONLY this JSON:
{
  "legalName": "",
  "stateOfIncorporation": "",
  "addressLine": "",
  "city": "",
  "region": "",
  "postalCode": "",
  "country": "",
  "supportEmail": "",
  "supportPhone": "",
  "registrationNumber": ""
}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const docs: Doc[] = body.docs?.length ? body.docs : [body];

    /**
     * Chaque document est lu séparément puis les textes sont concaténés. Un
     * dossier de LLC est éclaté sur plusieurs pièces — statuts, EIN, adresse —
     * et aucune ne porte tous les champs à elle seule.
     */
    const perFile: Array<{ fileName: string; chars: number; reason: string; hint?: string }> = [];
    const texts: string[] = [];

    for (const doc of docs) {
      const name = doc.fileName || "document";
      const direct = (doc.text || "").trim();
      if (direct) {
        texts.push(direct);
        perFile.push({ fileName: name, chars: direct.length, reason: "ok" });
        continue;
      }
      if (!doc.pdfBase64) {
        perFile.push({ fileName: name, chars: 0, reason: "empty", hint: "Fichier vide" });
        continue;
      }
      const base64 = doc.pdfBase64.includes("base64,")
        ? doc.pdfBase64.slice(doc.pdfBase64.indexOf("base64,") + 7)
        : doc.pdfBase64;
      const read = readPdf(Buffer.from(base64, "base64"));
      if (read.text) texts.push(read.text);
      perFile.push({
        fileName: name,
        chars: read.text.length,
        reason: read.reason,
        hint: read.reason === "ok" ? undefined : REASON_HINT[read.reason],
      });
    }

    const text = texts.join("\n\n").trim();

    if (text.length < 30) {
      return NextResponse.json(
        {
          error:
            perFile.length === 1
              ? perFile[0].hint || "Aucun texte exploitable dans ce document."
              : `Aucun des ${perFile.length} documents n'a livré de texte exploitable.`,
          files: perFile,
        },
        { status: 400 }
      );
    }

    // Les motifs passent d'abord : instantanés et gratuits.
    let found: Partial<LlcExtract> = extractByPattern(text);
    let source: "pattern" | "claude" = "pattern";

    // Claude ne sert qu'à compléter ce que les motifs n'ont pas trouvé.
    const stillMissing = FIELDS.filter((field) => !found[field] && field !== "country");
    if (stillMissing.length > 3) {
      try {
        const parsed = parseJson(await kieClaude(buildPrompt(text, docs.map((d) => d.fileName).join(", ")), 2000));
        found = { ...parsed, ...Object.fromEntries(Object.entries(found).filter(([, v]) => v)) };
        source = "claude";
      } catch {
        // Service indisponible : on garde ce que les motifs ont sorti.
      }
    }

    const entity: LlcExtract = { ...EMPTY, ...found, missing: [] };
    entity.country = entity.country || "United States";
    entity.missing = FIELDS.filter((field) => !String(entity[field] || "").trim());

    return NextResponse.json({ entity, source, files: perFile });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Extraction impossible" },
      { status: 502 }
    );
  }
}
