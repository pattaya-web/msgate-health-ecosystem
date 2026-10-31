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
  /** ARCHIVED retire l'objet de la diffusion et des listes (il reste consultable dans Meta). */
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
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

/** Renomme une campagne, un ad set ou une pub. */
export async function setEntityName(params: { id: string; level: EntityLevel; name: string }) {
  const name = params.name.trim().slice(0, 400);
  if (!name) throw new Error("Le nom ne peut pas être vide.");
  const token = await resolveToken(params.id);
  const body = await graphPost<GraphError & { success?: boolean }>(params.id, token, { name });
  if (body.error) {
    throw new Error(`Impossible de renommer ${LEVEL_LABEL[params.level]} : ${body.error.message}`);
  }
  invalidateTreeCache();
  return { id: params.id, name };
}
