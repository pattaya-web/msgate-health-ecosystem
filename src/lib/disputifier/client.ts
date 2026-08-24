import {
  ALERT_TYPES,
  type AlertType,
  type DisputifierAlert,
  type DisputifierMerchant,
} from "@/lib/disputifier/types";

const BASE_URL = "https://app.disputifier.com";
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MERCHANT_TTL_MS = 5 * 60 * 1000;

type RawRecord = Record<string, unknown>;

/**
 * Une clé ORG-API-KEY ne voit que les marchands de son organisation : le compte ISO
 * et le compte direct sont deux organisations distinctes, d'où une liste de clés.
 */
export function disputifierKeys(): string[] {
  return (process.env.DISPUTIFIER_API_KEYS || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

async function disputifierGet(
  key: string,
  path: string,
  params: Record<string, string | undefined>,
  options: { emptyOn404?: boolean } = {}
) {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [name, value] of Object.entries(params)) {
    if (value) url.searchParams.set(name, value);
  }

  const res = await fetch(url, {
    headers: { "ORG-API-KEY": key, "Content-Type": "application/json" },
    cache: "no-store",
  });

  const text = await res.text();
  // Un MID sans alerte répond 404 « No alerts available » : c'est un résultat vide, pas une panne.
  if (res.status === 404 && options.emptyOn404) {
    return { data: [] as unknown };
  }
  if (!res.ok) {
    throw new Error(`${path} → HTTP ${res.status} ${text.slice(0, 140)}`);
  }

  try {
    return JSON.parse(text) as { data?: unknown; status?: string };
  } catch {
    throw new Error(`${path} → réponse non-JSON (${text.slice(0, 100)})`);
  }
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text && text !== "null" ? text : null;
}

function amount(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

let merchantCache: { at: number; merchants: DisputifierMerchant[] } | null = null;

export async function fetchMerchants(force = false): Promise<{
  merchants: DisputifierMerchant[];
  errors: string[];
}> {
  if (!force && merchantCache && Date.now() - merchantCache.at < MERCHANT_TTL_MS) {
    return { merchants: merchantCache.merchants, errors: [] };
  }

  const keys = disputifierKeys();
  if (!keys.length) {
    return { merchants: [], errors: ["DISPUTIFIER_API_KEYS n'est pas configuré."] };
  }

  const merchants: DisputifierMerchant[] = [];
  const errors: string[] = [];

  const results = await Promise.all(
    keys.map(async (key, keyIndex) => {
      try {
        const body = await disputifierGet(key, "/api/merchants", { limit: "100" });
        const rows = Array.isArray(body.data) ? (body.data as RawRecord[]) : [];
        return rows.map<DisputifierMerchant>((row) => ({
          merchantId: String(row.MerchantID ?? ""),
          merchantName: String(row.MerchantName ?? "—"),
          merchantEmail: str(row.MerchantEmail),
          mids: Array.isArray(row.MerchantMIDs)
            ? (row.MerchantMIDs as RawRecord[]).map((mid) => ({
                mid_id: String(mid.mid_id ?? ""),
                mid_name: String(mid.mid_name ?? ""),
                status: str(mid.status),
              }))
            : [],
          keyIndex,
        }));
      } catch (error) {
        errors.push(
          `Clé #${keyIndex + 1} : ${error instanceof Error ? error.message : "appel impossible"}`
        );
        return [];
      }
    })
  );

  for (const batch of results) merchants.push(...batch);
  merchants.sort((a, b) => a.merchantName.localeCompare(b.merchantName));

  if (merchants.length) merchantCache = { at: Date.now(), merchants };
  return { merchants, errors };
}

function normalize(
  type: AlertType,
  row: RawRecord,
  merchant: DisputifierMerchant
): DisputifierAlert {
  const midId = str(row.MidID);
  const shared = {
    type,
    merchantId: merchant.merchantId,
    merchantName: merchant.merchantName,
    midId,
    midName: str(row.MIDName),
    midSource: (midId ? "api" : null) as "api" | "inferred" | null,
    alertLabel: str(row.MerchantName),
    orderNumber: str(row.OrderNumber),
    alertAt: str(row.AlertTimestamp) ?? "",
    transactionAt: str(row.TransactionTimestamp),
    amount: amount(row.Amount),
    currency: str(row.Currency) ?? "USD",
    cardLast4: str(row.cardLast4),
    descriptor: str(row.MerchantDescriptor),
    refundAction: str(row.Refund_action),
    flagAction: str(row.Flag_action),
  };

  if (type === "ethoca") {
    return {
      ...shared,
      id: str(row.EthocaID) ?? `${merchant.merchantId}-${shared.alertAt}`,
      caseId: null,
      issuer: str(row.Issuer),
      reasonCode: str(row.EthocaType),
    };
  }

  if (type === "cdrn") {
    return {
      ...shared,
      id: str(row.CaseID) ?? `${merchant.merchantId}-${shared.alertAt}-${shared.orderNumber ?? ""}`,
      caseId: str(row.CaseID),
      issuer: str(row.AlertMerchantID),
      reasonCode: str(row.reasonCode),
    };
  }

  return {
    ...shared,
    id: str(row.alert_id) ?? str(row.CaseID) ?? `${merchant.merchantId}-${shared.alertAt}`,
    caseId: str(row.CaseID),
    issuer: null,
    reasonCode: str(row.reasonCode),
  };
}

/**
 * Les endpoints d'alertes ne renvoient aucune métadonnée de pagination : on avance
 * page par page tant qu'une page pleine revient.
 */
async function fetchAlertPage(
  key: string,
  type: AlertType,
  merchant: DisputifierMerchant,
  page: number,
  startdate?: string,
  enddate?: string
): Promise<DisputifierAlert[]> {
  const body = await disputifierGet(
    key,
    `/api/alerts/${type}`,
    {
      merchant_id: merchant.merchantId,
      limit: String(PAGE_SIZE),
      page: String(page),
      startdate,
      enddate,
    },
    { emptyOn404: true }
  );

  const raw = body.data;
  const rows: RawRecord[] = Array.isArray(raw)
    ? (raw as RawRecord[])
    : raw && typeof raw === "object"
      ? [raw as RawRecord]
      : [];

  return rows.map((row) => normalize(type, row, merchant));
}

const GENERIC_MID_NAMES = new Set(["DEFAULTMID", "MIDNAME"]);

function normalizeLabel(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * « 500001233408 (Kurv-BMO - UPSKINRENEW) » → « UPSKINRENEW » : le nom commercial du
 * MID est le dernier segment, c'est lui qui se retrouve dans le descriptor de l'alerte.
 */
function midTradeName(midName: string) {
  const parenthesised = midName.match(/\(([^)]*)\)\s*$/);
  const body = parenthesised ? parenthesised[1] : midName.replace(/^\s*\d[\d\s]*/, "");
  const segments = body.split(/\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  const last = segments[segments.length - 1] ?? "";
  const normalized = normalizeLabel(last);
  return normalized.length >= 5 && !GENERIC_MID_NAMES.has(normalized) ? normalized : null;
}

/**
 * Disputifier ne renseigne jamais `MidID` sur les alertes RDR (et le laisse vide sur
 * une partie des Ethoca / CDRN). Le MID est en revanche identifiable dans le descriptor,
 * soit par son numéro — « SkinRenew - 414572 - 565500001245584 » contient 500001245584 —
 * soit par son nom commercial — descriptor « UPSKINRENEW ».
 *
 * Le rattachement par nom n'est retenu que si un seul MID du marchand porte ce nom :
 * deux MID nommés « Skinrenew LLC » resteraient sinon indiscernables, et un chiffre
 * faussement attribué serait pire qu'une ligne « Sans MID ».
 */
function attachInferredMids(alerts: DisputifierAlert[], merchant: DisputifierMerchant) {
  type Mid = (typeof merchant.mids)[number];

  const numbered = merchant.mids
    .map((mid) => ({ mid, digits: (mid.mid_name.match(/\d{8,}/g) ?? [])[0] }))
    .filter((entry): entry is { mid: Mid; digits: string } => Boolean(entry.digits));

  const namesSeen = new Map<string, Mid[]>();
  for (const mid of merchant.mids) {
    const name = midTradeName(mid.mid_name);
    if (!name) continue;
    namesSeen.set(name, [...(namesSeen.get(name) ?? []), mid]);
  }

  const unique = [...namesSeen.entries()].filter(([, mids]) => mids.length === 1);

  // « SKINRENEW » est contenu dans « UPSKINRENEW » : le garder attribuerait au MID
  // Priority-Synovus toutes les alertes du MID Kurv-BMO. On écarte donc le nom le
  // moins spécifique et on garde le plus long, puis on teste du plus long au plus court.
  const named = unique
    .filter(([name]) => unique.every(([other]) => other === name || !other.includes(name)))
    .map(([name, mids]) => ({ mid: mids[0], name }))
    .sort((a, b) => b.name.length - a.name.length);

  if (!numbered.length && !named.length) return;

  for (const alert of alerts) {
    if (alert.midId) continue;
    const haystack = `${alert.alertLabel ?? ""} ${alert.descriptor ?? ""} ${alert.midName ?? ""}`;

    const byNumber = numbered.find((entry) => haystack.includes(entry.digits));
    const hit = byNumber ?? named.find((entry) => normalizeLabel(haystack).includes(entry.name));
    if (!hit) continue;

    alert.midId = hit.mid.mid_id;
    alert.midName = hit.mid.mid_name;
    alert.midSource = "inferred";
  }
}

export async function fetchAlerts(options: {
  merchants: DisputifierMerchant[];
  types: AlertType[];
  startdate?: string;
  enddate?: string;
  /** Hors déduction, les compteurs par MID collent exactement au portail Disputifier. */
  inferMids: boolean;
}): Promise<{ alerts: DisputifierAlert[]; errors: string[]; truncated: boolean }> {
  const keys = disputifierKeys();
  const errors: string[] = [];
  let truncated = false;

  const jobs = options.merchants.flatMap((merchant) =>
    options.types.map(async (type) => {
      const key = keys[merchant.keyIndex];
      if (!key) return [] as DisputifierAlert[];

      const collected: DisputifierAlert[] = [];
      try {
        for (let page = 1; page <= MAX_PAGES; page += 1) {
          const batch = await fetchAlertPage(
            key,
            type,
            merchant,
            page,
            options.startdate,
            options.enddate
          );
          collected.push(...batch);
          if (batch.length < PAGE_SIZE) break;
          if (page === MAX_PAGES) truncated = true;
        }
      } catch (error) {
        errors.push(
          `${merchant.merchantName} · ${type.toUpperCase()} : ${
            error instanceof Error ? error.message : "appel impossible"
          }`
        );
      }
      if (options.inferMids) attachInferredMids(collected, merchant);
      return collected;
    })
  );

  const batches = await Promise.all(jobs);
  const alerts = batches.flat();
  alerts.sort((a, b) => b.alertAt.localeCompare(a.alertAt));

  return { alerts, errors, truncated };
}

export function parseTypes(value: string | null): AlertType[] {
  if (!value || value === "all") return [...ALERT_TYPES];
  const requested = value.split(",").map((part) => part.trim().toLowerCase());
  const valid = ALERT_TYPES.filter((type) => requested.includes(type));
  return valid.length ? valid : [...ALERT_TYPES];
}
