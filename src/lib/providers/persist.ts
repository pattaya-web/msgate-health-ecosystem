/** Browser persistence for ecosystem edits (survives leave page / refresh). */

const STORAGE_KEY = "msgate.ecosystem.v1";

export type PersistedEcosystem = {
  version: 1;
  savedAt: string;
  ibos: unknown[];
  llcs: unknown[];
  banks: unknown[];
  mids: unknown[];
  settings: unknown;
  deletedIds: {
    ibos: string[];
    llcs: string[];
    banks: string[];
    mids: string[];
  };
};

export function loadPersistedEcosystem(): PersistedEcosystem | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PersistedEcosystem;
    if (!data || data.version !== 1) return null;
    return data;
  } catch {
    return null;
  }
}

export function savePersistedEcosystem(data: Omit<PersistedEcosystem, "version" | "savedAt">) {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedEcosystem = {
      version: 1,
      savedAt: new Date().toISOString(),
      ...data,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function clearPersistedEcosystem() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
