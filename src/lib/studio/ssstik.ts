const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function isTikTokUrl(value: string) {
  try {
    const host = new URL(value.trim()).hostname.replace(/^www\./, "");
    return (
      host === "tiktok.com" ||
      host === "vm.tiktok.com" ||
      host === "vt.tiktok.com" ||
      host.endsWith(".tiktok.com")
    );
  } catch {
    return false;
  }
}

function cookieHeader(res: Response) {
  const raw = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  if (raw.length) return raw.map((item) => item.split(";")[0]).join("; ");
  const single = res.headers.get("set-cookie");
  return single ? single.split(";")[0] : "";
}

function pickTt(html: string, cookies: string) {
  return (
    html.match(/s_tt\s*=\s*['"]([^'"]+)/)?.[1] ||
    html.match(/\btt:\s*['"]([^'"]+)/)?.[1] ||
    html.match(/name=["']tt["'][^>]*value=["']([^'"]+)/i)?.[1] ||
    html.match(/value=["']([^'"]+)["'][^>]*name=["']tt["']/i)?.[1] ||
    decodeURIComponent(cookies.match(/(?:^|;\s*)s_tt=([^;]+)/)?.[1] || "") ||
    decodeURIComponent(cookies.match(/(?:^|;\s*)tt=([^;]+)/)?.[1] || "")
  );
}

function hrefs(html: string) {
  return [...html.matchAll(/href="(https?:[^"]+)"/gi)].map((match) => match[1].replace(/&amp;/g, "&"));
}

function preferVideo(urls: string[]) {
  const unique = [...new Set(urls)];
  return (
    unique.find((url) => /ssscdn|tiktokcdn|musicaldown|snaptik|hdplay|download/i.test(url) && !/mp3|music|audio/i.test(url)) ||
    unique.find((url) => !/mp3|music|audio|css|js|png|jpg/i.test(url) && /^https?:\/\//.test(url))
  );
}

async function viaSsstik(tiktokUrl: string) {
  const home = await fetch("https://ssstik.io/", {
    headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
    cache: "no-store",
  });
  const html = await home.text();
  const cookies = cookieHeader(home);
  const tt = pickTt(html, cookies);
  if (!tt) throw new Error("Token ssstik introuvable");

  const posted = await fetch("https://ssstik.io/abc?url=dl", {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "hx-current-url": "https://ssstik.io/",
      "hx-request": "true",
      "hx-target": "target",
      "hx-trigger": "_gcaptcha_pt",
      Origin: "https://ssstik.io",
      Referer: "https://ssstik.io/",
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: new URLSearchParams({ id: tiktokUrl, locale: "en", tt }),
    cache: "no-store",
  });
  const result = await posted.text();
  if (/captcha|unusual traffic/i.test(result)) throw new Error("ssstik demande un captcha — réessaie dans un instant");
  const url = preferVideo(hrefs(result));
  if (!url) throw new Error("ssstik n’a pas renvoyé de MP4");
  return url;
}

async function viaTikwm(tiktokUrl: string) {
  const res = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(tiktokUrl)}&hd=1`, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    cache: "no-store",
  });
  const body = (await res.json()) as { data?: { hdplay?: string; play?: string }; msg?: string };
  const url = body.data?.hdplay || body.data?.play;
  if (!url) throw new Error(body.msg || "Lien TikTok illisible");
  return url.startsWith("//") ? `https:${url}` : url;
}

export async function resolveTikTokMp4(tiktokUrl: string) {
  const clean = tiktokUrl.trim();
  if (!isTikTokUrl(clean)) throw new Error("Colle un lien TikTok public (tiktok.com / vm.tiktok.com)");
  try {
    return await viaSsstik(clean);
  } catch {
    return viaTikwm(clean);
  }
}

export async function fetchTikTokBuffer(mp4Url: string) {
  const res = await fetch(mp4Url, {
    headers: { "User-Agent": UA, Referer: "https://ssstik.io/" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Téléchargement MP4 échoué");
  return Buffer.from(await res.arrayBuffer());
}
