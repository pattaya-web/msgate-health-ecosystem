"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { api, useCollection, useLocalState } from "@/lib/client";
import { uploadFile } from "@/lib/upload-client";
import { fmtInt, fmtUsd } from "@/lib/format";
import { TALKING_PHOTO } from "@/lib/studio-ia/config";
import type { StudioCharacter, StudioJob, TalkRequest, VoiceInfo } from "@/lib/studio-ia/types";
import { toSupportedImage } from "./MediaField";
import { ErrorNote, Field, useToast } from "./ui";
import { ThumbImg } from "@/components/studio-ia/MediaThumb";
import { loadVoices } from "@/lib/client";
import { takeFiles } from "@/lib/upload-client";
import { clipboardFiles, droppedFiles } from "@/lib/upload-client";

/**
 * Onglet « Photo qui parle » : une photo + une voix → une vidéo où la
 * personne parle, lèvres générées depuis l'audio (InfiniteTalk via KIE).
 *
 * C'est le workflow « avatar » du doc AI LIPSYNC (HeyGen / Hedra /
 * InfiniteTalk) : pas de vidéo source, tout le mouvement est inventé.
 */

interface Media {
  url: string;
  name: string;
}

const isImageName = (n: string) => /\.(jpe?g|png|webp|jfif|jpe|avif|heic|heif|bmp)$/i.test(n);

function Chip({ active, onClick, children, disabled }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" className="btn btn-sm" onClick={onClick} disabled={disabled} style={active ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>
      {children}
    </button>
  );
}

const VOICE_FILTERS: { id: string; label: string; test: (v: VoiceInfo) => boolean }[] = [
  { id: "all", label: "Toutes", test: () => true },
  { id: "cloned", label: "Clonées", test: (v) => v.category === "cloned" || v.category === "generated" },
  { id: "f", label: "Femme", test: (v) => v.gender === "female" },
  { id: "m", label: "Homme", test: (v) => v.gender === "male" },
];

export function TalkingPhoto({ jobs, onQueued }: { jobs: StudioJob[]; onQueued: (jobs: StudioJob[]) => void }) {
  const toast = useToast();
  const characters = useCollection<StudioCharacter>("studioCharacters");

  const [photo, setPhoto] = useState<Media | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [mode, setMode] = useLocalState<"text" | "file">("talk-mode", "text");
  const [text, setText] = useState("");
  const [voiceId, setVoiceId] = useLocalState<string>("talk-voice", "");
  const [voiceFilter, setVoiceFilter] = useState("all");
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [audio, setAudio] = useState<Media | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  const [scene, setScene] = useState("");
  const [resolution, setResolution] = useLocalState<"480p" | "720p">("talk-resolution", "720p");
  const [variants, setVariants] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    if (voices !== null) return;
    loadVoices()
      .then((r) => {
        setVoices(r.voices);
        if (!r.configured) setVoicesError("Aucune clé ElevenLabs : le texte lu demande une voix du compte. Tu peux quand même déposer un fichier audio.");
        else if (r.error) setVoicesError(r.error);
      })
      .catch((e: Error) => { setVoices([]); setVoicesError(e.message); });
  }, [voices]);
  useEffect(() => () => audioRef.current?.pause(), []);

  const list = useMemo(() => {
    const f = VOICE_FILTERS.find((x) => x.id === voiceFilter) ?? VOICE_FILTERS[0];
    return (voices ?? []).filter(f.test);
  }, [voices, voiceFilter]);
  const selectedVoice = voices?.find((v) => v.id === voiceId) ?? null;

  const recentPhotos = useMemo(() => {
    const seen = new Set<string>(characters.rows.map((c) => c.imageUrl));
    const out: Media[] = [];
    for (const j of jobs) {
      if (!j.referenceImage || seen.has(j.referenceImage)) continue;
      seen.add(j.referenceImage);
      out.push({ url: j.referenceImage, name: j.referenceImageName || "photo" });
      if (out.length >= 6) break;
    }
    return out;
  }, [jobs, characters.rows]);

  /** Estimation : 15 caractères par seconde de parole, tarif non vérifié. */
  const seconds = mode === "text" ? Math.max(1, Math.ceil(text.trim().length / 15)) : 0;
  const credits = seconds ? Math.round(TALKING_PHOTO.creditsPerSec[resolution] * seconds * variants) : 0;

  /* Ctrl+V : une capture devient la photo du personnage. */
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || busyRef.current) return;
      const f = clipboardFiles(e).find((x) => x.type.startsWith("image/"));
      if (!f) return;
      e.preventDefault();
      void setPhotoFile(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setPhotoFile = async (f: File) => {
    if (!isImageName(f.name) && !f.type.startsWith("image/")) { toast("Choisis une image.", "err"); return; }
    setPhotoBusy(true);
    try {
      const up = await uploadFile(await toSupportedImage(f));
      setPhoto({ url: up.url, name: f.name });
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setPhotoBusy(false);
    }
  };

  const setAudioFile = async (f: File) => {
    setAudioBusy(true);
    try {
      const up = await uploadFile(f);
      setAudio({ url: up.url, name: f.name });
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setAudioBusy(false);
    }
  };

  const preview = (v: VoiceInfo) => {
    if (!v.previewUrl) return;
    if (playing === v.id) { audioRef.current?.pause(); setPlaying(null); return; }
    audioRef.current?.pause();
    const a = new Audio(v.previewUrl);
    audioRef.current = a;
    a.onended = () => setPlaying(null);
    void a.play().catch(() => setPlaying(null));
    setPlaying(v.id);
  };

  const ready = Boolean(photo) && !photoBusy && !audioBusy && (mode === "text" ? Boolean(text.trim()) && Boolean(voiceId) : Boolean(audio));

  const submit = async () => {
    if (!photo) return;
    setBusy(true);
    setError(null);
    const body: TalkRequest = {
      referenceImage: photo.url,
      referenceImageName: photo.name,
      talkText: mode === "text" ? text : "",
      voiceId: mode === "text" ? voiceId : "",
      voiceName: mode === "text" ? selectedVoice?.name ?? "" : "",
      talkAudio: mode === "file" ? audio?.url ?? "" : "",
      talkPrompt: scene,
      resolution,
      variants,
    };
    try {
      const r = await api<{ jobs: StudioJob[] }>("/api/studio-ia/talk", { method: "POST", body: JSON.stringify(body) });
      onQueued(r.jobs);
      toast(r.jobs.length > 1 ? `${r.jobs.length} variantes lancées.` : "Vidéo lancée. Le résultat arrive dans Résultats.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 pt-1">
      <p className="dim text-[12.5px] leading-snug">
        Une photo, un texte ou un audio : la personne de la photo parle, lèvres et expressions générées depuis la voix.
        Pas de vidéo à tourner. Idéal pour un avatar récurrent (Nano Banana pour la photo, voix clonée pour le son).
      </p>

      {/* Photo */}
      <Field label="Photo du personnage" hint="Portrait ou buste, de face, visage net, bouche visible. JPG / PNG / WEBP.">
        <div className="flex gap-3 items-start flex-wrap">
          <label
            className="rounded-[10px] overflow-hidden grid place-items-center shrink-0"
            style={{ width: 132, height: 165, border: `1.5px ${photo ? "solid" : "dashed"} var(--border-strong)`, background: "var(--surface-2)", cursor: busy ? "not-allowed" : "pointer" }}
            title="Clique, dépose une photo ici, ou colle une capture (Ctrl+V)"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (busy) return; const f = droppedFiles(e).find((x) => x.type.startsWith("image/") || /\.(png|jpe?g|webp|heic|heif|avif)$/i.test(x.name)); if (f) void setPhotoFile(f); }}
          >
            {photoBusy ? <span className="spinner" /> : photo ? <ThumbImg src={photo.url} className="w-full h-full object-cover" /> : <span className="dim text-[12px] text-center px-2">+ Photo</span>}
            <input type="file" hidden accept="image/*,.jfif,.jpe,.heic,.heif,.avif" disabled={busy} onChange={async (e) => { const f = (await takeFiles(e.currentTarget))[0]; if (f) void setPhotoFile(f); }} />
          </label>
          {(characters.rows.length > 0 || recentPhotos.length > 0) && (
            <div className="flex flex-col gap-1.5">
              <span className="label-xs">Personnages récents</span>
              <div className="flex gap-1.5 flex-wrap">
                {characters.rows.map((c) => (
                  <button key={c.id} type="button" className="rounded-[8px] overflow-hidden" style={{ width: 52, border: `2px solid ${photo?.url === c.imageUrl ? "var(--accent)" : "var(--border)"}` }} title={c.name} onClick={() => setPhoto({ url: c.imageUrl, name: c.name })}>
                    <ThumbImg src={c.imageUrl} className="w-full object-cover" style={{ height: 62 }} />
                    <span className="block text-[9.5px] px-1 py-0.5 truncate" style={{ background: "var(--surface)" }}>{c.name}</span>
                  </button>
                ))}
                {recentPhotos.map((m) => (
                  <button key={m.url} type="button" className="rounded-[8px] overflow-hidden" style={{ width: 52, height: 62, border: `2px solid ${photo?.url === m.url ? "var(--accent)" : "var(--border)"}` }} title={m.name} onClick={() => setPhoto(m)}>
                    <ThumbImg src={m.url} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Field>

      {/* Source de la voix */}
      <Field label="Ce qu'elle dit">
        <div className="flex flex-col gap-2.5">
          <div className="flex gap-1.5 flex-wrap">
            <Chip active={mode === "text"} onClick={() => setMode("text")} disabled={busy}>Texte lu par une voix ElevenLabs ✨</Chip>
            <Chip active={mode === "file"} onClick={() => setMode("file")} disabled={busy}>Fichier audio ou vidéo</Chip>
          </div>

          {mode === "text" ? (
            <>
              <textarea className="textarea" style={{ minHeight: 96 }} placeholder="Le texte exact à dire. Phrases courtes, ponctuation naturelle : les pauses suivent la ponctuation." value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
              <div className="flex flex-col gap-2 rounded-[10px] p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                {voices === null ? (
                  <span className="dim text-[12px]"><span className="spinner" /> Chargement des voix…</span>
                ) : voicesError ? (
                  <span className="text-[12px]" style={{ color: "var(--warning)" }}>{voicesError}</span>
                ) : (
                  <>
                    <div className="flex gap-1.5 flex-wrap">
                      {VOICE_FILTERS.map((f) => <Chip key={f.id} active={voiceFilter === f.id} onClick={() => setVoiceFilter(f.id)} disabled={busy}>{f.label}</Chip>)}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <select className="select !w-auto !min-w-[260px] !h-[34px] !text-[12.5px] !py-0" value={voiceId} disabled={busy} onChange={(e) => setVoiceId(e.target.value)}>
                        <option value="">Choisir une voix…</option>
                        {list.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}{v.gender || v.age ? ` — ${[v.gender, v.age, v.accent].filter(Boolean).join(", ")}` : ""}{v.category === "cloned" ? " · clonée" : ""}
                          </option>
                        ))}
                      </select>
                      {selectedVoice?.previewUrl && (
                        <button className="btn btn-sm" onClick={() => preview(selectedVoice)}>{playing === selectedVoice.id ? "■ Stop" : "▶ Pré-écouter"}</button>
                      )}
                      <span className="dim text-[11px]">Voix clonée conseillée : plus naturelle qu&apos;une voix par défaut.</span>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <label className="btn" style={{ cursor: busy ? "not-allowed" : "pointer" }}>
                {audioBusy ? <span className="spinner" /> : audio ? "Remplacer le fichier" : "Déposer un mp3, m4a, wav ou mp4"}
                <input type="file" hidden accept="audio/*,video/*,.mp3,.m4a,.wav,.mp4,.mov" disabled={busy} onChange={async (e) => { const f = (await takeFiles(e.currentTarget))[0]; if (f) void setAudioFile(f); }} />
              </label>
              {audio && <span className="text-[12.5px] truncate max-w-[280px]">{audio.name}</span>}
              <span className="dim text-[11px]">D&apos;une vidéo, seule la piste audio est utilisée. {TALKING_PHOTO.maxAudioSec} s maximum.</span>
            </div>
          )}
        </div>
      </Field>

      <Field label="Scène (optionnel)" hint="Une phrase qui décrit la personne et l'ambiance guide les expressions. Vide : « une personne qui parle face caméra, naturelle »." >
        <input className="input" placeholder="Ex. jeune femme brune qui parle à la caméra dans un salon lumineux, ton complice" value={scene} onChange={(e) => setScene(e.target.value)} disabled={busy} />
      </Field>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-2.5">
        <div className="flex flex-col gap-1">
          <span className="label-xs">Résolution</span>
          <div className="flex gap-1.5">
            {(["480p", "720p"] as const).map((r) => <Chip key={r} active={resolution === r} onClick={() => setResolution(r)} disabled={busy}>{r}</Chip>)}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="label-xs">Variantes</span>
          <div className="inline-flex items-center rounded-full" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
            <button className="btn btn-sm btn-ghost !h-[30px] !px-2.5" disabled={busy || variants <= 1} onClick={() => setVariants((v) => Math.max(1, v - 1))}>−</button>
            <span className="num text-[13px] font-medium w-[22px] text-center">{variants}</span>
            <button className="btn btn-sm btn-ghost !h-[30px] !px-2.5" disabled={busy || variants >= 4} onClick={() => setVariants((v) => Math.min(4, v + 1))}>+</button>
          </div>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center justify-between gap-3 pt-3 flex-wrap" style={{ borderTop: "1px solid var(--border)" }}>
        <span className="dim text-[12px] leading-snug">
          {mode === "text" && text.trim() ? (
            <>
              <span className="font-medium" style={{ color: "var(--text)" }}>≈ {fmtInt(credits)} crédits</span> · {fmtUsd(credits * 0.005)}
              {variants > 1 && <> · {variants} vidéos</>}
              <br /><span className="opacity-80">InfiniteTalk · ≈ {seconds} s de parole · {resolution} · tarif estimé, plus les caractères ElevenLabs</span>
            </>
          ) : (
            <>InfiniteTalk · {resolution} · le coût dépend de la durée de l&apos;audio (≈ {TALKING_PHOTO.creditsPerSec[resolution]} crédits/s, estimé)</>
          )}
        </span>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={!ready || busy}>
          {busy ? <span className="spinner" /> : "🗣"} {variants > 1 ? `Générer ${variants} variantes` : "Faire parler"}
        </button>
      </div>
    </div>
  );
}
