"use client";

import { useState } from "react";
import { CheckSquare, ChevronDown, Compass, ExternalLink, Loader2, Megaphone, Plus, Save, Square, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SendToDrive } from "@/components/drive/send-to-drive";
import { hasMedia, type BsBrand, type BsMetaAd } from "@/lib/brandsearch/client";
import { cn } from "@/lib/utils";

/**
 * Le côté Brandsearch de SpyShop.
 *
 * `DiscoverPanel` propose des marques qui scalent, filtrées par niche et par
 * trafic, à suivre d'un clic. `MetaAdsBlock` montre les pubs Meta actives
 * d'une boutique suivie, et les range en inspirations dans le Drive.
 */

const panel = "rounded-2xl bg-white p-3 ring-1 ring-slate-900/[0.06] dark:bg-slate-900/70 dark:ring-slate-100/[0.06]";

const NICHES = [
  ["", "Toutes niches"],
  ["Beauty & Skincare", "Beauté / skincare"],
  ["Health & Supplements", "Santé / compléments"],
  ["Fashion", "Mode"],
  ["Fitness", "Fitness"],
  ["Electronics & Tech", "Tech / gadgets"],
  ["Home & Garden", "Maison"],
  ["Pet Supplies", "Animaux"],
  ["Food & Drink", "Food"],
  ["Jewelry", "Bijoux"],
] as const;

function n(value: number | undefined | null) {
  if (value === undefined || value === null) return "—";
  return value.toLocaleString("fr-FR");
}

function usd(value: number | undefined | null) {
  if (value === undefined || value === null) return "—";
  return `${value.toFixed(0)} $`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error || "Brandsearch indisponible");
  return body;
}

/* ------------------------------------------------------------------ */
/* Découverte                                                           */
/* ------------------------------------------------------------------ */

export function DiscoverPanel({ onFollow, followed }: { onFollow: (brand: BsBrand) => Promise<void>; followed: Set<string> }) {
  const [open, setOpen] = useState(false);
  const [niche, setNiche] = useState("");
  const [visits, setVisits] = useState("50000");
  const [metaMin, setMetaMin] = useState("15");
  const [limit, setLimit] = useState("8");
  const [busy, setBusy] = useState(false);
  const [brands, setBrands] = useState<BsBrand[]>([]);
  const [adding, setAdding] = useState<string | null>(null);

  async function discover() {
    setBusy(true);
    try {
      const params = new URLSearchParams({ action: "discover", limit, visits_min: visits, meta_min: metaMin, seed: `msgate-${Date.now().toString(36)}` });
      if (niche) params.set("niche", niche);
      const body = await getJson<{ data: BsBrand[]; count: number }>(`/api/brandsearch?${params}`);
      setBrands(body.data ?? []);
      if (!body.data?.length) toast.error("Aucune marque pour ces filtres");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Découverte impossible");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn(panel, "mb-4")}>
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-2 text-left">
        <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
          <Compass className="h-4 w-4 text-slate-400" />
          Découvrir des marques qui scalent · Brandsearch
        </span>
        <ChevronDown className={cn("h-4 w-4 text-slate-400 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="eyebrow mb-1 block">Niche</span>
              <select value={niche} onChange={(event) => setNiche(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-950">
                {NICHES.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="eyebrow mb-1 block">Visites / mois min</span>
              <input value={visits} onChange={(event) => setVisits(event.target.value.replace(/\D/g, ""))} className="w-28 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label className="block">
              <span className="eyebrow mb-1 block">Pubs Meta actives min</span>
              <input value={metaMin} onChange={(event) => setMetaMin(event.target.value.replace(/\D/g, ""))} className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-950" />
            </label>
            <label className="block">
              <span className="eyebrow mb-1 block">Nombre</span>
              <select value={limit} onChange={(event) => setLimit(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[12px] dark:border-slate-700 dark:bg-slate-950">
                {["5", "8", "12", "20"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" onClick={() => void discover()} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Compass className="h-3.5 w-3.5" />}
              Tirer un lot
            </Button>
            <span className="text-[11px] text-slate-500">1 crédit Brandsearch par marque affichée. Chaque tirage est un nouvel échantillon.</span>
          </div>

          {brands.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-1 pr-2">Marque</th>
                    <th className="py-1 pr-2">Niche</th>
                    <th className="py-1 pr-2 text-right">Visites / mois</th>
                    <th className="py-1 pr-2 text-right">Pubs Meta actives</th>
                    <th className="py-1 pr-2 text-right">Produits</th>
                    <th className="py-1 pr-2 text-right">Prix moyen</th>
                    <th className="py-1 pr-2 text-right">Croissance 30 j</th>
                    <th className="py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {brands.map((brand) => {
                    const done = followed.has(brand.id);
                    return (
                      <tr key={brand.id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="py-1.5 pr-2">
                          <a href={`https://${brand.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-slate-900 hover:underline dark:text-slate-100">
                            {brand.name?.replace(/^www\./, "") || brand.id}
                            <ExternalLink className="h-3 w-3 text-slate-400" />
                          </a>
                          {brand.description ? <div className="max-w-[320px] truncate text-slate-500" title={brand.description}>{brand.description}</div> : null}
                        </td>
                        <td className="py-1.5 pr-2 text-slate-600 dark:text-slate-300">{brand.niche ?? "—"}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{n(brand.monthly_visits)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">
                          {n(brand.last_meta_active_count)}
                          {brand.last_meta_total_count ? <span className="text-slate-400"> / {n(brand.last_meta_total_count)}</span> : null}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{n(brand.product_count)}</td>
                        <td className="py-1.5 pr-2 text-right tabular-nums">{usd(brand.avg_price_usd)}</td>
                        <td className={cn("py-1.5 pr-2 text-right tabular-nums", (brand.growth_30d ?? 0) > 0 ? "text-emerald-600" : "text-slate-500")}>
                          {brand.growth_30d === undefined || brand.growth_30d === null ? "—" : `${brand.growth_30d > 0 ? "+" : ""}${brand.growth_30d.toFixed(0)} %`}
                        </td>
                        <td className="py-1.5 text-right">
                          <Button
                            size="sm"
                            variant={done ? "outline" : "default"}
                            disabled={done || adding === brand.id}
                            onClick={async () => {
                              setAdding(brand.id);
                              try {
                                await onFollow(brand);
                              } finally {
                                setAdding(null);
                              }
                            }}
                          >
                            {adding === brand.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                            {done ? "Suivie" : "Suivre"}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pubs Meta d'une boutique suivie                                      */
/* ------------------------------------------------------------------ */

export function MetaAdsBlock({ shopUrl, folder, onSaved }: { shopUrl: string; folder: string; onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState<BsBrand | null>(null);
  const [ads, setAds] = useState<BsMetaAd[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<BsMetaAd | null>(null);
  /* Sélection multiple : les pubs cochées partent ensemble vers le dossier du Drive choisi. */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Envoie une pub dans un dossier précis, sans toast : l'appelant résume. */
  async function saveInto(ad: BsMetaAd, into: string) {
    const res = await fetch("/api/brandsearch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save-ad", folder: into, ad }),
    });
    const body = (await res.json()) as { path?: string; error?: string };
    if (!res.ok) throw new Error(body.error || "Enregistrement impossible");
    if (into === folder) setSaved((current) => new Set(current).add(ad.id));
  }

  /** La sélection part vers le dossier choisi dans le sélecteur Drive. */
  async function sendSelection(into: string) {
    const picked = (ads ?? []).filter((ad) => selected.has(ad.id));
    let sent = 0;
    let failed = 0;
    setSaving("bulk");
    try {
      for (const ad of picked) {
        if (!hasMedia(ad)) {
          failed += 1;
          continue;
        }
        try {
          await saveInto(ad, into);
          sent += 1;
        } catch {
          failed += 1;
        }
      }
    } finally {
      setSaving(null);
    }
    if (sent && into === folder) onSaved?.();
    if (!sent) throw new Error(failed ? "Aucune pub envoyée : médias indisponibles" : "Aucune pub sélectionnée");
    setSelected(new Set());
    return `${sent} pub(s) envoyée(s) dans ${into ? `« ${into.split("/").pop()} »` : "le Drive"}${failed ? ` · ${failed} sans média` : ""}`;
  }

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const brandBody = await getJson<{ brand: BsBrand }>(`/api/brandsearch?action=brand&url=${encodeURIComponent(shopUrl)}`);
      setBrand(brandBody.brand);
      const adsBody = await getJson<{ data: BsMetaAd[] }>(`/api/brandsearch?action=ads&brand=${encodeURIComponent(brandBody.brand.id)}&limit=12`);
      setAds(adsBody.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Brandsearch indisponible");
      setAds([]);
    } finally {
      setBusy(false);
    }
  }

  async function save(ad: BsMetaAd) {
    setSaving(ad.id);
    try {
      const res = await fetch("/api/brandsearch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-ad", folder, ad }),
      });
      const body = (await res.json()) as { path?: string; error?: string };
      if (!res.ok) throw new Error(body.error || "Enregistrement impossible");
      setSaved((current) => new Set(current).add(ad.id));
      toast.success(`Pub rangée dans « ${folder} »`);
      onSaved?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Enregistrement impossible");
    } finally {
      setSaving(null);
    }
  }

  async function saveAll() {
    if (!ads) return;
    for (const ad of ads) {
      if (!saved.has(ad.id)) await save(ad);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 p-2 dark:border-slate-700">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          if (!open && ads === null && !busy) void load();
        }}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          <Megaphone className="h-3.5 w-3.5" />
          Pubs Meta actives · Brandsearch
          {brand?.last_meta_active_count !== undefined ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 normal-case tracking-normal text-slate-700 dark:bg-slate-800 dark:text-slate-200">{n(brand.last_meta_active_count)}</span> : null}
        </span>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition-transform", open && "rotate-180")} />}
      </button>

      {open ? (
        <div className="mt-2 space-y-2">
          {brand ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
              <span>
                <strong className="text-slate-900 dark:text-slate-100">{n(brand.monthly_visits)}</strong> visites / mois
              </span>
              <span>
                <strong className="text-slate-900 dark:text-slate-100">{n(brand.last_meta_active_count)}</strong> pubs actives
                {brand.last_meta_total_count ? ` sur ${n(brand.last_meta_total_count)}` : ""}
              </span>
              <span>
                <strong className="text-slate-900 dark:text-slate-100">{n(brand.product_count)}</strong> produits
              </span>
              <span>
                prix moyen <strong className="text-slate-900 dark:text-slate-100">{usd(brand.avg_price_usd)}</strong>
              </span>
              {brand.growth_30d !== undefined && brand.growth_30d !== null ? (
                <span className={(brand.growth_30d ?? 0) > 0 ? "text-emerald-600" : ""}>
                  {brand.growth_30d > 0 ? "+" : ""}
                  {brand.growth_30d.toFixed(0)} % sur 30 j
                </span>
              ) : null}
              {brand.niche ? <span>{brand.niche}</span> : null}
            </div>
          ) : null}

          {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}

          {ads?.length ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="text-[11px] text-slate-500">{ads.length} pubs, les plus dépensières d&apos;abord · 1 crédit par pub lue</span>
                <span className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const ids = ads.filter(hasMedia).map((ad) => ad.id);
                      const allIn = ids.every((id) => selected.has(id));
                      setSelected(allIn ? new Set() : new Set(ids));
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:underline dark:text-slate-300"
                  >
                    <CheckSquare className="h-3 w-3" />
                    {ads.filter(hasMedia).every((ad) => selected.has(ad.id)) && selected.size ? "Tout désélectionner" : "Tout sélectionner"}
                  </button>
                  <button type="button" onClick={() => void saveAll()} disabled={saving !== null} className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:underline disabled:opacity-50">
                    <Save className="h-3 w-3" />
                    Tout ranger en inspirations
                  </button>
                </span>
              </div>
              {selected.size ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] text-white dark:bg-white dark:text-slate-900">
                  <CheckSquare className="h-3.5 w-3.5" />
                  <span className="font-semibold">{selected.size} pub{selected.size > 1 ? "s" : ""} sélectionnée{selected.size > 1 ? "s" : ""}</span>
                  <SendToDrive send={sendSelection} label="Envoyer la sélection au Drive" disabled={saving !== null} className="[&>button]:h-7 [&>button]:bg-white [&>button]:text-slate-900 dark:[&>button]:bg-slate-900 dark:[&>button]:text-white" />
                  <button type="button" onClick={() => setSelected(new Set())} className="ml-auto underline-offset-2 hover:underline">
                    Annuler
                  </button>
                </div>
              ) : null}
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {ads.map((ad) => {
                  const thumb = ad.image_url || ad.thumbnail_url;
                  const isSaved = saved.has(ad.id);
                  const isSelected = selected.has(ad.id);
                  return (
                    <div key={ad.id} className="w-[110px] shrink-0">
                      <div className={cn("relative aspect-[4/5] w-full overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700", isSelected && "ring-2 ring-emerald-500")}>
                      <button type="button" onClick={() => setPreview(ad)} className="block h-full w-full" title={ad.creative?.title || ad.creative?.description || ""}>
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-slate-400">
                            <Megaphone className="h-5 w-5" />
                          </div>
                        )}
                        {ad.is_video ? <span className="absolute left-1 top-6 rounded bg-slate-950/70 px-1 text-[9px] font-semibold text-white">VIDÉO{ad.duration ? ` ${Math.round(ad.duration)}s` : ""}</span> : null}
                        {ad.is_video && !ad.video_hd_url && !ad.video_sd_url ? <span className="absolute inset-x-1 bottom-1 rounded bg-amber-500/90 px-1 text-center text-[9px] font-semibold text-white">fichier pas encore dispo</span> : null}
                        {ad.funnel_type ? <span className="absolute right-1 top-1 rounded bg-slate-950/70 px-1 text-[9px] font-semibold text-white">{ad.funnel_type}</span> : null}
                      </button>
                      {hasMedia(ad) ? (
                        <button
                          type="button"
                          onClick={() => toggleSelected(ad.id)}
                          title={isSelected ? "Retirer de la sélection" : "Sélectionner"}
                          className={cn("absolute left-1 top-1 rounded-md p-1 text-white", isSelected ? "bg-emerald-600" : "bg-slate-950/60 opacity-70 hover:opacity-100")}
                        >
                          {isSelected ? <CheckSquare className="h-3 w-3" /> : <Square className="h-3 w-3" />}
                        </button>
                      ) : null}
                      </div>
                      <div className="mt-0.5 truncate text-[10px] text-slate-600 dark:text-slate-300" title={ad.creative?.title || ""}>
                        {ad.creative?.title || ad.creative?.description?.slice(0, 40) || "—"}
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>{ad.eu_total_spend ? `${Math.round(ad.eu_total_spend).toLocaleString("fr-FR")} €` : ad.start_date ? new Date(ad.start_date).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : ""}</span>
                        <button type="button" onClick={() => void save(ad)} disabled={isSaved || saving === ad.id || !hasMedia(ad)} title={hasMedia(ad) ? "Ranger en inspirations" : "Média pas encore disponible"} className={cn("rounded p-0.5", isSaved ? "text-emerald-600" : "text-slate-400 hover:text-slate-900")}>
                          {saving === ad.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : ads && !error ? (
            <p className="text-[11px] text-slate-400">Aucune pub Meta active trouvée pour cette boutique.</p>
          ) : null}
        </div>
      ) : null}

      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm" onClick={() => setPreview(null)}>
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900 md:flex-row" onClick={(event) => event.stopPropagation()}>
            <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-950">
              {preview.video_hd_url || preview.video_sd_url ? (
                <video src={preview.video_hd_url || preview.video_sd_url} controls autoPlay playsInline className="max-h-[85vh] w-auto max-w-full" />
              ) : preview.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.image_original_url || preview.image_url} alt="" className="max-h-[85vh] w-auto max-w-full object-contain" />
              ) : (
                <div className="p-10 text-[12px] text-slate-300">Média pas encore disponible chez Brandsearch.</div>
              )}
            </div>
            <div className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto p-4 md:w-[300px]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">{preview.creative?.title || "Pub Meta"}</div>
                  <div className="text-[11px] text-slate-500">
                    {preview.status} · {preview.start_date ? `depuis le ${new Date(preview.start_date).toLocaleDateString("fr-FR")}` : ""}
                    {preview.funnel_type ? ` · ${preview.funnel_type}` : ""}
                    {preview.eu_total_spend ? ` · ${Math.round(preview.eu_total_spend).toLocaleString("fr-FR")} € (UE)` : ""}
                    {preview.eu_total_reach ? ` · ${n(preview.eu_total_reach)} reach` : ""}
                  </div>
                </div>
                <button type="button" onClick={() => setPreview(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Fermer">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {preview.creative?.description ? <p className="whitespace-pre-wrap rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-950 dark:text-slate-400">{preview.creative.description}</p> : null}
              {preview.creative?.cta?.text ? <div className="text-[11px] text-slate-500">CTA : {preview.creative.cta.text}</div> : null}
              <SendToDrive
                send={async (into) => {
                  await saveInto(preview, into);
                  if (into === folder) onSaved?.();
                  return `Pub envoyée dans ${into ? `« ${into.split("/").pop()} »` : "le Drive"}`;
                }}
                label="Autre dossier du Drive"
                disabled={!hasMedia(preview)}
              />
              <Button size="sm" onClick={() => void save(preview)} disabled={saved.has(preview.id) || saving === preview.id}>
                {saving === preview.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {saved.has(preview.id) ? "Rangée en inspirations" : "Ranger en inspirations"}
              </Button>
              {preview.dashboard_url ? (
                <a href={preview.dashboard_url} target="_blank" rel="noreferrer" className="text-[11px] text-emerald-600 hover:underline">
                  Ouvrir dans Brandsearch
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
