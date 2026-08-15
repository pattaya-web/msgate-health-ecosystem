export interface AirtableConfig {
  apiKey: string;
  baseId: string;
  tables: {
    ibos: string;
    llcs: string;
    banks: string;
    mids: string;
    sops: string;
  };
}

export function getAirtableConfig(): AirtableConfig | null {
  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) return null;

  return {
    apiKey,
    baseId,
    tables: {
      ibos: process.env.AIRTABLE_IBO_TABLE || "ID IBO",
      llcs: process.env.AIRTABLE_LLC_TABLE || "LLCs",
      banks: process.env.AIRTABLE_BANK_TABLE || "Banks",
      mids: process.env.AIRTABLE_MID_TABLE || "MIDs",
      sops: process.env.AIRTABLE_SOP_TABLE || "SOPs",
    },
  };
}

export async function airtableRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const config = getAirtableConfig();
  if (!config) {
    throw new Error("Airtable is not configured");
  }

  const res = await fetch(`https://api.airtable.com/v0/${config.baseId}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable error ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}
