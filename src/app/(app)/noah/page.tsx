"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Clapperboard, Copy, ExternalLink, Film, Flame, HardDrive, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth/auth-context";
import { KieCredit } from "@/components/layout/kie-credit";
import type { NoahConfig, NoahPost, NoahStore } from "@/lib/noah/store";
import { cn } from "@/lib/utils";

/** Le jour local (AAAA-MM-JJ) d'une date : « aujourd'hui » est celui de Noah, sur son téléphone ou son PC. */
function localDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000);
}

/** L'objectif du jour N de la chauffe, d'après les paliers. */
function targetFor(config: NoahConfig, day: number) {
  let target = config.ramp[0]?.perDay ?? 3;
  for (const step of config.ramp) if (day >= step.fromDay) target = step.perDay;
  return target;
}

/** Une vidéo tuto lisible dans la page quand c'est YouTube, Loom ou Google Drive ; sinon un lien. */
function embedUrl(url: string) {
  const yt = /(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url)?.[1];
  if (yt) return `https://www.youtube.com/embed/${yt}`;
  const loom = /loom\.com\/share\/([\w-]+)/.exec(url)?.[1];
  if (loom) return `https://www.loom.com/embed/${loom}`;
  const drive = /drive\.google\.com\/file\/d\/([\w-]+)/.exec(url)?.[1];
  if (drive) return `https://drive.google.com/file/d/${drive}/preview`;
  return "";
}

const card = "rounded-2xl bg-white p-4 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-white/[0.06]";
const field = "h-9 w-full rounded-lg bg-slate-50 px-3 text-[13px] outline-none ring-1 ring-slate-900/10 focus:bg-white dark:bg-slate-800";

export default function NoahPage() {
  const { user, isAdmin } = useAuth();
  const [store, setStore] = useState<NoahStore | null>(null);
  const [posting, setPosting] = useState(false);
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<NoahConfig | null>(null);
  const [today, setToday] = useState("");

  useEffect(() => {
    let alive = true;
    void fetch("/api/noah", { cache: "no-store" })
      .then((res) => res.json() as Promise<NoahStore>)
      .then((body) => {
        if (alive) setStore(body);
      });
    // Le jour change à minuit : relu toutes les minutes.
    const tick = () => setToday(localDay(new Date()));
    tick();
    const timer = window.setInterval(tick, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/noah", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await res.json()) as NoahStore & { error?: string };
      if (!res.ok) throw new Error(json.error || "Action impossible");
      setStore(json);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action impossible");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const byDay = useMemo(() => {
    const map = new Map<string, NoahPost[]>();
    for (const post of store?.posts ?? []) {
      const day = localDay(new Date(post.at));
      map.set(day, [...(map.get(day) ?? []), post]);
    }
    return map;
  }, [store]);

  if (!store || !today) {
    return (
      <div className="flex h-60 items-center justify-center text-slate-400">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const config = store.config;
  const start = config.warmupStart || today;
  const day = Math.max(1, daysBetween(start, today) + 1);
  const target = targetFor(config, day);
  const todayPosts = byDay.get(today) ?? [];
  const done = todayPosts.length;
  const pct = Math.min(100, Math.round((done / Math.max(1, target)) * 100));
  const nextStep = config.ramp.find((step) => step.fromDay > day);
  const history = Array.from({ length: 14 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (13 - index));
    const key = localDay(date);
    const n = Math.max(1, daysBetween(start, key) + 1);
    return { key, count: byDay.get(key)?.length ?? 0, target: key < start ? 0 : targetFor(config, n), label: date.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" }) };
  });
  // Jours d'affilée avec l'objectif atteint (aujourd'hui compte s'il est déjà atteint).
  let streak = 0;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item.key === today && item.count < item.target) continue;
    if (item.target > 0 && item.count >= item.target) streak += 1;
    else break;
  }
  const firstName = user?.role === "assistant" ? (user.full_name || "Noah").split(" ")[0] : "";

  async function logPost() {
    const ok = await send({ action: "log-post", url, note });
    if (ok) {
      setUrl("");
      setNote("");
      setPosting(false);
      toast.success(done + 1 >= target ? "Objectif du jour atteint 🔥" : `Réel compté : ${done + 1}/${target}`);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">{firstName ? `Bonjour ${firstName} 👋` : "Noah · Instagram"}</h1>
          <p className="text-[13px] text-slate-500">
            Instagram organique de <span className="font-semibold">@{config.account}</span> · jour {day} de la chauffe du compte
          </p>
        </div>
        {isAdmin ? (
          <button
            type="button"
            onClick={() => {
              setDraft(JSON.parse(JSON.stringify(config)) as NoahConfig);
              setEditing((value) => !value);
            }}
            className="rounded-lg bg-slate-900 px-3 py-2 text-[12px] font-semibold text-white dark:bg-white dark:text-slate-900"
          >
            {editing ? "Fermer l'édition" : "Modifier tutos, prompts et objectifs"}
          </button>
        ) : null}
      </div>

      {/* Objectif du jour */}
      <div className={cn(card, "space-y-3")}>
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Réels publiés aujourd&apos;hui</p>
            <p className="text-[40px] font-bold leading-none tabular-nums">
              {done}
              <span className="text-[22px] font-semibold text-slate-400"> / {target}</span>
            </p>
          </div>
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className={cn("h-full rounded-full transition-all", done >= target ? "bg-emerald-500" : "bg-sky-500")} style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[12px] text-slate-500">
              {done >= target ? "Objectif atteint, bravo. Tu peux en faire plus si tu as de bons réels." : `Encore ${target - done} réel${target - done > 1 ? "s" : ""} aujourd'hui, répartis dans la journée.`}
              {nextStep ? ` À partir du jour ${nextStep.fromDay} : ${nextStep.perDay} par jour.` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
            <Flame className="h-4 w-4" /> {`${streak} jour${streak > 1 ? "s" : ""} d’affilée`}
          </div>
        </div>

        {posting ? (
          <div className="grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto] dark:bg-slate-800/60">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Lien du réel (facultatif)" className={field} />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (facultatif) : produit, hook…" className={field} />
            <button type="button" disabled={busy} onClick={() => void logPost()} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-[13px] font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Compter
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setPosting(true)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-[14px] font-semibold text-white">
            <Plus className="h-4 w-4" /> J&apos;ai posté un réel
          </button>
        )}

        {todayPosts.length ? (
          <ul className="divide-y divide-slate-100 text-[13px] dark:divide-slate-800">
            {todayPosts.map((post) => (
              <li key={post.id} className="flex items-center gap-3 py-1.5">
                <span className="w-12 shrink-0 font-mono text-[12px] text-slate-400">{new Date(post.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="min-w-0 flex-1 truncate">
                  {post.url ? (
                    <a href={post.url} target="_blank" rel="noreferrer" className="font-medium underline">
                      {post.url.replace(/^https?:\/\/(www\.)?/, "")}
                    </a>
                  ) : (
                    <span className="text-slate-500">Réel publié</span>
                  )}
                  {post.note ? <span className="text-slate-400"> · {post.note}</span> : null}
                </span>
                {isAdmin || post.by === user?.email ? (
                  <button type="button" onClick={() => void send({ action: "delete-post", id: post.id })} title="Retirer (erreur de clic)" className="text-slate-300 hover:text-rose-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Les 14 derniers jours */}
      <div className={card}>
        <p className="mb-3 text-[13px] font-semibold">Les 14 derniers jours</p>
        <div className="grid grid-cols-7 gap-2 sm:grid-cols-14">
          {history.map((item) => (
            <div key={item.key} className="flex flex-col items-center gap-1">
              <div className="flex h-20 w-full items-end overflow-hidden rounded-md bg-slate-100 dark:bg-slate-800">
                <div
                  className={cn("w-full rounded-md", item.target && item.count >= item.target ? "bg-emerald-500" : item.count ? "bg-sky-400" : "bg-transparent")}
                  style={{ height: `${Math.min(100, (item.count / Math.max(1, item.target || 10)) * 100)}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold tabular-nums">
                {item.count}
                {item.target ? <span className="text-slate-400">/{item.target}</span> : null}
              </span>
              <span className="text-[10px] text-slate-400">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* La routine */}
        <div className={cn(card, "space-y-2")}>
          <p className="text-[13px] font-semibold">Ta routine</p>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">{config.strategy}</p>
        </div>

        {/* Outils et liens */}
        <div className={cn(card, "space-y-2")}>
          <p className="text-[13px] font-semibold">Tes outils</p>
          <div className="grid grid-cols-2 gap-2 text-[13px]">
            <Link href="/moosha/studio" className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 font-medium hover:bg-slate-100 dark:bg-slate-800/60">
              <Clapperboard className="h-4 w-4" /> Studio IA
            </Link>
            <Link href="/moosha/montage" className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 font-medium hover:bg-slate-100 dark:bg-slate-800/60">
              <Film className="h-4 w-4" /> Montage
            </Link>
            <Link href="/moosha/drive" className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 font-medium hover:bg-slate-100 dark:bg-slate-800/60">
              <HardDrive className="h-4 w-4" /> Drive Moosha
            </Link>
            {config.links.map((link) => (
              <a key={link.id} href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 font-medium hover:bg-slate-100 dark:bg-slate-800/60">
                <ExternalLink className="h-4 w-4" /> <span className="truncate">{link.title}</span>
              </a>
            ))}
          </div>
          <div className="pt-1">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Crédits du Studio IA</p>
            <KieCredit />
          </div>
        </div>
      </div>

      {/* Tutos vidéo */}
      <div className={cn(card, "space-y-3")}>
        <p className="text-[13px] font-semibold">Tutos vidéo</p>
        {config.videos.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {config.videos.map((video) => {
              const embed = embedUrl(video.url);
              return (
                <div key={video.id} className="space-y-1.5">
                  <p className="text-[13px] font-semibold">{video.title}</p>
                  {embed ? (
                    <iframe src={embed} title={video.title} allow="fullscreen; picture-in-picture" allowFullScreen className="aspect-video w-full rounded-xl bg-black" />
                  ) : (
                    <a href={video.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[13px] font-medium underline">
                      Ouvrir la vidéo <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  {video.note ? <p className="whitespace-pre-line text-[12px] text-slate-500">{video.note}</p> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-slate-400">Mady va ajouter ici la vidéo qui explique la stratégie et le tuto du Studio IA.</p>
        )}
      </div>

      {/* Prompts */}
      <div className={cn(card, "space-y-3")}>
        <p className="text-[13px] font-semibold">Prompts à utiliser dans le Studio IA</p>
        {config.prompts.length ? (
          <div className="space-y-2">
            {config.prompts.map((prompt) => (
              <div key={prompt.id} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold">{prompt.title}</p>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard.writeText(prompt.text).then(() => toast.success("Prompt copié"))}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-white dark:hover:bg-slate-900"
                  >
                    <Copy className="h-3 w-3" /> Copier
                  </button>
                </div>
                <p className="whitespace-pre-line font-mono text-[12px] text-slate-600 dark:text-slate-300">{prompt.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-slate-400">Les prompts arrivent bientôt.</p>
        )}
      </div>

      {isAdmin && editing && draft ? <AdminEditor draft={draft} setDraft={setDraft} busy={busy} onSave={async () => { if (await send({ action: "save-config", config: draft })) { toast.success("Enregistré"); setEditing(false); } }} /> : null}
    </div>
  );
}

/** Identifiant d'un tuto, lien ou prompt ajouté. */
function newKey() {
  return Math.random().toString(36).slice(2, 10);
}

/** L'édition par Mady : stratégie, paliers de la chauffe, tutos, prompts, liens. */
function AdminEditor({ draft, setDraft, busy, onSave }: { draft: NoahConfig; setDraft: (next: NoahConfig) => void; busy: boolean; onSave: () => Promise<void> }) {
  return (
    <div className={cn(card, "space-y-4 ring-2 ring-sky-300")}>
      <p className="text-[14px] font-semibold">Préparer l&apos;espace de Noah</p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-[12px]">
          <span className="font-semibold text-slate-500">Compte Instagram</span>
          <input value={draft.account} onChange={(e) => setDraft({ ...draft, account: e.target.value.replace(/^@/, "") })} className={field} />
        </label>
        <label className="space-y-1 text-[12px]">
          <span className="font-semibold text-slate-500">Début de la chauffe (vide = premier réel)</span>
          <input type="date" value={draft.warmupStart} onChange={(e) => setDraft({ ...draft, warmupStart: e.target.value })} className={field} />
        </label>
      </div>

      <div className="space-y-1.5 text-[12px]">
        <p className="font-semibold text-slate-500">Objectif de réels par jour, par palier</p>
        {draft.ramp.map((step, index) => (
          <div key={index} className="flex items-center gap-2">
            <span>À partir du jour</span>
            <input type="number" min={1} value={step.fromDay} onChange={(e) => setDraft({ ...draft, ramp: draft.ramp.map((s, i) => (i === index ? { ...s, fromDay: Number(e.target.value) } : s)) })} className={cn(field, "w-20")} />
            <span>:</span>
            <input type="number" min={0} max={50} value={step.perDay} onChange={(e) => setDraft({ ...draft, ramp: draft.ramp.map((s, i) => (i === index ? { ...s, perDay: Number(e.target.value) } : s)) })} className={cn(field, "w-20")} />
            <span>réels / jour</span>
            <button type="button" onClick={() => setDraft({ ...draft, ramp: draft.ramp.filter((_, i) => i !== index) })} className="text-slate-400 hover:text-rose-600">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button type="button" onClick={() => setDraft({ ...draft, ramp: [...draft.ramp, { fromDay: (draft.ramp.at(-1)?.fromDay ?? 0) + 7, perDay: 10 }] })} className="text-[12px] font-semibold text-sky-600">
          + Ajouter un palier
        </button>
      </div>

      <label className="block space-y-1 text-[12px]">
        <span className="font-semibold text-slate-500">Routine / stratégie (affichée à Noah)</span>
        <textarea value={draft.strategy} onChange={(e) => setDraft({ ...draft, strategy: e.target.value })} rows={6} className="w-full rounded-lg bg-slate-50 p-3 text-[13px] outline-none ring-1 ring-slate-900/10 dark:bg-slate-800" />
      </label>

      {(
        [
          ["videos", "Tutos vidéo (YouTube, Loom ou Google Drive s'affichent dans la page)"],
          ["links", "Liens utiles (Buffer, Instagram…)"],
        ] as const
      ).map(([key, label]) => (
        <div key={key} className="space-y-1.5 text-[12px]">
          <p className="font-semibold text-slate-500">{label}</p>
          {draft[key].map((item, index) => (
            <div key={item.id} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
              <input value={item.title} placeholder="Titre" onChange={(e) => setDraft({ ...draft, [key]: draft[key].map((it, i) => (i === index ? { ...it, title: e.target.value } : it)) })} className={field} />
              <input value={item.url} placeholder="https://…" onChange={(e) => setDraft({ ...draft, [key]: draft[key].map((it, i) => (i === index ? { ...it, url: e.target.value } : it)) })} className={field} />
              <button type="button" onClick={() => setDraft({ ...draft, [key]: draft[key].filter((_, i) => i !== index) })} className="text-slate-400 hover:text-rose-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => setDraft({ ...draft, [key]: [...draft[key], { id: newKey(), title: "", url: "", note: "" }] })} className="text-[12px] font-semibold text-sky-600">
            + Ajouter
          </button>
        </div>
      ))}

      <div className="space-y-1.5 text-[12px]">
        <p className="font-semibold text-slate-500">Prompts</p>
        {draft.prompts.map((prompt, index) => (
          <div key={prompt.id} className="space-y-1 rounded-xl bg-slate-50 p-2 dark:bg-slate-800/60">
            <div className="flex gap-2">
              <input value={prompt.title} placeholder="Titre (ex. Réel avant/après)" onChange={(e) => setDraft({ ...draft, prompts: draft.prompts.map((p, i) => (i === index ? { ...p, title: e.target.value } : p)) })} className={field} />
              <button type="button" onClick={() => setDraft({ ...draft, prompts: draft.prompts.filter((_, i) => i !== index) })} className="text-slate-400 hover:text-rose-600">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <textarea value={prompt.text} placeholder="Le prompt à copier dans le Studio IA" onChange={(e) => setDraft({ ...draft, prompts: draft.prompts.map((p, i) => (i === index ? { ...p, text: e.target.value } : p)) })} rows={3} className="w-full rounded-lg bg-white p-2 font-mono text-[12px] outline-none ring-1 ring-slate-900/10 dark:bg-slate-900" />
          </div>
        ))}
        <button type="button" onClick={() => setDraft({ ...draft, prompts: [...draft.prompts, { id: newKey(), title: "", text: "" }] })} className="text-[12px] font-semibold text-sky-600">
          + Ajouter un prompt
        </button>
      </div>

      <button type="button" disabled={busy} onClick={() => void onSave()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-[13px] font-semibold text-white disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Enregistrer
      </button>
    </div>
  );
}
