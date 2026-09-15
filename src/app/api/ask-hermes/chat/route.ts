import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hermesChatConfig } from "@/lib/ask-hermes/config";
import { loadCreativeImageDataUrl, loadCreativeRecord, loadProductRecord } from "@/lib/ask-hermes/creative";
import { systemLayer, userText } from "@/lib/ask-hermes/prompt";
import { CONVERSATION_ID_PATTERN, type PageContext, type StreamEvent } from "@/lib/ask-hermes/types";
import { HermesUpstreamError, openHermesStream, parseHermesSse, type UpstreamMessage } from "@/lib/ask-hermes/upstream";
import { getAuthSecret, SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/*
 * POST /api/ask-hermes/chat — un tour de conversation avec l'instance Hermes.
 *
 * Protégé par la session CRM (src/proxy.ts refuse sans cookie signé) ; la clé
 * de l'API Server de Hermes ne quitte jamais ce processus. La réponse est un
 * flux NDJSON (une ligne JSON par événement, cf. StreamEvent) relayé depuis le
 * SSE de Hermes ; fermer la requête interrompt Hermes.
 */

const SAFE_ID = /^[\w-]+$/;
const DATA_URL = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;
const MAX_IMAGE_CHARS = 5_500_000;
const MAX_TOTAL_CHARS = 9_000_000;

const contextSchema = z
  .object({
    route: z.string().max(300),
    pageType: z.string().max(40),
    storeId: z.string().max(120).optional(),
    storeName: z.string().max(200).optional(),
    productId: z.string().max(120).optional(),
    productName: z.string().max(300).optional(),
    productUrl: z.string().max(1000).optional(),
    batchId: z.string().max(120).optional(),
    batchNumber: z.number().int().nonnegative().optional(),
    creativeId: z.string().max(120).optional(),
    creativeName: z.string().max(300).optional(),
    creativeImageUrl: z.string().max(500).optional(),
    primaryReferenceUrl: z.string().max(1000).optional(),
    primaryReferenceType: z.string().max(40).optional(),
    campaignId: z.string().max(120).optional(),
    campaignName: z.string().max(300).optional(),
    adsetId: z.string().max(120).optional(),
    adsetName: z.string().max(300).optional(),
    adId: z.string().max(120).optional(),
    adName: z.string().max(300).optional(),
  })
  .strict();

const bodySchema = z
  .object({
    conversationId: z.string().regex(CONVERSATION_ID_PATTERN),
    message: z.string().max(20_000),
    context: contextSchema.optional(),
    creative: z.object({ batchId: z.string().regex(SAFE_ID), creativeId: z.string().regex(SAFE_ID) }).nullable().optional(),
    images: z.array(z.object({ name: z.string().max(160), dataUrl: z.string().max(MAX_IMAGE_CHARS).regex(DATA_URL) })).max(4).optional(),
    action: z.enum(["analyze", "original", "reverse", "angle", "variations"]).optional(),
  })
  .strict();

function encodeEvent(event: StreamEvent) {
  return `${JSON.stringify(event)}\n`;
}

function sessionKeyFor(request: NextRequest) {
  const session = verifySession(request.cookies.get(SESSION_COOKIE)?.value, getAuthSecret());
  const scope = session ? createHash("sha256").update(session.email.toLowerCase()).digest("hex").slice(0, 16) : "anonymous";
  return `msgate-crm:${scope}`;
}

export async function POST(request: NextRequest) {
  const config = hermesChatConfig();
  if (!config) {
    return NextResponse.json({ error: "Hermes n'est pas configuré : HERMES_API_URL et HERMES_API_SERVER_KEY manquent." }, { status: 503 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON illisible." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Requête invalide.", details: z.treeifyError(parsed.error) }, { status: 400 });
  }
  const body = parsed.data;
  const images = body.images ?? [];
  if (images.reduce((sum, image) => sum + image.dataUrl.length, 0) > MAX_TOTAL_CHARS) {
    return NextResponse.json({ error: "Images trop lourdes : réduis-les ou envoie-les en plusieurs messages." }, { status: 413 });
  }
  if (!body.message.trim() && !images.length && !body.creative) {
    return NextResponse.json({ error: "Message vide." }, { status: 400 });
  }

  // Métadonnées réelles de la créa visée : jointe explicitement, sinon celle de la page.
  const creativeRef = body.creative ?? (body.context?.batchId && body.context?.creativeId ? { batchId: body.context.batchId, creativeId: body.context.creativeId } : null);
  const creative = creativeRef && SAFE_ID.test(creativeRef.batchId) && SAFE_ID.test(creativeRef.creativeId) ? await loadCreativeRecord(creativeRef.batchId, creativeRef.creativeId) : null;
  if (body.creative && !creative) {
    return NextResponse.json({ error: "Cette créa n'existe plus dans le Creative Engine." }, { status: 404 });
  }
  const crmImage = body.creative && creative ? await loadCreativeImageDataUrl(creative) : null;
  if (body.creative && !crmImage) {
    return NextResponse.json({ error: "L'image de cette créa n'est pas encore générée." }, { status: 409 });
  }

  const environment = (process.env.NEXT_PUBLIC_APP_ENV ?? (process.env.VERCEL_ENV === "production" ? "production" : "local")).trim() || "local";
  const product = body.context?.productId && SAFE_ID.test(body.context.productId) ? await loadProductRecord(body.context.productId) : null;
  const system = systemLayer({
    environment,
    context: (body.context as PageContext | undefined) ?? null,
    creative,
    product,
    action: body.action,
    externalImages: images.length,
    crmImageAttached: Boolean(crmImage),
  });
  const text = userText(body.message, { creative, crmImageAttached: Boolean(crmImage), externalImages: images });
  const parts: Extract<UpstreamMessage, { role: "user" }>["content"] = [{ type: "text", text: text || "(voir pièces jointes)" }];
  if (crmImage) parts.push({ type: "image_url", image_url: { url: crmImage, detail: "high" } });
  for (const image of images) parts.push({ type: "image_url", image_url: { url: image.dataUrl, detail: "high" } });
  const messages: UpstreamMessage[] = [
    { role: "system", content: system },
    { role: "user", content: parts.length === 1 ? text : parts },
  ];

  let upstream: Response;
  try {
    upstream = await openHermesStream({ config, messages, sessionId: body.conversationId, sessionKey: sessionKeyFor(request), signal: request.signal });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const status = error instanceof HermesUpstreamError ? (error.status === 429 ? 429 : 502) : 502;
    const message = error instanceof Error ? error.message : "Hermes est injoignable.";
    return NextResponse.json({ error: message }, { status });
  }

  const sessionId = upstream.headers.get("x-hermes-session-id") ?? body.conversationId;
  const encoder = new TextEncoder();
  const upstreamBody = upstream.body as ReadableStream<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (event: StreamEvent) => controller.enqueue(encoder.encode(encodeEvent(event)));
      push({ t: "meta", sessionId, creative: creative ? { name: creative.name, batchNumber: creative.batchNumber } : null });
      let finished = false;
      try {
        for await (const event of parseHermesSse(upstreamBody)) {
          if (event.kind === "delta") push({ t: "delta", text: event.text });
          else if (event.kind === "tool") push({ t: "tool", name: event.name, label: event.label, status: event.status, emoji: event.emoji, id: event.id });
          else if (event.kind === "finish") {
            finished = true;
            push({ t: "done", finish: event.reason, error: event.error });
          }
        }
        if (!finished) push({ t: "done", finish: "stop" });
      } catch (error) {
        if (!request.signal.aborted) push({ t: "error", message: error instanceof Error ? error.message : "Flux interrompu." });
      } finally {
        controller.close();
      }
    },
    cancel() {
      upstreamBody.cancel().catch(() => undefined);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
