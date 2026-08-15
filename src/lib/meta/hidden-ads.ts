/**
 * Local-only hide list for creatives.
 * Never touches Meta — operators clean their cockpit view after pausing dead ads.
 */

const KEY = "msgate-hidden-ad-ids";

export function loadHiddenAdIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map(String).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function saveHiddenAdIds(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...ids]));
  } catch {
    // quota / private mode — in-memory state still works for the session
  }
}
