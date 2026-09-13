"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Check,
  Film,
  ImageIcon,
  Loader2,
  PenLine,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/shared/page-states";
import type {
  ScriptTemplate,
  StaticSpec,
  StyleKind,
  StyleTemplate,
  VideoSpec,
} from "@/lib/creative-library/types";
import { measureAspect, toDataUrl } from "@/lib/ugc/creative-file";
import { cn } from "@/lib/utils";

/**
 * Bibliothèque de styles et de scripts.
 *
 * Dépose une statique ou une vidéo qui marche : elle est relevée une fois
 * (mise en page, éléments, plans, cadrages, script), rangée avec son affiche,
 * et se rejoue ensuite sur n'importe quel produit depuis UGC Creative ou le
 * Remake. Les scripts gagnants se collent tels quels et se réadaptent produit
 * par produit.
 */

const panel =
  "rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]";

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Bibliothèque indisponible");
  return data;
}

type Draft =
  | { kind: "static"; poster: string; aspect: string; spec: StaticSpec | null; analysing: boolean; error: string | null; name: string; pitch: string; tags: string }
  | { kind: "video"; poster: string | null; spec: VideoSpec | null; analysing: boolean; error: string | null; name: string; pitch: string; tags: string; fileName: string };

export function CreativeLibrary() {
  const [styles, setStyles] = useState<StyleTemplate[]>([]);
  const [scripts, setScripts] = useState<ScriptTemplate[]>([]);
  const [filter, setFilter] = useState<"all" | StyleKind>("all");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [open, setOpen] = useState<StyleTemplate | null>(null);
  const [scriptDraft, setScriptDraft] = useState({ name: "", text: "", source: "", tags: "" });
  const [savingScript, setSavingScript] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/library", { cache: "no-store" });
      const body = await res.json();
      setStyles(body.styles ?? []);
      setScripts(body.scripts ?? []);
    } catch {
      // vide au premier passage
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  /** Dépôt : une image devient un style statique, une vidéo un style vidéo. */
  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    for (const file of Array.from(list)) {
      if (file.type.startsWith("image/")) void analyseStatic(file);
      else if (file.type.startsWith("video/")) void analyseVideo(file);
      else toast.error(`${file.name} : ni image ni vidéo`);
    }
  }

  function patchDraft(index: number, patch: Partial<Draft>) {
    setDrafts((current) => current.map((draft, i) => (i === index ? ({ ...draft, ...patch } as Draft) : draft)));
  }

  async function analyseStatic(file: File) {
    const poster = await toDataUrl(file);
    const aspect = await measureAspect(file).catch(() => "1:1");
    const index = drafts.length;
    setDrafts((current) => [
      ...current,
      { kind: "static", poster, aspect, spec: null, analysing: true, error: null, name: file.name.replace(/\.[a-z0-9]+$/i, ""), pitch: "", tags: "" },
    ]);
    try {
      const body = await post<{ static: StaticSpec }>({ action: "analyze-static", imageDataUrl: poster, aspect });
      setDrafts((current) =>
        current.map((draft, i) => (i === index && draft.kind === "static" ? { ...draft, spec: body.static, analysing: false } : draft))
      );
    } catch (error) {
      setDrafts((current) =>
        current.map((draft, i) =>
          i === index ? { ...draft, analysing: false, error: error instanceof Error ? error.message : "Relevé impossible" } : draft
        )
      );
    }
  }

  async function analyseVideo(file: File) {
    if (file.size > 60 * 1024 * 1024) return toast.error(`${file.name} dépasse 60 Mo`);
    const dataUrl = await toDataUrl(file);
    const index = drafts.length;
    setDrafts((current) => [
      ...current,
      { kind: "video", poster: null, spec: null, analysing: true, error: null, name: file.name.replace(/\.[a-z0-9]+$/i, ""), pitch: "", tags: "", fileName: file.name },
    ]);
    try {
      const body = await post<{ video: VideoSpec; poster: string | null }>({ action: "analyze-video", videoDataUrl: dataUrl });
      setDrafts((current) =>
        current.map((draft, i) => (i === index && draft.kind === "video" ? { ...draft, spec: body.video, poster: body.poster, analysing: false } : draft))
      );
    } catch (error) {
      setDrafts((current) =>
        current.map((draft, i) =>
          i === index ? { ...draft, analysing: false, error: error instanceof Error ? error.message : "Relevé impossible" } : draft
        )
      );
    }
  }

  async function saveDraft(index: number) {
    const draft = drafts[index];
    if (!draft?.spec) return;
    try {
      await post({
        action: "save-style",
        kind: draft.kind,
        name: draft.name,
        pitch: draft.pitch,
        tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        static: draft.kind === "static" ? draft.spec : undefined,
        video: draft.kind === "video" ? draft.spec : undefined,
        posterDataUrl: draft.poster,
      });
      setDrafts((current) => current.filter((_, i) => i !== index));
      toast.success("Style enregistré");
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    }
  }

  async function removeStyle(id: string) {
    try {
      await post({ action: "delete-style", id });
      setOpen(null);
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    }
  }

  async function saveScript() {
    if (!scriptDraft.text.trim()) return toast.error("Colle le script");
    setSavingScript(true);
    try {
      await post({
        action: "save-script",
        name: scriptDraft.name,
        text: scriptDraft.text,
        source: scriptDraft.source,
        tags: scriptDraft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      setScriptDraft({ name: "", text: "", source: "", tags: "" });
      toast.success("Script enregistré");
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
    } finally {
      setSavingScript(false);
    }
  }

  async function removeScript(id: string) {
    try {
      await post({ action: "delete-script", id });
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Suppression impossible");
    }
  }

  const visible = styles.filter((style) => filter === "all" || style.kind === filter);

  return (
    <div>
      <PageHeader
        title="Bibliothèque"
        description="Les créas qui marchent, relevées une fois et rejouables sur tous tes produits. Dépose une statique ou une vidéo, colle un script : tout devient un style ou un script à réadapter."
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {/* Dépôt */}
          <label
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void addFiles(event.dataTransfer.files);
            }}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 bg-white/60 px-6 py-8 text-center transition-colors hover:border-slate-400 hover:bg-white dark:border-slate-700 dark:bg-slate-900/40"
          >
            <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={(event) => void addFiles(event.target.files)} />
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900">
              <Upload className="h-4 w-4" />
            </div>
            <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Dépose tes créas de référence</div>
            <p className="max-w-md text-[11px] leading-snug text-slate-500">
              Images PNG/JPG (statiques) ou vidéos MP4/MOV (UGC, video ads, 60 Mo max). Chaque fichier est relevé : mise en page et
              éléments pour une image, grille de plans, cadrages et script pour une vidéo.
            </p>
          </label>

          {/* Brouillons en cours de relevé */}
          {drafts.map((draft, index) => (
            <section key={index} className={cn(panel, "grid gap-4 sm:grid-cols-[140px_minmax(0,1fr)]")}>
              <div className="overflow-hidden rounded-xl bg-slate-100 dark:bg-slate-800" style={{ aspectRatio: "3 / 4" }}>
                {draft.poster ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={draft.poster} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-400">
                    <Film className="h-5 w-5" />
                  </div>
                )}
              </div>
              <div className="min-w-0 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="eyebrow">{draft.kind === "static" ? "Statique" : "Vidéo"}</span>
                  {draft.analysing ? (
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                      <Loader2 className="h-3 w-3 animate-spin" /> Relevé en cours…
                    </span>
                  ) : draft.error ? (
                    <span className="text-[11px] text-rose-600">{draft.error}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] text-slate-700 dark:text-slate-300">
                      <Check className="h-3 w-3" /> Relevé
                    </span>
                  )}
                  <button type="button" onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))} className="ml-auto text-slate-400 hover:text-slate-700" title="Abandonner">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Nom du style" value={draft.name} onChange={(v) => patchDraft(index, { name: v })} />
                  <Field label="Tags (virgules)" value={draft.tags} onChange={(v) => patchDraft(index, { tags: v })} placeholder="agressif, bénéfices, presse" />
                </div>
                <Field label="En une ligne" value={draft.pitch} onChange={(v) => patchDraft(index, { pitch: v })} placeholder="Ce qui fait marcher cette créa" />
                {draft.spec ? (
                  <div className="rounded-xl bg-slate-50 p-2.5 text-[11px] leading-snug text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                    {draft.kind === "static" && draft.spec ? (
                      <>
                        <div className="mb-1">{(draft.spec as StaticSpec).layout}</div>
                        <div className="flex flex-wrap gap-1">
                          {(draft.spec as StaticSpec).elements.map((element, i) => (
                            <span key={i} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                              {element.kind}
                              {element.sourceText ? ` · « ${element.sourceText.slice(0, 32)}${element.sourceText.length > 32 ? "…" : ""} »` : ""}
                            </span>
                          ))}
                        </div>
                      </>
                    ) : draft.kind === "video" && draft.spec ? (
                      <>
                        <div className="mb-1">
                          {(draft.spec as VideoSpec).shots.length} plans · {Math.round((draft.spec as VideoSpec).duration)}s · {(draft.spec as VideoSpec).styleBlock || "style non relevé"}
                        </div>
                        {(draft.spec as VideoSpec).transcript ? (
                          <div className="italic">« {(draft.spec as VideoSpec).transcript.slice(0, 220)}{(draft.spec as VideoSpec).transcript.length > 220 ? "…" : ""} »</div>
                        ) : (
                          <div className="text-slate-400">Pas de voix relevée.</div>
                        )}
                      </>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => void saveDraft(index)} disabled={!draft.spec || draft.analysing}>
                    <Save className="h-3.5 w-3.5" />
                    Enregistrer le style
                  </Button>
                  {draft.kind === "video" && draft.spec && (draft.spec as VideoSpec).transcript ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setScriptDraft({
                          name: draft.name,
                          text: (draft.spec as VideoSpec).transcript,
                          source: draft.kind === "video" ? draft.fileName : "",
                          tags: draft.tags,
                        })
                      }
                    >
                      <PenLine className="h-3.5 w-3.5" />
                      Garder le script aussi
                    </Button>
                  ) : null}
                </div>
              </div>
            </section>
          ))}

          {/* Grille des styles */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-0.5 rounded-full bg-slate-100 p-0.5 dark:bg-slate-800">
              {(
                [
                  ["all", "Tous"],
                  ["static", "Statiques"],
                  ["video", "Vidéos"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
                    filter === id ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100" : "text-slate-500"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-[11px] text-slate-500">
              {visible.length} style{visible.length > 1 ? "s" : ""} · clique une affiche pour voir le dispositif
            </span>
          </div>

          {visible.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {visible.map((style) => (
                <StyleCard key={style.id} style={style} onOpen={() => setOpen(style)} />
              ))}
            </div>
          ) : (
            <EmptyState title="Aucun style" description="Dépose une créa ci-dessus pour créer ton premier style." />
          )}
        </div>

        {/* Scripts */}
        <aside className="space-y-4">
          <section className={panel}>
            <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
              <PenLine className="h-3.5 w-3.5" />
              Meilleurs scripts vidéo
            </div>
            <p className="mb-3 text-[11px] leading-snug text-slate-500">
              Colle le texte d&apos;une ad qui marche. Il se réadapte à chaque produit depuis UGC Creative, structure intacte.
            </p>
            <div className="space-y-2">
              <Field label="Nom" value={scriptDraft.name} onChange={(v) => setScriptDraft((c) => ({ ...c, name: v }))} placeholder="Hook « guess how much »" />
              <textarea
                value={scriptDraft.text}
                onChange={(event) => setScriptDraft((c) => ({ ...c, text: event.target.value }))}
                rows={6}
                placeholder="Le script, tel qu'il est dit dans la vidéo…"
                className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-[12px] dark:border-slate-700 dark:bg-slate-950"
              />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Source" value={scriptDraft.source} onChange={(v) => setScriptDraft((c) => ({ ...c, source: v }))} placeholder="Hemios, TikTok…" />
                <Field label="Tags" value={scriptDraft.tags} onChange={(v) => setScriptDraft((c) => ({ ...c, tags: v }))} placeholder="prix, preuve" />
              </div>
              <Button size="sm" className="w-full" onClick={() => void saveScript()} disabled={savingScript}>
                {savingScript ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Enregistrer le script
              </Button>
            </div>
          </section>

          {scripts.length ? (
            <section className={cn(panel, "space-y-2")}>
              {scripts.map((script) => (
                <div key={script.id} className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold text-slate-900 dark:text-slate-100">{script.name}</div>
                      <div className="text-[10px] text-slate-500">
                        {script.source ? `${script.source} · ` : ""}
                        {script.text.split(/\s+/).length} mots
                        {script.tags.length ? ` · ${script.tags.join(", ")}` : ""}
                      </div>
                    </div>
                    <button type="button" onClick={() => void removeScript(script.id)} className="text-slate-400 hover:text-rose-600" title="Supprimer">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <p className="mt-1.5 line-clamp-3 text-[11px] leading-snug text-slate-600 dark:text-slate-300">{script.text}</p>
                </div>
              ))}
            </section>
          ) : null}

          <section className={cn(panel, "text-[11px] leading-snug text-slate-500")}>
            <div className="mb-1 text-[12px] font-semibold text-slate-900 dark:text-slate-100">Comment s&apos;en servir</div>
            <ol className="list-decimal space-y-1 pl-4">
              <li>Dépose ici les créas et scripts qui marchent.</li>
              <li>
                Dans <Link href="/ugc" className="font-medium text-slate-900 underline dark:text-slate-100">UGC Creative</Link>, charge ton produit, puis clique un style vidéo ou un script : il est réadapté et coché.
              </li>
              <li>Pour une statique, ouvre le Remake Creative et choisis le style dans la bande « Styles enregistrés ».</li>
            </ol>
          </section>
        </aside>
      </div>

      {open ? <StyleDialog style={open} onClose={() => setOpen(null)} onDelete={() => void removeStyle(open.id)} /> : null}
    </div>
  );
}

/** Affiche du style : l'image de référence, ou un aperçu dessiné pour les intégrés. */
export function StylePoster({ style, className }: { style: StyleTemplate; className?: string }) {
  if (style.poster) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={`/api/library/poster?id=${encodeURIComponent(style.id)}`} alt="" className={cn("h-full w-full object-cover", className)} />
    );
  }
  return <DrawnPoster style={style} className={className} />;
}

/**
 * Affiche dessinée : reproduit la composition de la créa d'origine — place du
 * titre, produit (un anneau), flèches, badges, ruban, barre de presse — pour
 * lire la DA d'un coup d'œil. Dépose la vraie image dans
 * `data/style-posters/<id>.jpg` et elle remplace ce dessin.
 */

const POSTER_W = 200;
const PRESS = ["Men's Health", "Forbes", "Guardian", "Cosmo", "WellBeing"];

function Ring({ cx, cy, r, sw = 9 }: { cx: number; cy: number; r: number; sw?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#0b0b0b" strokeWidth={sw} opacity={0.95} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#3a3a3a" strokeWidth={sw - 5} strokeDasharray="7 3" />
    </g>
  );
}

function Arrow({ d, fg }: { d: string; fg: string }) {
  return <path d={d} fill="none" stroke={fg} strokeWidth={1.4} strokeLinecap="round" markerEnd="url(#ah)" />;
}

function Press({ y, fg }: { y: number; fg: string }) {
  return (
    <g>
      <line x1={14} x2={POSTER_W - 14} y1={y - 12} y2={y - 12} stroke={fg} strokeOpacity={0.5} strokeWidth={0.6} />
      {PRESS.map((name, i) => (
        <text
          key={name}
          x={14 + (i * (POSTER_W - 28)) / (PRESS.length - 1)}
          y={y}
          fontSize={5.5}
          fontWeight={700}
          fill={fg}
          textAnchor={i === 0 ? "start" : i === PRESS.length - 1 ? "end" : "middle"}
          fontFamily="Georgia, serif"
        >
          {name}
        </text>
      ))}
    </g>
  );
}

function Callout({ x, y, anchor, text, fg }: { x: number; y: number; anchor: "start" | "end"; text: string; fg: string }) {
  const rows = text.split(" ").reduce<string[][]>((acc, w) => {
    const last = acc[acc.length - 1];
    if (last && last.join(" ").length + w.length < 11) last.push(w);
    else acc.push([w]);
    return acc;
  }, []);
  return (
    <text x={x} y={y} fontSize={7} fontWeight={800} fill={fg} textAnchor={anchor} fontFamily="Arial Narrow, Arial, sans-serif" letterSpacing={0.2}>
      {rows.map((row, i) => (
        <tspan key={i} x={x} dy={i === 0 ? 0 : 8}>
          {row.join(" ")}
        </tspan>
      ))}
    </text>
  );
}

function DrawnPoster({ style, className }: { style: StyleTemplate; className?: string }) {
  const p = style.preview ?? { bg: "#233137", fg: "#ffffff", headline: style.name };
  const fg = p.fg;
  const accent = p.accent ?? fg;
  const layout = p.layout ?? "callouts";
  const W = 200;
  const H = 250;
  const lines = p.headline.split(" ");
  const half = Math.ceil(lines.length / 2);
  const l1 = lines.slice(0, half).join(" ");
  const l2 = lines.slice(half).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cn("h-full w-full", className)} preserveAspectRatio="xMidYMid slice" role="img" aria-label={style.name}>
      <defs>
        <radialGradient id={`g-${style.id}`} cx="50%" cy="45%" r="70%">
          <stop offset="0%" stopColor={p.bg} stopOpacity={1} />
          <stop offset="100%" stopColor="#000" stopOpacity={0.55} />
        </radialGradient>
        <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke={fg} strokeWidth={1.6} />
        </marker>
      </defs>
      <rect width={W} height={H} fill={p.bg} />
      {layout !== "list" && layout !== "wall" && layout !== "tape" ? <rect width={W} height={H} fill={`url(#g-${style.id})`} /> : null}

      {layout === "callouts" ? (
        <g>
          <text x={W / 2} y={34} textAnchor="middle" fontSize={15} fontWeight={900} fill={fg} fontFamily="Arial Narrow, Arial, sans-serif">{l1}</text>
          <line x1={W / 2 - 60} x2={W / 2 - 28} y1={37} y2={37} stroke={fg} strokeWidth={1.6} />
          <text x={W / 2} y={52} textAnchor="middle" fontSize={13} fontWeight={300} fill={fg} fontFamily="Arial, sans-serif">{l2 || p.sub}</text>
          <text x={W / 2} y={66} textAnchor="middle" fontSize={6} fill={fg} opacity={0.85}>Or get your money back.</text>
          <Ring cx={W / 2} cy={140} r={38} />
          <Callout fg={fg} x={20} y={108} anchor="start" text="BURNS OFF BEER BELLY" />
          <Callout fg={fg} x={20} y={182} anchor="start" text="BOOSTS DESIRE" />
          <Callout fg={fg} x={W - 20} y={112} anchor="end" text="MELTS MAN BOOBS" />
          <Callout fg={fg} x={W - 20} y={186} anchor="end" text="REDUCES JOINT PAIN" />
          <Arrow fg={fg} d="M 40 118 Q 48 138 56 142" />
          <Arrow fg={fg} d="M 40 172 Q 46 160 56 154" />
          <Arrow fg={fg} d="M 160 118 Q 152 132 144 140" />
          <Arrow fg={fg} d="M 160 176 Q 152 164 144 156" />
          <Press fg={fg} y={232} />
        </g>
      ) : null}

      {layout === "list" ? (
        <g>
          <text x={14} y={30} fontSize={11} fontWeight={500} fill={fg} fontFamily="Arial, sans-serif">Struggling with</text>
          <text x={14} y={46} fontSize={14} fontWeight={900} fill={fg} fontFamily="Arial, sans-serif">{p.sub ?? "MAN BOOBS?"}</text>
          <rect x={14} y={58} width={44} height={11} fill={fg} />
          <text x={17} y={66} fontSize={6.5} fontWeight={800} fill={p.bg}>NO MORE:</text>
          {["Dad bod", "Man boobs", "Love handles"].map((row, i) => (
            <g key={row}>
              <circle cx={20} cy={86 + i * 24} r={5} fill="none" stroke={fg} strokeWidth={1.2} />
              <text x={30} y={89 + i * 24} fontSize={7.5} fontWeight={700} fill={fg} fontFamily="Arial, sans-serif">{row}</text>
              <Arrow fg={fg} d={`M 76 ${84 + i * 24} Q 90 ${86 + i * 24} 100 ${96 + i * 14}`} />
            </g>
          ))}
          <Ring cx={148} cy={128} r={40} />
          <rect x={14} y={200} width={78} height={14} rx={7} fill={fg} />
          <text x={53} y={209.5} textAnchor="middle" fontSize={5.5} fontWeight={800} fill={p.bg}>TRY RISK FREE</text>
        </g>
      ) : null}

      {layout === "statement" ? (
        <g>
          <text x={W / 2} y={38} textAnchor="middle" fontSize={17} fontWeight={900} fill={fg} fontFamily="Arial, sans-serif">{p.headline}</text>
          <text x={W / 2} y={52} textAnchor="middle" fontSize={6} fontStyle="italic" fill={fg} opacity={0.85}>{p.sub}</text>
          <Ring cx={W / 2} cy={135} r={44} sw={10} />
          <Callout fg={fg} x={14} y={90} anchor="start" text="Works in 43 seconds" />
          <Callout fg={fg} x={W - 14} y={90} anchor="end" text="8x stronger" />
          <Callout fg={fg} x={14} y={190} anchor="start" text="Zero side effects" />
          <Callout fg={fg} x={W - 14} y={190} anchor="end" text="Wake up ready" />
          <Press fg={fg} y={236} />
        </g>
      ) : null}

      {layout === "tape" ? (
        <g>
          <rect x={10} y={10} width={58} height={11} fill="#1a5c3a" />
          <text x={39} y={18} textAnchor="middle" fontSize={5.5} fontWeight={700} fill="#fff">Amazon&apos;s Choice</text>
          <text x={W / 2} y={44} textAnchor="middle" fontSize={13} fontWeight={900} fill={fg} fontFamily="Arial Narrow, Arial, sans-serif">{l1}</text>
          <line x1={W / 2 - 58} x2={W / 2 - 34} y1={47} y2={47} stroke={fg} strokeWidth={1.4} />
          <text x={W / 2} y={57} textAnchor="middle" fontSize={7} fontWeight={700} fill={fg}>{p.sub}</text>
          <Ring cx={70} cy={135} r={36} />
          <Ring cx={135} cy={135} r={36} />
          <g transform={`rotate(-8 ${W / 2} 150)`}>
            <rect x={-30} y={140} width={W + 60} height={20} fill={accent} />
            <text x={W / 2} y={154} textAnchor="middle" fontSize={7} fontWeight={800} fill="#fff" letterSpacing={0.5}>BUY 1 GET 1 FREE · BUY 1 GET 1 FREE · BUY 1 GET 1</text>
          </g>
          <text x={W / 2} y={222} textAnchor="middle" fontSize={8} fontWeight={700} fill={fg}>amazon <tspan fontStyle="italic" fontWeight={400}>Best Seller</tspan></text>
        </g>
      ) : null}

      {layout === "letter" ? (
        <g>
          <text x={W / 2} y={40} textAnchor="middle" fontSize={13} fontWeight={900} fill={fg} fontFamily="Arial, sans-serif">
            <tspan x={W / 2}>{l1}</tspan>
            <tspan x={W / 2} dy={15}>{l2}</tspan>
          </text>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <line key={i} x1={30 + (i % 2) * 6} x2={W - 30 - (i % 3) * 5} y1={80 + i * 9} y2={80 + i * 9} stroke={fg} strokeOpacity={0.7} strokeWidth={2.2} strokeLinecap="round" />
          ))}
          <text x={W / 2} y={146} textAnchor="middle" fontSize={6} fill={fg} opacity={0.9}>{p.sub}</text>
          {[0, 1, 2, 3].map((i) => (
            <Ring key={i} cx={28 + i * 48} cy={215} r={26} sw={7} />
          ))}
        </g>
      ) : null}

      {layout === "cartoon" ? (
        <g>
          <Ring cx={W / 2} cy={92} r={60} sw={12} />
          <text x={14} y={178} fontSize={11} fontWeight={900} fill={fg} fontFamily="Arial, sans-serif">
            <tspan x={14}>{l1}</tspan>
            <tspan x={14} dy={13}>{l2}</tspan>
          </text>
          <line x1={14} x2={70} y1={196} y2={196} stroke={fg} strokeWidth={1.4} />
          <text x={14} y={210} fontSize={5.5} fill={fg} opacity={0.9}>{p.sub}</text>
          <g transform={`translate(${W - 52} 190)`}>
            <circle cx={22} cy={22} r={20} fill="#f6d1b8" stroke="#2b1a12" strokeWidth={1.5} />
            <path d="M 4 14 Q 22 -6 40 14" fill="#3a2418" />
            <circle cx={15} cy={22} r={4} fill="#fff" stroke="#2b1a12" />
            <circle cx={29} cy={22} r={4} fill="#fff" stroke="#2b1a12" />
            <circle cx={15} cy={22} r={1.8} fill="#2b1a12" />
            <circle cx={29} cy={22} r={1.8} fill="#2b1a12" />
            <ellipse cx={22} cy={33} rx={4} ry={5} fill="#2b1a12" />
            <circle cx={2} cy={30} r={5} fill="#f6d1b8" stroke="#2b1a12" />
            <circle cx={42} cy={30} r={5} fill="#f6d1b8" stroke="#2b1a12" />
          </g>
        </g>
      ) : null}

      {layout === "bed" ? (
        <g>
          <rect x={0} y={120} width={W} height={130} fill="#e9dcc8" />
          <rect x={0} y={105} width={W} height={26} fill="#6b4a2f" />
          <rect x={0} y={150} width={W} height={100} fill="#f2e7d6" />
          <ellipse cx={30} cy={90} rx={14} ry={10} fill="#ffe2a8" opacity={0.9} />
          <text x={W / 2} y={36} textAnchor="middle" fontSize={12} fontWeight={900} fill={fg} fontFamily="Arial, sans-serif">
            <tspan x={W / 2}>{l1}</tspan>
            <tspan x={W / 2} dy={14}>{l2} 🍆</tspan>
          </text>
          <text x={W / 2} y={66} textAnchor="middle" fontSize={6} fill={fg} opacity={0.9}>{p.sub}</text>
          <Ring cx={80} cy={190} r={26} sw={7} />
          <Ring cx={125} cy={200} r={26} sw={7} />
          <Press fg={fg} y={240} />
        </g>
      ) : null}

      {layout === "columns" ? (
        <g>
          <text x={W / 2} y={36} textAnchor="middle" fontSize={13} fontStyle="italic" fill={fg} fontFamily="Georgia, serif">
            <tspan x={W / 2}>{l1}</tspan>
            <tspan x={W / 2} dy={15}>{l2}</tspan>
          </text>
          <text x={W / 2} y={64} textAnchor="middle" fontSize={5.5} fill={fg} opacity={0.85}>Or get your money back.</text>
          <Ring cx={W / 2} cy={140} r={36} />
          {[
            [14, 100, "start", "No Pills"],
            [14, 150, "start", "100% natural"],
            [W - 14, 96, "end", "Melts fat"],
            [W - 14, 136, "end", "More energy"],
            [W - 14, 176, "end", "Boosts desire"],
          ].map(([x, y, anchor, label]) => (
            <g key={String(label)}>
              <circle cx={anchor === "start" ? Number(x) + 5 : Number(x) - 5} cy={Number(y) - 3} r={5} fill="none" stroke={fg} strokeWidth={1} />
              <text x={anchor === "start" ? Number(x) + 14 : Number(x) - 14} y={Number(y)} textAnchor={anchor as "start" | "end"} fontSize={6.5} fontWeight={700} fill={fg}>{String(label)}</text>
            </g>
          ))}
          <Press fg={fg} y={236} />
        </g>
      ) : null}

      {layout === "wall" ? (
        <g>
          {Array.from({ length: 12 }).map((_, r) =>
            Array.from({ length: 6 }).map((__, c) => (
              <rect key={`${r}-${c}`} x={(r % 2 ? -16 : 0) + c * 36} y={r * 21} width={34} height={19} fill="none" stroke="#d9d9d9" strokeWidth={1} />
            ))
          )}
          <text x={W / 2} y={34} textAnchor="middle" fontSize={13} fontWeight={900} fill={fg} fontFamily="Arial, sans-serif">
            <tspan x={W / 2}>{l1}</tspan>
            <tspan x={W / 2} dy={14}>{l2 || p.sub}</tspan>
          </text>
          <text x={W / 2} y={66} textAnchor="middle" fontSize={4.6} fontWeight={800} fill={fg}>DAD BOD GONE · ENERGY RESTORED · WOOD LIKE 15 · MELT MAN BOOBS</text>
          <path d="M 20 120 L 55 95 L 70 130 L 95 108 L 90 160 L 60 190 L 30 175 L 15 150 Z" fill="#3c3c3c" />
          <circle cx={58} cy={118} r={11} fill="#c9a07a" />
          <rect x={44} y={130} width={28} height={40} rx={8} fill="#c9a07a" />
          <Ring cx={148} cy={140} r={36} />
          <Press fg={fg} y={236} />
        </g>
      ) : null}

      {layout === "body" ? (
        <g>
          <ellipse cx={W / 2} cy={190} rx={90} ry={70} fill="#c99476" />
          <ellipse cx={W / 2} cy={205} rx={70} ry={38} fill="#8a1d3d" opacity={0.85} />
          <text x={W / 2} y={36} textAnchor="middle" fontSize={13} fontStyle="italic" fill={fg} fontFamily="Georgia, serif">{p.headline}</text>
          <text x={W / 2} y={50} textAnchor="middle" fontSize={5} fill={fg} opacity={0.9}>{p.sub}</text>
          <Ring cx={W / 2} cy={140} r={40} />
          <Callout fg={fg} x={16} y={100} anchor="start" text="BURNS OFF BEER BELLY" />
          <Callout fg={fg} x={16} y={182} anchor="start" text="BOOSTS DESIRE" />
          <Callout fg={fg} x={W - 16} y={104} anchor="end" text="MELTS MAN BOOBS" />
          <Callout fg={fg} x={W - 16} y={186} anchor="end" text="REDUCES JOINT PAIN" />
          <Arrow fg={fg} d="M 38 110 Q 46 130 56 138" />
          <Arrow fg={fg} d="M 162 112 Q 154 128 144 138" />
          <Press fg={fg} y={238} />
        </g>
      ) : null}
    </svg>
  );
}

function StyleCard({ style, onOpen }: { style: StyleTemplate; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group overflow-hidden rounded-2xl bg-white text-left ring-1 ring-slate-900/[0.06] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_rgba(35,49,55,0.4)] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]"
    >
      <div className="relative overflow-hidden bg-slate-100 dark:bg-slate-800" style={{ aspectRatio: "4 / 5" }}>
        <StylePoster style={style} />
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-slate-950/70 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-white backdrop-blur">
          {style.kind === "static" ? <ImageIcon className="h-2.5 w-2.5" /> : <Film className="h-2.5 w-2.5" />}
          {style.kind === "static" ? "Statique" : "Vidéo"}
        </span>
      </div>
      <div className="p-2.5">
        <div className="truncate text-[12px] font-semibold text-slate-900 dark:text-slate-100">{style.name}</div>
        <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-slate-500">{style.pitch}</div>
      </div>
    </button>
  );
}

function StyleDialog({ style, onClose, onDelete }: { style: StyleTemplate; onClose: () => void; onDelete: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="grid max-h-[88vh] w-full max-w-4xl gap-4 overflow-auto rounded-3xl bg-white p-4 sm:grid-cols-[280px_minmax(0,1fr)] dark:bg-slate-900" onClick={(event) => event.stopPropagation()}>
        <div className="overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-800" style={{ aspectRatio: "4 / 5" }}>
          <StylePoster style={style} />
        </div>
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="eyebrow">{style.kind === "static" ? "Statique" : "Vidéo"}{style.builtin ? " · intégré" : ""}</span>
              <h3 className="font-display text-2xl text-slate-900 dark:text-slate-50">{style.name}</h3>
              <p className="text-[12px] text-slate-500">{style.pitch}</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X className="h-4 w-4" />
            </button>
          </div>

          {style.static ? (
            <div className="mt-3 space-y-2 text-[11px] leading-snug text-slate-600 dark:text-slate-300">
              <div>
                <span className="eyebrow">Mise en page · {style.static.aspect}</span>
                <p className="mt-0.5">{style.static.layout}</p>
              </div>
              {style.static.fontStyle ? (
                <div>
                  <span className="eyebrow">Typographie</span>
                  <p className="mt-0.5">{style.static.fontStyle}</p>
                </div>
              ) : null}
              <div>
                <span className="eyebrow">Éléments ({style.static.elements.length})</span>
                <ul className="mt-1 space-y-1">
                  {style.static.elements.map((element, i) => (
                    <li key={i} className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{element.kind}</span> · {element.position}
                      {element.sourceText ? <span className="block italic">« {element.sourceText} »</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {style.video ? (
            <div className="mt-3 space-y-2 text-[11px] leading-snug text-slate-600 dark:text-slate-300">
              <div>
                <span className="eyebrow">Dispositif · {Math.round(style.video.duration)}s · {style.video.shots.length} plans</span>
                <p className="mt-0.5">{style.video.styleBlock || "Style non relevé"}</p>
              </div>
              <ul className="space-y-1">
                {style.video.shots.map((shot) => (
                  <li key={shot.index} className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">Plan {shot.index + 1} · {shot.duration}s</span> · {shot.framing || "cadrage libre"}
                    {shot.line ? <span className="block italic">« {shot.line} »</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {style.kind === "video" ? (
              <Button asChild size="sm">
                <Link href="/ugc">Utiliser dans UGC Creative</Link>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link href="/ugc?tab=remake">Utiliser dans le Remake</Link>
              </Button>
            )}
            {!style.builtin ? (
              <Button size="sm" variant="outline" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
                Supprimer
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="eyebrow mb-1 block">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-950"
      />
    </label>
  );
}
