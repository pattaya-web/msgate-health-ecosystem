"use client";

import { useState } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Clip = { url: string; name: string; source: string };

export function TikTokDownloader() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);

  async function downloadOne(url: string) {
    const res = await fetch("/api/studio/tiktok", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `Échec ${url}`);
    }
    const blob = await res.blob();
    const id = url.match(/video\/(\d+)/)?.[1] || Date.now().toString();
    const name = `tiktok-${id}.mp4`;
    return { url: URL.createObjectURL(blob), name, source: url };
  }

  async function pull() {
    const urls = input
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (!urls.length) {
      toast.error("Colle un ou plusieurs liens TikTok");
      return;
    }
    setBusy(true);
    let ok = 0;
    for (const url of urls) {
      try {
        const clip = await downloadOne(url);
        setClips((cur) => [clip, ...cur]);
        ok += 1;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Download impossible");
      }
    }
    if (ok) {
      setInput("");
      toast.success(`${ok} vidéo(s) téléchargée(s)`);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">Download Tiktok</h1>
        <p className="text-[12px] text-slate-500">Colle un lien TikTok public — MP4 sans watermark via ssstik.</p>
      </div>

      <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          placeholder="https://www.tiktok.com/@…/video/…&#10;Un lien par ligne, ou plusieurs d’un coup"
          className="w-full resize-none rounded-xl bg-slate-50 px-3 py-2 text-[13px] outline-none dark:bg-slate-800"
        />
        <button
          type="button"
          onClick={() => void pull()}
          disabled={busy}
          className="mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-[13px] font-medium text-white dark:bg-white dark:text-slate-900"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Télécharger
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {clips.map((clip) => (
          <article key={clip.url} className="overflow-hidden rounded-xl bg-black ring-1 ring-slate-900/10">
            <video src={clip.url} controls preload="metadata" className="mx-auto max-h-44 w-full object-contain" />
            <div className="flex items-center justify-between bg-white px-1.5 py-1 dark:bg-slate-900">
              <a href={clip.url} download={clip.name} className="text-[10px] font-medium text-slate-700 dark:text-slate-200">
                DL MP4
              </a>
              <button type="button" onClick={() => setClips((cur) => cur.filter((item) => item.url !== clip.url))} className="text-slate-400">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
