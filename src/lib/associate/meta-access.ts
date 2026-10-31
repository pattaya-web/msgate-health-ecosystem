import { getAssociateScope } from "@/lib/associate/scope";
import { sessionFromRequest } from "@/lib/auth/request";
import { graphGet, type GraphError } from "@/lib/meta/graph";
import { resolveToken } from "@/lib/meta/token";

/**
 * L'accès Meta Ads Manager de l'associé.
 *
 * Alison pilote les comptes pub de son périmètre comme l'admin pilote les
 * siens : voir, couper, relancer, changer un budget, renommer, retirer une
 * pub, publier avec l'uploader. Tout passe par les mêmes routes /api/meta/*,
 * qui appellent ce module quand la session est celle d'un associé :
 *   - en lecture, on ne lui renvoie que ses comptes ;
 *   - en écriture, Meta confirme d'abord à quel compte appartient l'objet
 *     visé (campagne, ad set, pub) ; hors de ses comptes, c'est un refus.
 * Les comptes retenus en entier dans Settings (« Comptes Meta Ads ») font son
 * périmètre ; le mot-clé de campagne ne donne aucun droit d'écriture.
 */

export class OutOfScopeError extends Error {
  constructor(message = "Ce compte pub n'est pas dans ton périmètre.") {
    super(message);
    this.name = "OutOfScopeError";
  }
}

/** Les comptes pub de l'associé (sans « act_ »), ou null quand la requête vient d'un admin/opérateur. */
export async function associateAccountsFor(request: Request): Promise<string[] | null> {
  const session = sessionFromRequest(request);
  if (session?.role !== "associate") return null;
  const scope = await getAssociateScope();
  return scope.metaAccountIds.map((id) => id.replace(/^act_/, ""));
}

const owners = ((globalThis as typeof globalThis & { __msgateMetaOwners?: Map<string, string> }).__msgateMetaOwners ??= new Map());

/** Le compte pub (sans « act_ ») qui possède une campagne, un ad set ou une pub, d'après Meta. */
export async function accountOfObject(objectId: string): Promise<string> {
  const id = objectId.trim();
  if (/^act_\d+$/.test(id)) return id.slice(4);
  const known = owners.get(id);
  if (known) return known;
  const token = await resolveToken(id);
  const body = await graphGet<GraphError & { account_id?: string }>(`${encodeURIComponent(id)}?fields=account_id`, token);
  if (body.error || !body.account_id) throw new OutOfScopeError("Objet Meta introuvable.");
  owners.set(id, body.account_id);
  return body.account_id;
}

/** Refuse si l'objet n'appartient pas à un des comptes autorisés. */
export async function assertObjectsInScope(objectIds: string[], allowed: string[]) {
  const allow = new Set(allowed);
  for (const id of objectIds) {
    const account = await accountOfObject(id);
    if (!allow.has(account)) throw new OutOfScopeError();
  }
}

export function assertAccountInScope(accountId: string, allowed: string[]) {
  if (!allowed.includes(accountId.replace(/^act_/, ""))) throw new OutOfScopeError();
}
