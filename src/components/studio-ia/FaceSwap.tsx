"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { ErrorNote, Field, useToast } from "@/components/studio-ia/ui";
import type { Generation } from "@/lib/types";
import { takeFiles } from "@/lib/upload-client";

/**
 * Modèles d'image OpenAI.
 *
 * Sur KIE, gpt-image-2-image-to-image ignore les images fournies et retombe en
 * texte-vers-image (vérifié : le rendu n'avait aucun rapport avec les sources).
 * L'API OpenAI accepte les fichiers en multipart et fait un vrai montage.
 */
const MODELS = [
  { id: "gpt-image-2", label: "GPT Image 2", freeSize: true },
  { id: "nano-banana-pro", label: "Nano Banana Pro", freeSize: true, kie: true },
  { id: "gpt-image-1.5", label: "GPT Image 1.5", freeSize: false },
  { id: "gpt-image-1", label: "GPT Image 1", freeSize: false },
  { id: "gpt-image-1-mini", label: "GPT Image 1 mini", freeSize: false },
];

/** gpt-image-2 accepte n'importe quelle dimension ; les autres, trois seulement. */
const RATIOS = [
  { id: "864x1536", label: "9:16", note: "Reel, story" },
  { id: "1152x1536", label: "3:4", note: "Post vertical" },
  { id: "1024x1280", label: "4:5", note: "Feed Instagram" },
  { id: "1024x1536", label: "2:3", note: "Portrait" },
  { id: "1024x1024", label: "1:1", note: "Carré" },
  { id: "1536x1024", label: "3:2", note: "Paysage" },
  { id: "1536x1152", label: "4:3", note: "Paysage" },
  { id: "1536x864", label: "16:9", note: "Large" },
];

const BASIC_RATIOS = new Set(["1024x1024", "1024x1536", "1536x1024"]);

/** KIE raisonne en ratio la ou OpenAI attend des pixels. */
const SIZE_TO_RATIO: Record<string, string> = {
  "864x1536": "9:16",
  "1152x1536": "3:4",
  "1024x1280": "4:5",
  "1024x1536": "2:3",
  "1024x1024": "1:1",
  "1536x1024": "3:2",
  "1536x1152": "4:3",
  "1536x864": "16:9",
};

/**
 * Bloc anti-IA, ajouté à chaque demande.
 *
 * Sans lui les modèles lissent la peau et sortent une image manifestement
 * générée. La partie « à éviter » tient lieu de negative prompt : l'API
 * images/edits n'expose pas de champ dédié.
 */
const REALISM =
  " Photo authentique prise sur le vif à l'iPhone 15, objectif principal, aucune retouche. " +
  "Rendu organique et naturel : grain de capteur, bruit léger dans les ombres, compression JPEG discrète, " +
  "micro-flou de bougé, profondeur de champ réelle du téléphone. " +
  "Peau vivante avec pores, grains de beauté, rougeurs, brillance et imperfections. " +
  "Lumière ambiante non corrigée, balance des blancs imparfaite, hautes lumières légèrement brûlées. " +
  "Cadrage spontané, pose non préparée, regard naturel. " +
  "À ÉVITER ABSOLUMENT : rendu 3D, aspect CGI, image de synthèse, peau lissée ou cireuse, " +
  "visage trop symétrique, yeux trop nets ou brillants, éclairage de studio, HDR, sursaturation, " +
  "halo ou contour net autour du visage, bokeh artificiel, netteté uniforme, esthétique d'image générée par IA.";

const SWAP_PRESETS = [
  {
    label: "Swap de tête",
    prompt:
      "Remplace le visage de la personne de la première image par celui de la personne de la deuxième image. " +
      "Conserve la scène, le cadrage, la pose, la coiffure et les vêtements de la première image.",
  },
  {
    label: "M'incruster",
    prompt:
      "Intègre la personne de la deuxième image dans le décor de la première image, en pied, au premier plan. " +
      "Respecte la perspective, l'échelle et les ombres portées. Ne modifie pas le décor.",
  },
  {
    label: "Avec accessoire",
    prompt:
      "Intègre la personne de la deuxième image dans le décor de la première image, téléphone à la main. " +
      "Respecte la perspective, l'échelle et les ombres portées.",
  },
];

const SCENE_PRESETS = [
  "Un homme marche dans une rue de Dubaï en fin d'après-midi, lumière dorée rasante.",
  "Un homme assis dans une voiture de sport, vue depuis le siège passager.",
  "Un homme devant un ordinateur portable dans un café lumineux.",
];

interface Slot {
  file: File;
  preview: string;
  name: string;
}

/**
 * Selecteur d'images.
 *
 * `multiple` sert pour le visage : plusieurs angles d'un meme visage
 * ameliorent nettement la ressemblance, c'est le principal levier de qualite
 * du swap — bien plus que le choix du modele.
 */
function Uploader({
  label,
  slot,
  onSlot,
  disabled,
  multiple,
  slots,
  onSlots,
}: {
  label: string;
  slot?: Slot | null;
  onSlot?: (s: Slot | null) => void;
  disabled: boolean;
  multiple?: boolean;
  slots?: Slot[];
  onSlots?: (s: Slot[]) => void;
}) {
  if (multiple) {
    const list = slots ?? [];
    return (
      <Field label={label}>
        <div className="flex gap-2 items-center flex-wrap">
          {list.map((f, i) => (
            <img
              key={i}
              src={f.preview}
              alt=""
              title="Cliquer pour retirer"
              className="rounded-[8px] object-cover"
              style={{
                width: 60,
                height: 75,
                background: "var(--surface-3)",
                border: "1px solid var(--border)",
                cursor: disabled ? "not-allowed" : "pointer",
              }}
              onClick={() => {
                if (disabled) return;
                URL.revokeObjectURL(f.preview);
                onSlots?.(list.filter((_, j) => j !== i));
              }}
            />
          ))}
          {list.length < 4 && (
            <label
              className="rounded-[8px] grid place-items-center text-[20px] dim"
              style={{
                width: 60,
                height: 75,
                border: "1px dashed var(--border-strong)",
                cursor: disabled ? "not-allowed" : "pointer",
              }}
              title="Ajouter une photo"
            >
              +
              <input
                type="file"
                hidden
                multiple
                accept="image/png,image/jpeg,image/webp,.jfif,.jpe"
                disabled={disabled}
                onChange={async (e) => {
                  const files = await takeFiles(e.currentTarget);
                  if (!files.length) return;
                  const added = files.slice(0, 4 - list.length).map((f) => ({
                    file: f,
                    preview: URL.createObjectURL(f),
                    name: f.name,
                  }));
                  onSlots?.([...list, ...added]);
                }}
              />
            </label>
          )}
        </div>
      </Field>
    );
  }

  return (
    <Field label={label}>
      {/* La vignette EST le selecteur : un clic dessus ouvre le choix de fichier. */}
      <label style={{ cursor: disabled ? "not-allowed" : "pointer", display: "block" }}>
        <input
          className={slot ? "hidden" : "input"}
          type="file"
          accept="image/png,image/jpeg,image/webp,.jfif,.jpe"
          disabled={disabled}
          onChange={async (e) => {
            const f = (await takeFiles(e.currentTarget))[0];
            if (!f) return;
            // Le fichier part tel quel vers OpenAI : aucun stockage intermediaire.
            if (slot) URL.revokeObjectURL(slot.preview);
            onSlot?.({ file: f, preview: URL.createObjectURL(f), name: f.name });
          }}
        />
        {slot && (
          <img
            src={slot.preview}
            alt=""
            title="Cliquer pour changer"
            className="rounded-[8px] object-cover"
            style={{
              width: 72,
              height: 90,
              background: "var(--surface-3)",
              border: "1px solid var(--border)",
              opacity: disabled ? 0.5 : 1,
            }}
          />
        )}
      </label>
    </Field>
  );
}

export function FaceSwap({ onQueued }: { onQueued: (g: Generation) => void }) {
  const [mode, setMode] = useState<"photo" | "scene">("photo");
  const [modelId, setModelId] = useState(MODELS[0].id);
  const [size, setSize] = useState(RATIOS[0].id);
  const [base, setBase] = useState<Slot | null>(null);
  const [faces, setFaces] = useState<Slot[]>([]);
  const [prompt, setPrompt] = useState(SWAP_PRESETS[0].prompt);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const toast = useToast();

  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0];
  const ratios = model.freeSize ? RATIOS : RATIOS.filter((r) => BASIC_RATIOS.has(r.id));
  const ready = faces.length > 0 && prompt.trim() !== "" && (mode === "scene" || Boolean(base));

  // Un format libre choisi sur gpt-image-2 n'existe pas sur les autres modèles.
  useEffect(() => {
    if (!ratios.some((r) => r.id === size)) setSize(ratios[0].id);
  }, [ratios, size]);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const run = async () => {
    if (!faces.length) return;
    setBusy(true);
    setError(null);
    setElapsed(0);
    timer.current = setInterval(() => setElapsed((s) => s + 1), 1000);

    try {
      const full = `${prompt.trim()}${REALISM}`;
      // L'ordre compte : la scène d'abord, le visage ensuite.
      const files = [...(mode === "photo" && base ? [base.file] : []), ...faces.map((f) => f.file)];

      if (model.kie) {
        /*
         * Chemin KIE : ces modeles vont chercher les images sur internet, ils
         * ne lisent pas un fichier local. On televerse d'abord, puis on envoie
         * les URL. La generation est asynchrone, le suivi la reprend.
         */
        const urls: string[] = [];
        for (const f of files) {
          const form = new FormData();
          form.append("file", f, f.name);
          const up = await fetch("/api/kie/upload", { method: "POST", body: form });
          const body = (await up.json()) as { url?: string; error?: string };
          if (!up.ok || body.error || !body.url) throw new Error(body.error ?? `Envoi impossible (${up.status})`);
          urls.push(body.url);
        }

        const res = await fetch("/api/kie/generate", {
          method: "POST",
          body: JSON.stringify({
            model: modelId,
            input: {
              prompt: full,
              image_input: urls,
              aspect_ratio: SIZE_TO_RATIO[size] ?? "auto",
              resolution: "1K",
            },
          }),
        });
        const gen = (await res.json()) as Generation & { error?: string };
        if (!res.ok || gen.error) throw new Error(gen.error ?? `Erreur ${res.status}`);
        onQueued(gen);
        toast("Génération lancée.");
        return;
      }

      const form = new FormData();
      form.append("model", modelId);
      form.append("size", size);
      form.append("prompt", full);
      for (const f of files) form.append("image", f, f.name);

      const res = await fetch("/api/ai/image-edit", { method: "POST", body: form });
      const body = (await res.json()) as { generation?: Generation; error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `Erreur ${res.status}`);
      if (body.generation) onQueued(body.generation);
      toast("Image générée.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (timer.current) clearInterval(timer.current);
      setBusy(false);
    }
  };

  const presets =
    mode === "photo"
      ? SWAP_PRESETS.map((p) => [p.label, p.prompt] as const)
      : SCENE_PRESETS.map((p, i) => [`Exemple ${i + 1}`, p] as const);

  return (
    <div className="flex flex-col gap-3.5 pt-1">
      <div className="flex gap-1.5 flex-wrap">
        {([
          ["photo", "Sur une photo"],
          ["scene", "Scène décrite"],
        ] as const).map(([v, label]) => (
          <button
            key={v}
            className="btn btn-sm"
            disabled={busy}
            onClick={() => {
              setMode(v);
              setPrompt(v === "photo" ? SWAP_PRESETS[0].prompt : SCENE_PRESETS[0]);
            }}
            style={mode === v ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      <Field label="Modèle">
        <select className="select" value={modelId} disabled={busy} onChange={(e) => setModelId(e.target.value)}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </Field>

      <Field label="Format">
        <div className="flex gap-1.5 flex-wrap">
          {ratios.map((r) => (
            <button
              key={r.id}
              className="btn btn-sm"
              disabled={busy}
              onClick={() => setSize(r.id)}
              title={`${r.note} · ${r.id}`}
              style={size === r.id ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
            >
              {r.label}
            </button>
          ))}
        </div>
      </Field>

      {mode === "photo" && (
        <Uploader label="1 · Scène" slot={base} onSlot={setBase} disabled={busy} />
      )}
      <Uploader
        label={mode === "photo" ? "2 · Ton visage" : "Ton visage"}
        multiple
        slots={faces}
        onSlots={setFaces}
        disabled={busy}
      />

      <div className="flex gap-1.5 flex-wrap">
        {presets.map(([label, value]) => (
          <button
            key={label}
            className="btn btn-sm"
            disabled={busy}
            onClick={() => setPrompt(value)}
            style={prompt === value ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      <Field label="Consigne">
        <textarea
          className="input"
          rows={4}
          value={prompt}
          disabled={busy}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Field>

      {error && <ErrorNote>{error}</ErrorNote>}

      {busy ? (
        <div
          className="rounded-[9px] px-3.5 py-3 flex items-center gap-3"
          style={{ background: "var(--surface-3)" }}
        >
          <span className="spinner" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold">Génération en cours…</span>
            <span className="dim text-[11.5px] num">
              {elapsed} s — {model.label} · {size.replace("x", " × ")}
            </span>
          </span>
        </div>
      ) : (
        <button className="btn btn-primary" onClick={() => void run()} disabled={!ready}>
          Générer
        </button>
      )}
    </div>
  );
}
