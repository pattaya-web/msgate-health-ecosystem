const KIE = "https://api.kie.ai/api/v1";

function key() {
  const value = process.env.KIE_API_KEY?.trim();
  if (!value) throw new Error("KIE_API_KEY manquante dans .env.local");
  return value;
}

export function toRawBase64(data: string) {
  const i = data.indexOf("base64,");
  return i >= 0 ? data.slice(i + 7) : data;
}

async function kie<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${KIE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  const body = (await res.json()) as T & { code?: number; msg?: string; message?: string };
  if (!res.ok || (typeof body.code === "number" && body.code !== 200)) {
    const raw = body.msg || body.message || "";
    throw new Error(!raw || /no message available/i.test(raw) ? `Kie ${res.status}` : raw);
  }
  return body;
}

export type KieTask = {
  taskId: string;
  state?: string;
  urls: string[];
  failMsg?: string;
  raw?: unknown;
};

export async function createKieTask(model: string, input: Record<string, unknown>) {
  const body = await kie<{ data?: { taskId?: string } }>("/jobs/createTask", {
    method: "POST",
    body: JSON.stringify({ model, input }),
  });
  const taskId = body.data?.taskId;
  if (!taskId) throw new Error("Kie n’a pas renvoyé de taskId");
  return taskId;
}

function collectUrls(value: unknown, into: string[]) {
  if (!value) return;
  if (typeof value === "string") {
    if (!/^https?:\/\//i.test(value)) return;
    if (/\.(png|jpe?g|webp|gif|mp3|wav|m4a|ogg|webm|mp4)(\?|$)/i.test(value)) {
      into.push(value);
      return;
    }
    if (/(aiquickdraw|kie\.ai|redpandaai|cloudfront|s3\.|oss\.|aliyuncs|googleapis|fal\.ai)/i.test(value)) {
      into.push(value);
    }
    return;
  }
  if (Array.isArray(value)) value.forEach((item) => collectUrls(item, into));
  else if (typeof value === "object") Object.values(value as Record<string, unknown>).forEach((item) => collectUrls(item, into));
}

export async function getKieTask(taskId: string): Promise<KieTask> {
  const body = await kie<{
    data?: {
      taskId?: string;
      state?: string;
      status?: string;
      failMsg?: string;
      failCode?: string;
      errorMessage?: string;
      resultJson?: string;
      resultUrls?: string[];
      response?: unknown;
      result?: unknown;
    };
  }>(`/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
  const data = body.data || {};
  const urls: string[] = [];
  if (Array.isArray(data.resultUrls)) collectUrls(data.resultUrls, urls);
  if (data.resultJson) {
    try {
      collectUrls(JSON.parse(data.resultJson), urls);
    } catch {
      // ignore
    }
  }
  collectUrls(data.response, urls);
  collectUrls(data.result, urls);
  const failRaw = data.failMsg || data.errorMessage || "";
  const failMsg =
    !failRaw || /no message available/i.test(failRaw)
      ? undefined
      : failRaw;
  return {
    taskId: data.taskId || taskId,
    state: data.state || data.status || "waiting",
    urls: [...new Set(urls)],
    failMsg,
    raw: data,
  };
}

export async function uploadBase64(dataUrlOrB64: string, fileName: string) {
  const res = await fetch("https://kieai.redpandaai.co/api/file-base64-upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      base64Data: dataUrlOrB64.includes("base64,") ? dataUrlOrB64 : `data:image/png;base64,${dataUrlOrB64}`,
      uploadPath: "msgate-studio",
      fileName,
    }),
    cache: "no-store",
  });
  const body = (await res.json()) as {
    code?: number;
    msg?: string;
    data?: { fileUrl?: string; downloadUrl?: string };
  };
  if (!res.ok || (typeof body.code === "number" && body.code !== 200)) {
    const raw = body.msg || "";
    throw new Error(!raw || /no message available/i.test(raw) ? "Upload Kie impossible" : raw);
  }
  const url = body.data?.fileUrl || body.data?.downloadUrl;
  if (!url) throw new Error("Upload Kie sans URL");
  return url;
}

export async function uploadFromUrl(fileUrl: string, fileName?: string) {
  const res = await fetch("https://kieai.redpandaai.co/api/file-url-upload", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileUrl,
      uploadPath: "msgate-studio",
      fileName: fileName || `ref-${Date.now()}.png`,
    }),
    cache: "no-store",
  });
  const body = (await res.json()) as {
    code?: number;
    msg?: string;
    data?: { fileUrl?: string; downloadUrl?: string };
  };
  if (!res.ok || (typeof body.code === "number" && body.code !== 200)) {
    throw new Error(body.msg || "Upload URL Kie impossible");
  }
  const url = body.data?.fileUrl || body.data?.downloadUrl;
  if (!url) throw new Error("Upload Kie sans URL");
  return url;
}

export function isKieDone(state?: string) {
  const value = (state || "").toLowerCase();
  return value === "success" || value === "completed" || value === "finished";
}

export function isKieFailed(state?: string) {
  const value = (state || "").toLowerCase();
  return value === "fail" || value === "failed" || value === "error";
}

export async function kieClaude(userText: string, maxTokens = 4000) {
  const res = await fetch("https://api.kie.ai/claude/v1/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      stream: false,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: userText }],
    }),
    cache: "no-store",
  });
  const body = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
    msg?: string;
  };
  const text = (body.content || []).map((block) => block.text || "").join("\n").trim();
  if (!res.ok || !text) {
    throw new Error(body.error?.message || body.msg || "Claude (Kie) indisponible");
  }
  return text;
}

export async function pollKieTask(taskId: string, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const task = await getKieTask(taskId);
    if (isKieDone(task.state)) {
      if (!task.urls.length) throw new Error("Tâche OK mais aucun fichier renvoyé");
      return task;
    }
    if (isKieFailed(task.state)) {
      throw new Error(task.failMsg || "Génération Kie échouée");
    }
    await new Promise((r) => setTimeout(r, i < 4 ? 2000 : 3500));
  }
  throw new Error("Timeout Kie — réessaie dans un instant");
}
