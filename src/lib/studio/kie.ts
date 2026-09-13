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

/** Solde du compte, en crédits Kie : l'endpoint renvoie le nombre brut dans `data`. */
export async function getKieCredit(): Promise<number> {
  const body = await kie<{ data?: number }>("/chat/credit");
  if (typeof body.data !== "number") throw new Error("Kie n’a pas renvoyé de solde");
  return body.data;
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

/**
 * `images` : base64 JPEG bruts, joints avant le texte. Sert à faire décrire des
 * images clés — cadrage, angle, échelle de plan — pour rejouer un montage.
 */
/**
 * Type d'image lu sur les premiers octets, pas declare au juge.
 *
 * Le type etait fige sur `image/jpeg` : un PNG partait donc annonce comme un
 * JPEG, le modele ne le decodait pas et repondait « no image came through with
 * your message » — un message qui accuse l'envoi alors que le tort est dans
 * l'etiquette. Les vignettes extraites par ffmpeg sont bien des JPEG, mais un
 * visuel depose par l'utilisateur est le plus souvent un PNG.
 */
function sniffImageType(base64: string) {
  if (base64.startsWith("iVBORw0KGgo")) return "image/png" as const;
  if (base64.startsWith("R0lGOD")) return "image/gif" as const;
  if (base64.startsWith("UklGR")) return "image/webp" as const;
  return "image/jpeg" as const;
}

export async function kieClaude(userText: string, maxTokens = 4000, images: string[] = []) {
  const content = images.length
    ? [
        ...images.filter(Boolean).map((raw) => {
          const data = toRawBase64(raw);
          return {
            type: "image" as const,
            source: { type: "base64" as const, media_type: sniffImageType(data), data },
          };
        }),
        { type: "text" as const, text: userText },
      ]
    : userText;

  /**
   * Cascade de modèles plutôt que relances sur un seul.
   *
   * Kie sert ses modèles Claude de façon inégale : un même identifiant peut
   * répondre en texte et rendre 429 sur une requête avec image, et cette
   * disponibilité bouge d'un jour à l'autre. Le message renvoyé — « Internal
   * error, please try again later » — laisse croire à une panne générale alors
   * que le voisin répond parfaitement.
   *
   * Insister sur un modèle indisponible ne mène donc à rien : on passe au
   * suivant. Une seule relance courte par modèle absorbe les vraies limites de
   * débit sans transformer un échec en attente de plusieurs minutes.
   */
  /*
   * Deux passages sur la liste plutôt qu'un.
   *
   * Les échecs reviennent immédiatement — 429 ou 500 sans délai — donc insister
   * ne coûte presque rien, alors qu'un modèle qui refuse à l'instant T répond
   * souvent trente secondes plus tard. Mesuré : trois tours ont été nécessaires
   * pour qu'un des trois accepte une image.
   */
  const MODELS = ["claude-opus-4-5", "claude-sonnet-4-6", "claude-opus-5"];
  /*
   * Assez large pour ne jamais couper une vraie génération, assez court devant
   * une passerelle pendue. Il suit la longueur demandée : un JSON de quelques
   * lignes revient en secondes, quatre mille jetons prennent leur temps, et
   * couper le second pour protéger le premier serait une régression.
   */
  const ATTEMPT_TIMEOUT_MS = Math.max(45_000, maxTokens * 30);
  /*
   * Budget total. Quand la passerelle est tombée pour de bon, chaque modèle
   * rend son erreur en une seconde et la cascade entière tient en dix ; mais
   * dès qu'un modèle pend, six tentatives de 45 s font attendre l'utilisateur
   * plusieurs minutes pour rien. Passé ce budget, on sort et on laisse la main
   * au repli — ou à l'erreur, qui au moins arrive vite.
   */
  const TOTAL_BUDGET_MS = 75_000;
  const started = Date.now();
  let lastMessage = "Claude (Kie) indisponible";

  /*
   * Sonde avant la vraie requête. Mesuré : un modèle en panne ne rend pas
   * toujours son erreur vite, il peut pendre jusqu'au timeout de la tentative
   * — deux minutes pour un storyboard — et l'utilisateur voit une roue sans
   * fin. Une requête de cinq jetons bornée à huit secondes dit tout de suite
   * si le modèle est vivant ; on ne dépense la longue tentative que sur lui.
   */
  const alive = async (model: string) => {
    try {
      const res = await fetch("https://api.kie.ai/claude/v1/messages", {
        method: "POST",
        headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, stream: false, max_tokens: 5, messages: [{ role: "user", content: "OK" }] }),
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  cascade: for (let pass = 0; pass < 2; pass += 1) {
    for (const model of MODELS) {
      if (Date.now() - started > TOTAL_BUDGET_MS) break cascade;
      if (!(await alive(model))) {
        lastMessage = `${model} indisponible chez Kie`;
        continue;
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (Date.now() - started > TOTAL_BUDGET_MS) break cascade;
        if (attempt || pass) await new Promise((resolve) => setTimeout(resolve, 1500));

        /*
         * Un modèle en panne ne doit pas manger le budget des suivants.
         *
         * Le commentaire au-dessus tient l'échec pour immédiat — 429 ou 500 sans
         * délai. C'est vrai de la plupart, pas de tous : mesuré, un modèle
         * indisponible a laissé la requête pendue 111 secondes avant de rendre
         * son 500. L'appelant abandonnait avant que la cascade ait seulement
         * essayé le troisième. On borne donc chaque tentative, et une coupure
         * vaut un échec de plus : on passe au modèle suivant.
         */
        let res: Response;
        try {
          res = await fetch("https://api.kie.ai/claude/v1/messages", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${key()}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              stream: false,
              max_tokens: maxTokens,
              messages: [{ role: "user", content }],
            }),
            cache: "no-store",
            signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
          });
        } catch {
          lastMessage = `${model} n'a pas répondu`;
          continue;
        }

        const body = (await res.json().catch(() => ({}))) as {
          content?: Array<{ type?: string; text?: string }>;
          error?: { message?: string };
          msg?: string;
        };
        const text = (body.content || []).map((block) => block.text || "").join("\n").trim();

        if (res.ok && text) {
          /*
           * Une réponse peut arriver sans que l'image soit passée : la
           * passerelle la perd, le modèle répond sur le texte seul et annonce
           * qu'il n'a rien reçu. C'est un échec, pas un résultat — sans ce
           * garde-fou l'appelant recevait de la prose au lieu de son JSON.
           */
          if (images.length && /no image|image attachment|didn't receive|did not receive|can'?t see (the|an) image|only the text/i.test(text)) {
            lastMessage = "L'image n'est pas arrivée jusqu'au modèle";
            continue;
          }
          return text;
        }

        lastMessage = body.error?.message || body.msg || lastMessage;
        // 4xx hors 429 : la requête est en cause, changer de modèle n'y fera rien.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw new Error(lastMessage);
        }
      }
    }
  }

  /**
   * Repli hors Kie. Le passage Claude de Kie tombe régulièrement pendant que
   * ses autres modèles répondent ; avec une clé Anthropic dans `.env.local`
   * (ANTHROPIC_API_KEY), l'écriture continue en direct. Sans clé, on remonte
   * l'erreur de Kie telle quelle.
   */
  const direct = process.env.ANTHROPIC_API_KEY?.trim();
  if (direct) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": direct,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5",
        max_tokens: maxTokens,
        messages: [{ role: "user", content }],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as {
      content?: Array<{ type?: string; text?: string }>;
      error?: { message?: string };
    };
    const text = (body.content || []).map((block) => block.text || "").join("\n").trim();
    if (res.ok && text) return text;
    lastMessage = body.error?.message || `Anthropic ${res.status}`;
  }

  throw new Error(`Aucun modèle Claude disponible chez Kie — ${lastMessage}`);
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
