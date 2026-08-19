"use client";

import { useMemo, useState } from "react";
import { Download, Loader2, Mic, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { assetProxy, pollStudioTask, studioPost } from "@/lib/studio/client";
import { STUDIO_VOICES, voicePreviewUrl } from "@/lib/studio/voices";
import { cn } from "@/lib/utils";

const COUNTS = [1, 2, 3, 5];

export function BasicStudio() {
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(3);
  const [scripts, setScripts] = useState<string[]>([]);
  const [pageLabel, setPageLabel] = useState("");
  const [script, setScript] = useState("");
  const [voice, setVoice] = useState(STUDIO_VOICES[0].id);
  const [customVoice, setCustomVoice] = useState("");
  const [qVoice, setQVoice] = useState("");
  const [audio, setAudio] = useState("");
  const [busy, setBusy] = useState<"scripts" | "tts" | null>(null);

  const voices = useMemo(() => {
    const q = qVoice.trim().toLowerCase();
    if (!q) return STUDIO_VOICES;
    return STUDIO_VOICES.filter(
      (item) => item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
    );
  }, [qVoice]);

  const voiceId = customVoice.trim() || voice;

  async function makeScripts() {
    if (!brief.trim()) {
      toast.error("Colle l’URL produit + tes consignes");
      return;
    }
    setBusy("scripts");
    try {
      const body = await studioPost<{ scripts: string[]; productTitle?: string }>({
        action: "vo",
        brief,
        count,
      });
      setScripts(body.scripts || []);
      setPageLabel(body.productTitle || "");
      if (body.scripts?.[0]) setScript(body.scripts[0]);
      toast.success(body.productTitle ? `Page lue — ${body.productTitle}` : `${body.scripts?.length || 0} script(s)`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Scripts impossibles");
    } finally {
      setBusy(null);
    }
  }

  async function makeVoice() {
    if (!script.trim()) {
      toast.error("Script manquant");
      return;
    }
    setBusy("tts");
    try {
      const started = await studioPost<{ taskId: string }>({
        action: "tts",
        text: script.trim(),
        voice: voiceId,
        timestamps: false,
      });
      const done = await pollStudioTask(started.taskId);
      if (!done.urls[0]) throw new Error("Audio manquant");
      const blob = await fetch(assetProxy(done.urls[0])).then((res) => {
        if (!res.ok) throw new Error("Audio illisible");
        return res.blob();
      });
      if (audio) URL.revokeObjectURL(audio);
      setAudio(URL.createObjectURL(blob));
      toast.success("Voix prête");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Voix impossible");
    } finally {
      setBusy(null);
    }
  }

  function downloadAudio() {
    if (!audio) return;
    const a = document.createElement("a");
    a.href = audio;
    a.download = `voix-${voiceId.slice(0, 6)}.mp3`;
    a.click();
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <aside className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
        <p className="text-[12px] font-semibold">Brief → scripts</p>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={8}
          placeholder={"https://ton-produit.com/...\nUGC femme 30 ans, hook prix, CTA shop now, 12 secondes"}
          className="w-full resize-none rounded-xl bg-slate-50 px-2.5 py-2 text-[12px] leading-relaxed outline-none dark:bg-slate-800"
        />
        <div className="flex flex-wrap gap-1">
          {COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setCount(n)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[11px] font-medium",
                count === n ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-100 text-slate-600 dark:bg-slate-800"
              )}
            >
              ×{n}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void makeScripts()}
          disabled={busy !== null}
          className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg bg-slate-100 text-[12px] font-medium dark:bg-slate-800"
        >
          {busy === "scripts" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          Sortir les scripts
        </button>
        {pageLabel ? <p className="text-[11px] text-emerald-700 dark:text-emerald-400">Page lue : {pageLabel}</p> : null}
        <div className="max-h-[42vh] space-y-1 overflow-auto">
          {scripts.map((item, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setScript(item)}
              className={cn(
                "block w-full rounded-lg p-2 text-left text-[12px] leading-relaxed",
                script === item ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-50 dark:bg-slate-800"
              )}
            >
              {item}
            </button>
          ))}
        </div>
      </aside>

      <section className="space-y-2 rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70">
        <p className="text-[12px] font-semibold">ElevenLabs · voix</p>
        <input
          value={qVoice}
          onChange={(e) => setQVoice(e.target.value)}
          placeholder="Rechercher une voix"
          className="h-8 w-full rounded-lg bg-slate-50 px-2.5 text-[12px] outline-none dark:bg-slate-800"
        />
        <div className="grid max-h-52 grid-cols-2 gap-1 overflow-auto sm:grid-cols-3">
          {voices.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setVoice(item.id);
                setCustomVoice("");
              }}
              className={cn(
                "rounded-lg px-2 py-1.5 text-left",
                voiceId === item.id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : "bg-slate-50 dark:bg-slate-800"
              )}
            >
              <span className="block truncate text-[11px] font-medium">{item.label}</span>
              <span className="block truncate text-[10px] opacity-70">{item.hint}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const el = document.getElementById("voice-preview") as HTMLAudioElement | null;
              if (!el) return;
              el.src = assetProxy(voicePreviewUrl(voiceId));
              void el.play();
            }}
            className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-100 px-2.5 text-[11px] font-medium dark:bg-slate-800"
          >
            <Play className="h-3 w-3" />
            Preview
          </button>
          <input
            value={customVoice}
            onChange={(e) => setCustomVoice(e.target.value)}
            placeholder="Voice ID custom (optionnel)"
            className="h-8 flex-1 rounded-lg bg-slate-50 px-2.5 text-[11px] outline-none dark:bg-slate-800"
          />
        </div>
        <audio id="voice-preview" className="hidden" />

        <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Script</p>
        <textarea
          value={script}
          onChange={(e) => setScript(e.target.value)}
          rows={6}
          placeholder="Colle ou édite le script voix-off ici"
          className="w-full resize-y rounded-xl bg-slate-50 px-2.5 py-2 text-[13px] leading-relaxed outline-none dark:bg-slate-800"
        />
        <button
          type="button"
          onClick={() => void makeVoice()}
          disabled={busy !== null}
          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-[13px] font-medium text-white dark:bg-white dark:text-slate-900"
        >
          {busy === "tts" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
          Générer la voix
        </button>
        {audio ? (
          <div className="space-y-2 rounded-xl bg-slate-50 p-2 dark:bg-slate-800">
            <audio src={audio} controls className="w-full" />
            <button
              type="button"
              onClick={downloadAudio}
              className="inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg bg-white text-[12px] font-medium ring-1 ring-slate-900/10 dark:bg-slate-900"
            >
              <Download className="h-3.5 w-3.5" />
              Télécharger MP3
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
