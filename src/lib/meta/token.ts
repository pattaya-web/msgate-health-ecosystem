import { getMetaConfigWithExtras } from "@/lib/meta/client";
import { graphGet, type GraphError } from "@/lib/meta/graph";
import { getTokenForAccount, getTokenForObject, rememberObjectToken } from "@/lib/meta/tree";

/**
 * An object is only reachable through the token of the Business Manager that
 * owns it. The tree sync records that mapping; when it is cold, each token is
 * probed once and the winner is memoised.
 */
const deadTokens = ((globalThis as typeof globalThis & { __msgateDeadTokens?: Map<string, number> }).__msgateDeadTokens ??= new Map<string, number>());

export async function resolveToken(objectId: string): Promise<string> {
  const known = getTokenForObject(objectId);
  if (known) return known;

  if (objectId.startsWith("act_")) {
    const byAccount = getTokenForAccount(objectId);
    if (byAccount) return byAccount;
  }

  // Tous les jetons, y compris ceux d'agence collés dans l'outil (Badgal Collection…) : sans eux, leurs comptes restaient introuvables.
  const config = await getMetaConfigWithExtras();
  if (!config) throw new Error("Meta n'est pas branché (META_ACCESS_TOKENS)");
  // Les jetons coupés chez Meta (« API access deactivated », expirés) ne sont plus essayés pendant 30 min : un appel perdu de moins à chaque fois.
  const live = config.tokens.filter((token) => (deadTokens.get(token) ?? 0) < Date.now());
  for (const token of live.length ? live : config.tokens) {
    const body = await graphGet<GraphError & { id?: string }>(`${objectId}?fields=id`, token);
    if (!body.error && body.id) {
      rememberObjectToken(objectId, token);
      return token;
    }
    if (body.error && /deactivated|expired|session has been invalidated|Error validating access token/i.test(body.error.message)) deadTokens.set(token, Date.now() + 30 * 60_000);
  }

  throw new Error("Aucun token Meta n'a accès à cet objet.");
}
