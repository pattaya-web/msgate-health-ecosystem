import { graphPost, unitsToCents, type GraphError } from "@/lib/meta/graph";
import { resolveToken } from "@/lib/meta/token";
import { invalidateTreeCache } from "@/lib/meta/tree";
import type { EntityLevel } from "@/lib/meta/types";

const LEVEL_LABEL: Record<EntityLevel, string> = {
  campaign: "la campagne",
  adset: "l'ad set",
  ad: "la publicité",
};

export async function setEntityStatus(params: {
  id: string;
  level: EntityLevel;
  status: "ACTIVE" | "PAUSED";
}) {
  const token = await resolveToken(params.id);
  const body = await graphPost<GraphError & { success?: boolean; id?: string }>(
    params.id,
    token,
    { status: params.status }
  );

  if (body.error) {
    throw new Error(`Impossible de mettre à jour ${LEVEL_LABEL[params.level]} : ${body.error.message}`);
  }

  invalidateTreeCache();
  return { id: params.id, status: params.status };
}

export async function setEntityBudget(params: {
  id: string;
  level: Extract<EntityLevel, "campaign" | "adset">;
  /** Daily budget in the account currency, not cents. */
  dailyBudget: number;
}) {
  if (!Number.isFinite(params.dailyBudget) || params.dailyBudget <= 0) {
    throw new Error("Le budget doit être un montant positif.");
  }

  const token = await resolveToken(params.id);
  const body = await graphPost<GraphError & { success?: boolean }>(params.id, token, {
    daily_budget: unitsToCents(params.dailyBudget),
  });

  if (body.error) {
    // Meta rejects budgets under the account minimum and CBO/ABO mismatches.
    throw new Error(`Budget refusé par Meta : ${body.error.message}`);
  }

  invalidateTreeCache();
  return { id: params.id, dailyBudget: params.dailyBudget };
}
