"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState } from "react";
import { api, useCollection, useLocalState } from "@/lib/client";
import { uploadFile, takeFiles, clipboardFiles, droppedFiles } from "@/lib/upload-client";
import { fmtInt, fmtUsd } from "@/lib/format";
import { CREATION } from "@/lib/studio-ia/config";
import type { CreateRequest, StudioCharacter, StudioJob } from "@/lib/studio-ia/types";
import { toSupportedImage } from "./MediaField";
import { ErrorNote, Field, useToast } from "./ui";
import { ThumbImg } from "@/components/studio-ia/MediaThumb";

/**
 * Onglet « Création » : une vidéo depuis zéro, sans rien filmer.
 *
 * L'image de départ (faite dans l'onglet Image, ou n'importe quelle photo)
 * devient la première image de la vidéo. Seedance 2.5 l'anime et fait dire
 * le script à la personne, voix comprise. C'est le workflow des créatives
 * UGC « full IA » : une image soignée, puis image → vidéo avec dialogue.
 */

interface Media {
  url: string;
  name: string;
}

const isImageName = (n: string) => /\.(jpe?g|png|webp|jfif|jpe|avif|heic|heif|bmp)$/i.test(n);

function Chip({ active, onClick, children, disabled, title }: { active: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button type="button" className="btn btn-sm" onClick={onClick} disabled={disabled} title={title} style={active ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}>
      {children}
    </button>
  );
}

const LANGUAGES: { id: string; label: string }[] = [
  { id: "fr", label: "Français" },
  { id: "en", label: "Anglais" },
  { id: "es", label: "Espagnol" },
  { id: "ar", label: "Arabe" },
  { id: "it", label: "Italien" },
  { id: "de", label: "Allemand" },
  { id: "pt", label: "Portugais" },
];

const DURATIONS: { value: number; label: string }[] = [
  { value: -1, label: "Auto" },
  { value: 5, label: "5 s" },
  { value: 10, label: "10 s" },
  { value: 15, label: "15 s" },
  { value: 20, label: "20 s" },
  { value: 30, label: "30 s" },
];

export function VideoCreate({ jobs, onQueued }: { jobs: StudioJob[]; onQueued: (jobs: StudioJob[]) => void }) {
  const toast = useToast();
  const characters = useCollection<StudioCharacter>("studioCharacters");

  const [start, setStart] = useState<Media | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [products, setProducts] = useState<Media[]>([]);
  const [productBusy, setProductBusy] = useState(false);
  const [productDescription, setProductDescription] = useState("");
  const [script, setScript] = useState("");
  const [language, setLanguage] = useLocalState<string>("create-language", "fr");
  const [scene, setScene] = useState("");
  const [duration, setDuration] = useLocalState<number>("create-duration", -1);
  const [resolution, setResolution] = useLocalState<"480p" | "720p" | "1080p">("create-resolution", "720p");
  const [aspect, setAspect] = useLocalState<"9:16" | "16:9" | "1:1" | "adaptive">("create-aspect", "9:16");
  const [variants, setVariants] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recentImages = useMemo(() => {
    const seen = new Set<string>(characters.rows.map((c) => c.imageUrl));
    const out: Media[] = [];
    for (const j of jobs) {
      if (!j.referenceImage || seen.has(j.referenceImage)) continue;
      seen.add(j.referenceImage);
      out.push({ url: j.referenceImage, name: j.referenceImageName || "image" });
      if (out.length >= 6) break;
    }
    return out;
  }, [jobs, characters.rows]);

  /* Ctrl+V : une capture devient l'image de départ. */
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || busyRef.current) return;
      const f = clipboardFiles(e).find((x) => x.type.startsWith("image/"));
      if (!f) return;
      e.preventDefault();
      void setStartFile(f);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStartFile = async (f: File) => {
    if (!isImageName(f.name) && !f.type.startsWith("image/")) { toast("Choisis une image.", "err"); return; }
    setStartBusy(true);
    try {
      const up = await uploadFile(await toSupportedImage(f));
      setStart({ url: up.url, name: f.name });
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setStartBusy(false);
    }
  };

  const addProductFiles = async (files: File[]) => {
    const imgs = files.filter((f) => isImageName(f.name) || f.type.startsWith("image/")).slice(0, 4 - products.length);
    if (!imgs.length) return;
    setProductBusy(true);
    try {
      const added: Media[] = [];
      for (const f of imgs) {
        const up = await uploadFile(await toSupportedImage(f));
        added.push({ url: up.url, name: f.name });
      }
      setProducts((p) => [...p, ...added].slice(0, 4));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setProductBusy(false);
    }
  };

  /** Estimation : durée choisie, sinon 15 caractères par seconde de parole. */
  const seconds = duration > 0 ? duration : Math.min(CREATION.maxDurationSec, Math.max(CREATION.minDurationSec, Math.ceil(script.trim().length / 15)));
  const credits = Math.round(CREATION.creditsPerSec[resolution] * seconds * variants);
  const scriptSeconds = Math.ceil(script.trim().length / 15);
  const tooLongForDuration = duration > 0 && scriptSeconds > duration + 2;

  const ready = Boolean(start) && !startBusy && !productBusy && Boolean(script.trim());

  const submit = async () => {
    if (!start) return;
    setBusy(true);
    setError(null);
    const body: CreateRequest = {
      startImage: start.url,
      startImageName: start.name,
      productImages: products.map((p) => p.url),
      productDescription,
      script,
      language,
      scenePrompt: scene,
      durationSec: duration,
      resolution,
      aspectRatio: aspect,
      variants,
    };
    try {
      const r = await api<{ jobs: StudioJob[] }>("/api/studio-ia/create", { method: "POST", body: JSON.stringify(body) });
      onQueued(r.jobs);
      toast(r.jobs.length > 1 ? `${r.jobs.length} variantes lancées.` : "Vidéo lancée. Le résultat arrive dans Résultats.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const slotStyle = (filled: boolean) => ({
    border: `1.5px ${filled ? "solid" : "dashed"} var(--border-strong)`,
    background: "var(--surface-2)",
    cursor: busy ? "not-allowed" : "pointer",
  });

  return (
    <div className="flex flex-col gap-4 pt-1">
      <p className="dim text-[12.5px] leading-snug">
        Une image de départ et un script : Seedance 2.5 anime l&apos;image et fait parler la personne, voix comprise. Rien à filmer.
        Fais d&apos;abord l&apos;image dans l&apos;onglet <strong>Image</strong> (personnage, produit, décor, cadrage) : c&apos;est elle qui fait le réalisme.
      </p>

      {/* Image de depart */}
      <Field label="Image de départ" hint="La première image exacte de la vidéo : personne, tenue, produit, décor et cadrage tels que tu les veux. Format vertical pour un reel.">
        <div className="flex gap-3 items-start flex-wrap">
          <label
            className="rounded-[10px] overflow-hidden grid place-items-center shrink-0"
            style={{ width: 132, height: 165, ...slotStyle(Boolean(start)) }}
            title="Clique, dépose une image ici, ou colle une capture (Ctrl+V)"
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (busy) return; const f = droppedFiles(e).find((x) => x.type.startsWith("image/") || isImageName(x.name)); if (f) void setStartFile(f); }}
          >
            {startBusy ? <span className="spinner" /> : start ? <ThumbImg src={start.url} className="w-full h-full object-cover" /> : <span className="dim text-[12px] text-center px-2">+ Image</span>}
            <input type="file" hidden accept="image/*,.jfif,.jpe,.heic,.heif,.avif" disabled={busy} onChange={async (e) => { const f = (await takeFiles(e.currentTarget))[0]; if (f) void setStartFile(f); }} />
          </label>
          {(characters.rows.length > 0 || recentImages.length > 0) && (
            <div className="flex flex-col gap-1.5">
              <span className="label-xs">Images récentes</span>
              <div className="flex gap-1.5 flex-wrap">
                {characters.rows.map((c) => (
                  <button key={c.id} type="button" className="rounded-[8px] overflow-hidden" style={{ width: 52, border: `2px solid ${start?.url === c.imageUrl ? "var(--accent)" : "var(--border)"}` }} title={c.name} onClick={() => setStart({ url: c.imageUrl, name: c.name })}>
                    <ThumbImg src={c.imageUrl} className="w-full object-cover" style={{ height: 62 }} />
                    <span className="block text-[9.5px] px-1 py-0.5 truncate" style={{ background: "var(--surface)" }}>{c.name}</span>
                  </button>
                ))}
                {recentImages.map((m) => (
                  <button key={m.url} type="button" className="rounded-[8px] overflow-hidden" style={{ width: 52, height: 62, border: `2px solid ${start?.url === m.url ? "var(--accent)" : "var(--border)"}` }} title={m.name} onClick={() => setStart(m)}>
                    <ThumbImg src={m.url} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Field>

      {/* Produit */}
      <Field label="Produit (optionnel)" hint="2 à 4 photos du produit seul, sous plusieurs angles : il reste identique quand la main bouge. Avec des photos, l'image de départ passe en référence (fidélité au cadrage un peu moindre).">
        <div className="flex gap-2 items-center flex-wrap">
          {products.map((p, i) => (
            <div key={p.url} className="relative rounded-[8px] overflow-hidden" style={{ width: 56, height: 56, border: "1px solid var(--border)" }}>
              <ThumbImg src={p.url} className="w-full h-full object-cover" />
              <button type="button" className="absolute top-0 right-0 text-[11px] px-1" style={{ background: "var(--surface)", borderRadius: "0 0 0 6px" }} title="Retirer" onClick={() => setProducts((arr) => arr.filter((_, k) => k !== i))} disabled={busy}>✕</button>
            </div>
          ))}
          {products.length < 4 && (
            <label
              className="rounded-[8px] grid place-items-center text-center"
              style={{ width: 56, height: 56, ...slotStyle(false) }}
              title="Photos du produit"
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (!busy) void addProductFiles(droppedFiles(e)); }}
            >
              {productBusy ? <span className="spinner" /> : <span className="dim text-[11px]">+</span>}
              <input type="file" hidden multiple accept="image/*,.jfif,.jpe,.heic,.heif,.avif" disabled={busy} onChange={async (e) => void addProductFiles(await takeFiles(e.currentTarget))} />
            </label>
          )}
          {products.length > 0 && (
            <input className="input !w-auto !min-w-[220px]" placeholder="Ce que c'est : ex. bracelet en acier noir" value={productDescription} onChange={(e) => setProductDescription(e.target.value)} disabled={busy} />
          )}
        </div>
      </Field>

      {/* Script */}
      <Field label="Ce que la personne dit" hint="Mot pour mot. Phrases courtes, ponctuation naturelle. Environ 15 caractères par seconde : 30 secondes ≈ 450 caractères.">
        <div className="flex flex-col gap-2">
          <textarea className="textarea" style={{ minHeight: 110 }} placeholder="Franchement, depuis que je porte ce bracelet à la salle, j'ai une énergie de dingue…" value={script} onChange={(e) => setScript(e.target.value)} disabled={busy} />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="label-xs">Langue</span>
            {LANGUAGES.map((l) => <Chip key={l.id} active={language === l.id} onClick={() => setLanguage(l.id)} disabled={busy}>{l.label}</Chip>)}
            <span className="dim text-[11px] ml-auto">{script.trim().length} caractères · ≈ {scriptSeconds} s de parole</span>
          </div>
        </div>
      </Field>

      <Field label="Attitude (optionnel)" hint="Une phrase : ton, rythme, gestes. Le décor et la personne viennent de l'image.">
        <input className="input" placeholder="Ex. posé et sûr de lui, montre le bracelet à la caméra au milieu, sourit à la fin" value={scene} onChange={(e) => setScene(e.target.value)} disabled={busy} />
      </Field>

      <div className="flex flex-wrap items-end gap-x-4 gap-y-2.5">
        <div className="flex flex-col gap-1">
          <span className="label-xs">Durée</span>
          <div className="flex gap-1.5 flex-wrap">
            {DURATIONS.map((d) => <Chip key={d.value} active={duration === d.value} onClick={() => setDuration(d.value)} disabled={busy} title={d.value === -1 ? "Le modèle choisit selon le script" : undefined}>{d.label}</Chip>)}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="label-xs">Résolution</span>
          <div className="flex gap-1.5">
            {CREATION.resolutions.map((r) => <Chip key={r} active={resolution === r} onClick={() => setResolution(r)} disabled={busy}>{r}</Chip>)}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="label-xs">Format</span>
          <div className="flex gap-1.5">
            {([["9:16", "9:16 vertical"], ["16:9", "16:9"], ["1:1", "1:1"], ["adaptive", "Comme l'image"]] as const).map(([v, l]) => <Chip key={v} active={aspect === v} onClick={() => setAspect(v)} disabled={busy}>{l}</Chip>)}
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

      {tooLongForDuration && (
        <ErrorNote>Le script fait environ {scriptSeconds} s de parole pour une vidéo de {duration} s : allonge la durée ou raccourcis le texte, sinon la fin sera coupée ou débitée trop vite.</ErrorNote>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex items-center justify-between gap-3 pt-3 flex-wrap" style={{ borderTop: "1px solid var(--border)" }}>
        <span className="dim text-[12px] leading-snug">
          <span className="font-medium" style={{ color: "var(--text)" }}>≈ {fmtInt(credits)} crédits</span> · {fmtUsd(credits * 0.005)}
          {variants > 1 && <> · {variants} vidéos</>}
          <br /><span className="opacity-80">{CREATION.label} · ≈ {seconds} s · {resolution} · voix générée par le modèle · tarif estimé, à confirmer sur la première facture</span>
        </span>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={!ready || busy}>
          {busy ? <span className="spinner" /> : "✦"} {variants > 1 ? `Créer ${variants} variantes` : "Créer la vidéo"}
        </button>
      </div>
    </div>
  );
}
