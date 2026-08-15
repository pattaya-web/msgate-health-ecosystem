"use client";

/* eslint-disable @next/next/no-img-element -- fbcdn URLs are signed and short-lived, the optimizer cannot cache them. */

import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { proxyMediaUrl } from "@/lib/meta/download";
import type { CreativeAsset, CreativeDetail } from "@/lib/meta/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/* ------------------------------------------------------------------ *
 * Shared bits
 * ------------------------------------------------------------------ */

export function assetHref(asset: CreativeAsset, name: string, inline = false) {
  if (!asset.url) return null;
  return proxyMediaUrl(asset.url, { name, kind: asset.kind, inline });
}

export async function copyText(value: string, label = "Copié") {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(label);
  } catch {
    toast.error("Copie refusée par le navigateur");
  }
}

/** Copy affordance that confirms in place instead of only toasting. */
function CopyButton({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setDone(false), 1400);
    return () => clearTimeout(timer);
  }, [done]);

  return (
    <button
      type="button"
      onClick={() => {
        void copyText(value, label);
        setDone(true);
      }}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-lg px-1.5 text-[10px] font-medium transition-colors",
        done
          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
          : "text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      )}
    >
      {done ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {done ? "Copié" : "Copier"}
    </button>
  );
}

function Field({ label, value, href }: { label: string; value: string; href?: string | null }) {
  return (
    <div className="flex items-center gap-2 border-t border-slate-900/[0.06] py-1.5 dark:border-white/[0.06]">
      <span className="w-20 shrink-0 text-[10px] uppercase tracking-wide text-slate-400">
        {label}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-700 dark:text-slate-300">
        {value}
      </span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
      <CopyButton value={value} label={`${label} copié`} />
    </div>
  );
}

function TextBlock({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;

  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
          {label}
        </h3>
        {values.length > 1 ? (
          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {values.length} variantes
          </span>
        ) : null}
        <div className="ml-auto">
          <CopyButton value={values.join("\n\n")} label={`${label} copié`} />
        </div>
      </div>

      <div className="space-y-1.5">
        {values.map((value, index) => (
          <div
            key={`${index}-${value.slice(0, 24)}`}
            className="group flex gap-2 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-900/[0.05] dark:bg-slate-800/50 dark:ring-white/[0.06]"
          >
            {values.length > 1 ? (
              <span className="mt-[1px] shrink-0 text-[10px] font-semibold tabular-nums text-slate-400">
                {index + 1}
              </span>
            ) : null}
            <p className="min-w-0 flex-1 whitespace-pre-wrap text-[12px] leading-relaxed text-slate-700 dark:text-slate-200">
              {value}
            </p>
            <CopyButton value={value} />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Media
 * ------------------------------------------------------------------ */

function Media({ asset, name }: { asset: CreativeAsset; name: string }) {
  if (asset.kind === "video" && asset.url) {
    return (
      <video
        controls
        playsInline
        poster={asset.thumbnail ? proxyMediaUrl(asset.thumbnail, { name, kind: "image" }) : undefined}
        src={proxyMediaUrl(asset.url, { name, kind: "video" })}
        className="w-full rounded-xl bg-slate-900"
      />
    );
  }

  const imageSrc = asset.url || asset.thumbnail;
  if (imageSrc) {
    return (
      <div className="relative">
        <img
          src={proxyMediaUrl(imageSrc, { name, kind: "image" })}
          alt={name}
          decoding="async"
          className="w-full rounded-xl bg-slate-100 object-contain dark:bg-slate-800"
        />
        {asset.kind === "video" ? (
          <span className="absolute left-2 top-2 rounded-lg bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-medium text-white">
            poster — source vidéo non fournie par Meta
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-40 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800">
      <ImageIcon className="h-5 w-5" />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Panel
 * ------------------------------------------------------------------ */

export function CreativePanel({
  adId,
  onOpenChange,
}: {
  adId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [creative, setCreative] = useState<CreativeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!adId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      setCreative(null);
      setIndex(0);
      try {
        const res = await fetch(`/api/meta/creatives?ids=${adId}`);
        const body = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || "Créa indisponible");
        const first = body.creatives?.[0] as CreativeDetail | undefined;
        if (!first) throw new Error(body.errors?.[0] || "Créa introuvable");
        setCreative(first);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Créa indisponible");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adId]);

  const copyAll = useCallback(() => {
    if (!creative) return;
    const parts = [
      creative.adName,
      "",
      ...(creative.bodies.length ? ["TEXTE PRINCIPAL", ...creative.bodies, ""] : []),
      ...(creative.titles.length ? ["TITRES", ...creative.titles, ""] : []),
      ...(creative.descriptions.length ? ["DESCRIPTIONS", ...creative.descriptions, ""] : []),
      ...(creative.link ? [`Lien : ${creative.link}`] : []),
      ...(creative.postId ? [`Post ID : ${creative.postId}`] : []),
    ];
    void copyText(parts.join("\n"), "Ad copy complet copié");
  }, [creative]);

  const asset = creative?.assets[index] || null;

  return (
    <Dialog open={Boolean(adId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] w-[calc(100vw-1.5rem)] max-w-4xl overflow-y-auto rounded-2xl border-slate-200 p-0 dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <div className="flex h-56 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : null}

        {error && !loading ? (
          <div className="p-6">
            <DialogTitle className="text-sm dark:text-slate-100">Créa indisponible</DialogTitle>
            <p className="mt-1 text-xs text-slate-500">{error}</p>
          </div>
        ) : null}

        {creative && !loading ? (
          <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-2">
              {asset ? <Media asset={asset} name={creative.adName} /> : null}

              {creative.assets.length > 1 ? (
                <div className="flex flex-wrap gap-1">
                  {creative.assets.map((item, position) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setIndex(position)}
                      className={cn(
                        "flex h-6 items-center gap-1 rounded-lg px-2 text-[10px] font-medium transition-colors",
                        position === index
                          ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400"
                      )}
                    >
                      {item.kind === "video" ? (
                        <Play className="h-2.5 w-2.5" />
                      ) : (
                        <ImageIcon className="h-2.5 w-2.5" />
                      )}
                      {position + 1}
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-1.5">
                {creative.assets.map((item, position) => {
                  const href = assetHref(item, `${creative.adName}${position ? `-${position + 1}` : ""}`);
                  if (!href) return null;
                  return (
                    <a
                      key={`dl-${item.id}`}
                      href={href}
                      className="inline-flex h-7 items-center gap-1.5 rounded-xl bg-slate-900 px-2.5 text-[11px] font-medium text-white transition-colors hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                    >
                      <Download className="h-3 w-3" />
                      {item.kind === "video" ? "Vidéo" : "Image"}
                      {creative.assets.length > 1 ? ` ${position + 1}` : ""}
                    </a>
                  );
                })}

                {creative.previewLink ? (
                  <a
                    href={creative.previewLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-7 items-center gap-1.5 rounded-xl bg-white px-2.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-900/[0.08] transition-colors hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-white/[0.08]"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Aperçu Meta
                  </a>
                ) : null}
              </div>

              {asset?.width ? (
                <p className="text-[10px] text-slate-400">
                  {asset.width} × {asset.height} px
                </p>
              ) : null}
            </div>

            <div className="min-w-0 space-y-3">
              <div className="pr-8">
                <DialogTitle className="truncate text-sm dark:text-slate-100">
                  {creative.adName}
                </DialogTitle>
                <p className="mt-0.5 truncate text-[11px] text-slate-400">
                  {creative.campaignName} › {creative.adsetName}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "rounded-lg px-1.5 py-0.5 text-[10px] font-medium",
                    creative.status === "ACTIVE"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                  )}
                >
                  {creative.status === "ACTIVE" ? "Active" : "En pause"}
                </span>
                {creative.callToAction ? (
                  <span className="rounded-lg bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {creative.callToAction.replaceAll("_", " ")}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={copyAll}
                  className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-xl bg-white px-2.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-900/[0.08] transition-colors hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-white/[0.08]"
                >
                  <Copy className="h-3 w-3" />
                  Tout copier
                </button>
              </div>

              <TextBlock label="Texte principal" values={creative.bodies} />
              <TextBlock label="Titres" values={creative.titles} />
              <TextBlock label="Descriptions" values={creative.descriptions} />

              <div>
                {creative.link ? <Field label="Lien" value={creative.link} href={creative.link} /> : null}
                {creative.postId ? (
                  <Field label="Post ID" value={creative.postId} href={creative.permalink} />
                ) : null}
                {creative.instagramPermalink ? (
                  <Field
                    label="Instagram"
                    value={creative.instagramPermalink}
                    href={creative.instagramPermalink}
                  />
                ) : null}
                {creative.urlTags ? <Field label="UTM" value={creative.urlTags} /> : null}
                <Field label="Ad ID" value={creative.adId} />
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
