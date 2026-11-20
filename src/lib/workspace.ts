/**
 * Les espaces dédiés à un shop (Moosha…) : son Studio IA, son Montage et son
 * Drive, séparés de ceux du reste du CRM.
 *
 * L'espace se lit dans l'adresse de la page (/moosha/...) et part avec chaque
 * appel du navigateur (en-tête `x-msgate-workspace`, ou `?ws=` pour un lien
 * d'image ou de téléchargement). Chaque onglet porte donc le sien : on peut
 * garder le Studio général et celui de Moosha ouverts côte à côte sans que
 * leurs créations se mélangent.
 */

export type Workspace = {
  id: string;
  label: string;
  /** Dossier racine du Drive de l'espace. */
  driveRoot: string;
  /** Photos de l'avatar du shop, affichées en haut de son Studio IA (fichiers dans public/). */
  avatars?: { label: string; src: string }[];
};

export const WORKSPACES: Record<string, Workspace> = {
  moosha: {
    id: "moosha",
    label: "Moosha",
    driveRoot: "Moosha",
    avatars: [
      { label: "Planche (3 photos)", src: "/avatars/moosha/avatar-planche.png" },
      { label: "Visage", src: "/avatars/moosha/avatar-tete.png" },
    ],
  },
};

export const WORKSPACE_HEADER = "x-msgate-workspace";

export function workspaceFromPath(pathname: string): Workspace | null {
  const first = pathname.split("/").filter(Boolean)[0] ?? "";
  return WORKSPACES[first] ?? null;
}

/** Navigateur : l'espace de la page affichée. */
export function currentWorkspace(): Workspace | null {
  if (typeof window === "undefined") return null;
  return workspaceFromPath(window.location.pathname);
}

/** En-têtes à joindre à un appel du navigateur. */
export function workspaceHeaders(): Record<string, string> {
  const ws = currentWorkspace();
  return ws ? { [WORKSPACE_HEADER]: ws.id } : {};
}

/** `&ws=moosha` à ajouter à une adresse lue sans en-tête (image, téléchargement). */
export function workspaceQuery(prefix = "&"): string {
  const ws = currentWorkspace();
  return ws ? `${prefix}ws=${ws.id}` : "";
}

/** Serveur : l'espace d'une requête (en-tête, sinon `?ws=`). */
export function workspaceFromRequest(request: Request): Workspace | null {
  const header = request.headers.get(WORKSPACE_HEADER)?.trim().toLowerCase();
  const query = new URL(request.url).searchParams.get("ws")?.trim().toLowerCase();
  return WORKSPACES[header || query || ""] ?? null;
}

/** Ce qu'un espace voit : ses éléments, ou (hors espace) ceux qui n'appartiennent à aucun. */
export function inWorkspace(item: { workspace?: string | null }, ws: Workspace | null) {
  return ws ? item.workspace === ws.id : !item.workspace;
}
