/**
 * Creative files live on Meta's CDN, which blocks cross-origin reads, so the
 * browser cannot save them directly. The app proxies them instead — and since
 * the URL comes from the client, the host is checked before anything is
 * fetched, otherwise the route would be an open door to the internal network.
 */

const ALLOWED_HOSTS = [
  "fbcdn.net",
  "facebook.com",
  "fbsbx.com",
  "cdninstagram.com",
  "akamaihd.net",
];

export function isAllowedAssetUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    return ALLOWED_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
    );
  } catch {
    return false;
  }
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

/** Meta serves mp4 and jpg from paths with query strings; sniff both ends. */
export function extensionFor(url: string, contentType: string | null, kind?: "image" | "video") {
  const fromType = contentType ? EXTENSIONS[contentType.split(";")[0].trim()] : undefined;
  if (fromType) return fromType;

  const path = url.split("?")[0];
  const match = path.match(/\.(jpe?g|png|webp|gif|mp4|mov)$/i);
  if (match) return match[1].toLowerCase().replace("jpeg", "jpg");

  return kind === "video" ? "mp4" : "jpg";
}

/** Windows, macOS and zip entries all choke on a different subset; strip all. */
export function safeFileName(value: string, fallback = "creative") {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

export function contentDisposition(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Browser-safe media URL — Meta CDN / permalink often block hotlinking. */
export function proxyMediaUrl(
  url: string,
  opts?: { name?: string; kind?: "image" | "video"; inline?: boolean }
) {
  if (url.startsWith("/api/meta/asset")) return url;
  const params = new URLSearchParams({
    url,
    name: opts?.name || "preview",
    kind: opts?.kind || "image",
  });
  if (opts?.inline !== false) params.set("inline", "1");
  return `/api/meta/asset?${params}`;
}
