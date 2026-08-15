import { graphGet, requireMetaConfig, type GraphError } from "@/lib/meta/graph";
import { getTokenForAccount, getTokenForObject, rememberObjectToken } from "@/lib/meta/tree";

/**
 * An object is only reachable through the token of the Business Manager that
 * owns it. The tree sync records that mapping; when it is cold, each token is
 * probed once and the winner is memoised.
 */
export async function resolveToken(objectId: string): Promise<string> {
  const known = getTokenForObject(objectId);
  if (known) return known;

  if (objectId.startsWith("act_")) {
    const byAccount = getTokenForAccount(objectId);
    if (byAccount) return byAccount;
  }

  for (const token of requireMetaConfig().tokens) {
    const body = await graphGet<GraphError & { id?: string }>(`${objectId}?fields=id`, token);
    if (!body.error && body.id) {
      rememberObjectToken(objectId, token);
      return token;
    }
  }

  throw new Error("Aucun token Meta n'a accès à cet objet.");
}
