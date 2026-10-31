"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Clapperboard, ExternalLink, Lightbulb, Loader2, Pencil, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ProductIdea } from "@/lib/associate/product-ideas";

/**
 * « Produits à lancer » : le tableau commun de Mady et Alison. Un reel
 * Instagram repéré + la page du produit, c'est tout. Relu toutes les 20 s pour
 * voir ce que l'autre ajoute.
 */

const POLL_MS = 20_000;

const inputClass = "w-full rounded-xl border bg-transparent px-3 py-2 text-[13px] outline-none transition-shadow focus:ring-2";
const inputStyle = { borderColor: "var(--line)", color: "var(--ink)" } as const;

function host(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function shortPath(url: string) {
  try {
    const parsed = new URL(url);
    const tail = parsed.pathname.replace(/\/$/, "");
    return tail.length > 28 ? `…${tail.slice(-26)}` : tail || "/";
  } catch {
    return "";
  }
}

async function send(body: unknown): Promise<ProductIdea[]> {
  const res = await fetch("/api/associate/ideas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as { ideas?: ProductIdea[]; error?: string };
  if (!res.ok || !json.ideas) throw new Error(json.error ?? "Enregistrement impossible");
  return json.ideas;
}

export default function ProductIdeasPage() {
  const [ideas, setIdeas] = useState<ProductIdea[] | null>(null);
  const [reel, setReel] = useState("");
  const [product, setProduct] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/associate/ideas", { cache: "no-store" });
        const json = (await res.json()) as { ideas?: ProductIdea[] };
        if (alive && json.ideas) setIdeas(json.ideas);
      } catch {
        // Le prochain passage réessaiera.
      }
    };
    const first = window.setTimeout(load, 0);
    const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  const run = useCallback(async (body: unknown, done?: string) => {
    setBusy(true);
    try {
      setIdeas(await send(body));
      if (done) toast.success(done);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enregistrement impossible");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!reel.trim() && !product.trim()) return;
    if (await run({ action: "add", reelUrl: reel, productUrl: product }, "Produit ajouté")) {
      setReel("");
      setProduct("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="r-rise">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="r-chip">
            <Lightbulb className="h-3.5 w-3.5" />
            Tableau commun · Mady & Alison
          </span>
          {ideas ? <span className="r-chip">{ideas.length} produit(s)</span> : null}
        </div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight" style={{ color: "var(--ink)" }}>
          Produits à lancer
        </h1>
        <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
          Le reel Instagram qui t&apos;a fait tilter et la page du produit. Vous voyez tous les deux la même liste.
        </p>
      </div>

      <form onSubmit={add} className="r-card r-rise grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]" style={{ animationDelay: "60ms" }}>
        <label className="block space-y-1.5">
          <span className="r-label">Lien du reel</span>
          <input value={reel} onChange={(event) => setReel(event.target.value)} placeholder="https://www.instagram.com/reel/…" className={inputClass} style={inputStyle} inputMode="url" />
        </label>
        <label className="block space-y-1.5">
          <span className="r-label">Lien de la page produit</span>
          <input value={product} onChange={(event) => setProduct(event.target.value)} placeholder="https://boutique.com/products/…" className={inputClass} style={inputStyle} inputMode="url" />
        </label>
        <button
          type="submit"
          disabled={busy || (!reel.trim() && !product.trim())}
          className="inline-flex h-10 items-center justify-center gap-1.5 self-end rounded-xl px-4 text-[13px] font-semibold text-white transition-opacity disabled:opacity-50"
          style={{ background: "var(--r-accent, #e85a8b)" }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Ajouter
        </button>
      </form>

      {/* Sur téléphone : une carte par produit, empilées. */}
      <div className="r-rise space-y-2.5 md:hidden" style={{ animationDelay: "120ms" }}>
        {(ideas ?? []).map((idea) => (
          <IdeaRow key={idea.id} idea={idea} busy={busy} onRun={run} card />
        ))}
        {ideas && !ideas.length ? <p className="r-card r-sub px-4 py-10 text-center">Pas encore de produit. Colle un lien de reel et une page produit au-dessus.</p> : null}
        {!ideas ? <p className="r-card r-sub py-10 text-center">Chargement…</p> : null}
      </div>

      <div className="r-card r-rise hidden overflow-hidden md:block" style={{ animationDelay: "120ms" }}>
        <div className="overflow-x-auto px-2 py-2">
          <table className="w-full min-w-[680px] text-[12.5px]">
            <thead>
              <tr className="r-label text-left">
                <th className="px-3 py-2 font-medium">Reel</th>
                <th className="px-3 py-2 font-medium">Page produit</th>
                <th className="px-3 py-2 font-medium">Ajouté par</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="w-20 px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(ideas ?? []).map((idea) => (
                <IdeaRow key={idea.id} idea={idea} busy={busy} onRun={run} />
              ))}
              {ideas && !ideas.length ? (
                <tr>
                  <td colSpan={5} className="r-sub py-10 text-center">
                    Pas encore de produit. Colle un lien de reel et une page produit au-dessus.
                  </td>
                </tr>
              ) : null}
              {!ideas ? (
                <tr>
                  <td colSpan={5} className="r-sub py-10 text-center">
                    Chargement…
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function LinkCell({ url, icon, wide }: { url: string; icon: React.ReactNode; wide?: boolean }) {
  if (!url) return <span className="r-sub">—</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className={cn("group inline-flex items-center gap-2 font-medium hover:underline", wide ? "w-full min-w-0" : "max-w-[280px]")}
      style={{ color: "var(--ink)" }}
      title={url}
    >
      <span className="r-icon h-7 w-7 shrink-0 rounded-full">{icon}</span>
      <span className="min-w-0 truncate">
        {host(url)}
        <span className="r-sub ml-1">{shortPath(url)}</span>
      </span>
      <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
    </a>
  );
}

function IdeaRow({ idea, busy, onRun, card }: { idea: ProductIdea; busy: boolean; onRun: (body: unknown, done?: string) => Promise<boolean>; card?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [reel, setReel] = useState(idea.reelUrl);
  const [product, setProduct] = useState(idea.productUrl);

  function startEdit() {
    setReel(idea.reelUrl);
    setProduct(idea.productUrl);
    setEditing(true);
  }

  async function save() {
    if (await onRun({ action: "update", id: idea.id, reelUrl: reel, productUrl: product }, "Modifié")) setEditing(false);
  }

  const reelField = editing ? (
    <input value={reel} onChange={(event) => setReel(event.target.value)} className={inputClass} style={inputStyle} placeholder="Lien du reel" />
  ) : (
    <LinkCell url={idea.reelUrl} icon={<Clapperboard className="h-3.5 w-3.5" />} wide={card} />
  );
  const productField = editing ? (
    <input value={product} onChange={(event) => setProduct(event.target.value)} className={inputClass} style={inputStyle} placeholder="Lien de la page produit" />
  ) : (
    <LinkCell url={idea.productUrl} icon={<ShoppingBag className="h-3.5 w-3.5" />} wide={card} />
  );
  const date = new Date(idea.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const actions = (
    <div className={cn("flex justify-end gap-1", busy && "pointer-events-none opacity-60")}>
      {editing ? (
        <>
          <button type="button" title="Enregistrer" className="r-icon h-8 w-8 rounded-full" onClick={() => void save()}>
            <Check className="h-3.5 w-3.5" />
          </button>
          <button type="button" title="Annuler" className="r-icon h-8 w-8 rounded-full" onClick={() => setEditing(false)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <>
          <button type="button" title="Modifier" className="r-icon h-8 w-8 rounded-full" onClick={startEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title="Supprimer"
            className="r-icon h-8 w-8 rounded-full"
            onClick={() => window.confirm("Supprimer cette ligne pour vous deux ?") && void onRun({ action: "delete", id: idea.id }, "Ligne supprimée")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );

  if (card) {
    return (
      <div className="r-card space-y-2.5 p-3.5 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
        <div className="flex items-center justify-between gap-2">
          <span className="r-sub truncate">
            {idea.addedBy} · {date}
          </span>
          {actions}
        </div>
        <div className="space-y-2">
          {reelField}
          {productField}
        </div>
      </div>
    );
  }

  return (
    <tr className="border-t align-middle" style={{ borderColor: "var(--line)", color: "var(--ink-2)" }}>
      <td className="px-3 py-2.5">{reelField}</td>
      <td className="px-3 py-2.5">{productField}</td>
      <td className="px-3 py-2.5">{idea.addedBy}</td>
      <td className="px-3 py-2.5 tabular-nums">{date}</td>
      <td className="px-3 py-2.5">{actions}</td>
    </tr>
  );
}
