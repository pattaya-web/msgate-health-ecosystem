import type { Bank, EcosystemGoals, EntityStatus, Ibo, Llc, Mid } from "@/types";

export type GoalKind = "ibos" | "llcs" | "banks" | "mids";

export interface GoalProgress {
  kind: GoalKind;
  label: string;
  current: number;
  potential: number;
  target: number;
  /** current / target */
  currentPct: number;
  /** (current + potential) / target — pipeline coverage */
  pipelinePct: number;
  remaining: number;
}

const ACTIVE: EntityStatus[] = ["active", "backup"];
const POTENTIAL: EntityStatus[] = ["opening", "underwriting"];

function pct(n: number, d: number) {
  if (d <= 0) return 100;
  return Math.min(100, Math.round((n / d) * 100));
}

export function computeIboProgress(ibos: Ibo[], target: number): GoalProgress {
  const current = ibos.filter((i) => ACTIVE.includes(i.status) || i.status === "active").length;
  // Count active strictly; potential = opening
  const active = ibos.filter((i) => i.status === "active").length;
  const potential = ibos.filter((i) => POTENTIAL.includes(i.status)).length;
  return {
    kind: "ibos",
    label: "IBO",
    current: active,
    potential,
    target,
    currentPct: pct(active, target),
    pipelinePct: pct(active + potential, target),
    remaining: Math.max(0, target - active),
  };
}

export function computeLlcProgress(llcs: Llc[], target: number): GoalProgress {
  const active = llcs.filter((l) => l.status === "active").length;
  const potential = llcs.filter((l) => POTENTIAL.includes(l.status)).length;
  return {
    kind: "llcs",
    label: "LLC",
    current: active,
    potential,
    target,
    currentPct: pct(active, target),
    pipelinePct: pct(active + potential, target),
    remaining: Math.max(0, target - active),
  };
}

export function computeBankProgress(banks: Bank[], target: number, ibos?: Ibo[]): GoalProgress {
  const active = ibos
    ? ibos.reduce((sum, i) => sum + (Number(i.active_banks_count) || 0), 0)
    : banks.filter((b) => b.status === "active").length;
  const potential = banks.filter((b) => POTENTIAL.includes(b.status)).length;
  return {
    kind: "banks",
    label: "Bank",
    current: active,
    potential,
    target,
    currentPct: pct(active, target),
    pipelinePct: pct(active + potential, target),
    remaining: Math.max(0, target - active),
  };
}

export function computeMidProgress(mids: Mid[], target: number, ibos?: Ibo[]): GoalProgress {
  const active = ibos
    ? ibos.reduce((sum, i) => sum + (Number(i.active_mids_count) || 0), 0)
    : mids.filter((m) => m.status === "active").length;
  const potential = mids.filter((m) => POTENTIAL.includes(m.status)).length;
  return {
    kind: "mids",
    label: "MID",
    current: active,
    potential,
    target,
    currentPct: pct(active, target),
    pipelinePct: pct(active + potential, target),
    remaining: Math.max(0, target - active),
  };
}

export function computeAllGoals(params: {
  ibos: Ibo[];
  llcs: Llc[];
  banks: Bank[];
  mids: Mid[];
  goals: EcosystemGoals;
}): GoalProgress[] {
  const g = params.goals;
  return [
    computeIboProgress(params.ibos, g.target_ibos),
    computeLlcProgress(params.llcs, g.target_llcs),
    computeBankProgress(params.banks, g.target_banks, params.ibos),
    computeMidProgress(params.mids, g.target_mids, params.ibos),
  ];
}
