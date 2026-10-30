import { getPhoenixConfig, getRateBudget } from "@/lib/phoenix/client";
import * as phoenixSnapshot from "@/lib/phoenix/snapshot";
import type { PhoenixSnapshot } from "@/lib/phoenix/snapshot";
import type { SnapshotProgress } from "@/lib/phoenix/types";
import { getReignConfig, getReignRateBudget } from "@/lib/reign/client";
import * as reignSnapshot from "@/lib/reign/snapshot";

/**
 * Les sources de l'écran Stats.
 *
 * Phoenix (phxcrm) et Reign fournissent le même instantané ; l'écran et ses
 * routes choisissent la source par `?source=` et ne voient qu'une seule
 * interface. Sans paramètre, on prend la première source configurée.
 */

export type StatsSource = "phoenix" | "reign";

export type SourceApi = {
  id: StatsSource;
  label: string;
  configured: boolean;
  notConfigured: string;
  targetCac: number | null;
  peekSnapshot: () => Promise<PhoenixSnapshot | null>;
  startSync: (options?: { focus?: { start: string; end: string }; force?: boolean }) => Promise<void>;
  getProgress: () => SnapshotProgress;
  rate: () => { used: number; max: number; windowMs: number; throttled: number };
};

function number(value: string | undefined) {
  const parsed = Number(value);
  return value && Number.isFinite(parsed) ? parsed : null;
}

export function getSourceApi(source: StatsSource): SourceApi {
  if (source === "reign") {
    const config = getReignConfig();
    return {
      id: "reign",
      label: config?.clientLabel ?? "Reign",
      configured: Boolean(config),
      notConfigured: "Reign n'est pas configuré — ajouter REIGN_API_KEY dans .env.local",
      targetCac: number(process.env.REIGN_TARGET_CAC) ?? number(process.env.PHOENIX_TARGET_CAC),
      peekSnapshot: reignSnapshot.peekSnapshot,
      startSync: reignSnapshot.startSync,
      getProgress: reignSnapshot.getProgress,
      rate: getReignRateBudget,
    };
  }
  const config = getPhoenixConfig();
  return {
    id: "phoenix",
    label: config?.clientLabel ?? "Phoenix",
    configured: Boolean(config),
    notConfigured: "Phoenix not configured — set PHOENIX_* in .env.local",
    targetCac: number(process.env.PHOENIX_TARGET_CAC),
    peekSnapshot: phoenixSnapshot.peekSnapshot,
    startSync: phoenixSnapshot.startSync,
    getProgress: phoenixSnapshot.getProgress,
    rate: getRateBudget,
  };
}

export function listSources() {
  return (["phoenix", "reign"] as StatsSource[]).map((id) => {
    const api = getSourceApi(id);
    return { id, label: api.label, configured: api.configured };
  });
}

/** La source demandée, ou à défaut la première configurée (Phoenix d'abord). */
export function resolveSource(param: string | null | undefined): SourceApi {
  if (param === "reign" || param === "phoenix") return getSourceApi(param);
  const first = listSources().find((source) => source.configured);
  return getSourceApi(first?.id ?? "phoenix");
}
