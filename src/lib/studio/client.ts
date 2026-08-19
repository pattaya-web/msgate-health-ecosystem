export type StudioTask = {
  taskId: string;
  state?: string;
  urls: string[];
  failMsg?: string;
};

export async function studioPost<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/studio", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Studio indisponible");
  return data;
}

export function assetProxy(url: string) {
  return `/api/studio/asset?url=${encodeURIComponent(url)}`;
}

export function libraryFileUrl(id: string, file: string) {
  return `/api/studio/library/file?id=${encodeURIComponent(id)}&file=${encodeURIComponent(file)}`;
}

export async function saveStaticCreative(body: {
  brief?: string;
  prompt: string;
  ratio: "1:1" | "9:16" | "3:4";
  resolution: "1K" | "2K";
  resultUrls: string[];
  referenceUrls?: string[];
}) {
  const res = await fetch("/api/studio/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error || "Sauvegarde créa impossible");
}

export async function pollStudioTask(taskId: string, tries = 60): Promise<StudioTask> {
  let emptyOk = 0;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`/api/studio?taskId=${encodeURIComponent(taskId)}`);
    const body = (await res.json()) as StudioTask & { error?: string };
    if (!res.ok) throw new Error(body.error || "Poll impossible");
    const state = (body.state || "").toLowerCase();
    if ((state === "success" || state === "completed" || state === "finished") && body.urls?.length) {
      return body;
    }
    if (state === "success" || state === "completed" || state === "finished") {
      emptyOk += 1;
      if (emptyOk >= 6) throw new Error("Tâche OK mais aucune image renvoyée");
    }
    if (state === "fail" || state === "failed" || state === "error") {
      throw new Error(body.failMsg || "Génération échouée");
    }
    await new Promise((r) => setTimeout(r, i < 4 ? 1200 : 2200));
  }
  throw new Error("Timeout — réessaie");
}
