"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Globe, Heart, MessageCircle, MoreHorizontal, Send, Bookmark, ThumbsUp, Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * L'aperçu d'une pub de l'uploader, comme dans le Gestionnaire Meta : un
 * panneau à droite avec un iPhone et la pub dans le fil Facebook, le fil
 * Instagram, les Stories et les Reels, avec ses textes (titre, texte
 * principal, description), son bouton et son lien. Les textes multiples
 * (« Flexible ») se parcourent variante par variante.
 */

export type PreviewItem = {
  key: string;
  label: string;
  /** Nom de la pub une fois créée. */
  name: string;
  url?: string;
  video?: boolean;
  postId?: string;
};

export type PreviewCopy = { headlines: string[]; bodies: string[]; descriptions: string[] };

type Placement = "fb-feed" | "ig-feed" | "ig-story" | "reels";

const PLACEMENTS: Array<{ id: Placement; label: string }> = [
  { id: "fb-feed", label: "Facebook · Fil" },
  { id: "ig-feed", label: "Instagram · Fil" },
  { id: "ig-story", label: "Stories" },
  { id: "reels", label: "Reels" },
];

const ctaLabel = (cta: string) => {
  const text = cta.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

function domainOf(websiteUrl: string, displayUrl: string) {
  if (displayUrl.trim()) return displayUrl.trim().replace(/^https?:\/\//, "");
  try {
    return new URL(websiteUrl).hostname.replace(/^www\./, "");
  } catch {
    return "votre-site.com";
  }
}

export function AdPreviewPanel({
  items,
  index,
  onIndex,
  onClose,
  copyFor,
  cta,
  websiteUrl,
  displayUrl,
  pageName,
  renderPost,
}: {
  items: PreviewItem[];
  index: number;
  onIndex: (next: number) => void;
  onClose: () => void;
  copyFor: (index: number) => PreviewCopy;
  cta: string;
  websiteUrl: string;
  displayUrl: string;
  pageName: string;
  renderPost: (postId: string) => React.ReactNode;
}) {
  const [placement, setPlacement] = useState<Placement>("fb-feed");
  const [variant, setVariant] = useState(0);
  const item = items[index];

  // Échap ferme, les flèches passent d'une pub à l'autre.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && index < items.length - 1) onIndex(index + 1);
      if (event.key === "ArrowLeft" && index > 0) onIndex(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onClose, onIndex]);

  if (!item) return null;
  const copy = copyFor(index);
  const variants = Math.max(1, copy.headlines.length, copy.bodies.length, copy.descriptions.length);
  const v = variant % variants;
  const pick = (list: string[]) => (list.length ? list[v % list.length] : "");
  const ad = {
    headline: pick(copy.headlines) || item.label.replace(/\.[^.]+$/, ""),
    body: pick(copy.bodies),
    description: pick(copy.descriptions),
    cta: ctaLabel(cta || "SHOP_NOW"),
    domain: domainOf(websiteUrl, displayUrl),
    pageName: pageName || "Votre Page",
    url: item.url,
    video: item.video,
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/40" onClick={onClose}>
      <aside className="flex h-full w-[min(480px,100vw)] flex-col bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Aperçu de la pub</p>
            <p className="truncate text-[14px] font-semibold text-slate-900" title={item.name}>
              {item.name}
            </p>
          </div>
          <span className="font-mono text-[11px] text-slate-400">
            {index + 1}/{items.length}
          </span>
          <button type="button" disabled={index === 0} onClick={() => onIndex(index - 1)} className="grid h-8 w-8 place-items-center rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-30" title="Pub précédente">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" disabled={index >= items.length - 1} onClick={() => onIndex(index + 1)} className="grid h-8 w-8 place-items-center rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-30" title="Pub suivante">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100" title="Fermer">
            <X className="h-4 w-4" />
          </button>
        </header>

        {item.postId ? (
          <div className="flex-1 overflow-y-auto p-4">
            <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
              Publication existante : la pub reprend son texte et son visuel tels quels. Aperçu fourni par Meta.
            </p>
            <div className="flex justify-center">{renderPost(item.postId)}</div>
          </div>
        ) : (
          <>
            <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-4 py-2">
              {PLACEMENTS.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setPlacement(row.id)}
                  className={cn(
                    "shrink-0 rounded-full px-3 py-1 text-[12px] font-medium",
                    placement === row.id ? "bg-[#1877F2] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {row.label}
                </button>
              ))}
            </div>
            {variants > 1 ? (
              <div className="flex items-center justify-center gap-2 border-b border-slate-100 py-1.5 text-[11px] text-slate-500">
                <button type="button" onClick={() => setVariant((n) => (n + variants - 1) % variants)} className="grid h-6 w-6 place-items-center rounded hover:bg-slate-100">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                Textes, variante {v + 1}/{variants}
                <button type="button" onClick={() => setVariant((n) => (n + 1) % variants)} className="grid h-6 w-6 place-items-center rounded hover:bg-slate-100">
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : null}
            <div className="flex flex-1 justify-center overflow-y-auto bg-slate-100 px-4 py-6">
              <Phone dark={placement === "ig-story" || placement === "reels"}>
                {placement === "fb-feed" ? <FacebookFeed ad={ad} /> : placement === "ig-feed" ? <InstagramFeed ad={ad} /> : <FullScreen ad={ad} reels={placement === "reels"} />}
              </Phone>
            </div>
            <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
              Aperçu indicatif : Meta peut recadrer le visuel ou couper le texte selon l&apos;emplacement.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}

type AdView = { headline: string; body: string; description: string; cta: string; domain: string; pageName: string; url?: string; video?: boolean };

function Phone({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div className="relative h-[640px] w-[316px] shrink-0 rounded-[46px] bg-slate-900 p-[10px] shadow-[0_20px_50px_rgba(15,23,42,0.35)]">
      <div className={cn("relative h-full w-full overflow-hidden rounded-[36px]", dark ? "bg-black" : "bg-white")}>
        <div className={cn("flex h-9 items-center justify-between px-6 text-[11px] font-semibold", dark ? "absolute inset-x-0 top-0 z-20 text-white" : "text-slate-900")}>
          <span>9:41</span>
          <span className="tracking-tighter">●●● ▮</span>
        </div>
        <div className="absolute left-1/2 top-2 z-30 h-6 w-24 -translate-x-1/2 rounded-full bg-black" />
        <div className={cn("overflow-y-auto", dark ? "h-full" : "h-[calc(100%-2.25rem)]")}>{children}</div>
      </div>
    </div>
  );
}

function Media({ ad, className }: { ad: AdView; className?: string }) {
  if (!ad.url) return <div className={cn("bg-slate-200", className)} />;
  return ad.video ? (
    <video src={ad.url} className={cn("object-cover", className)} autoPlay muted loop playsInline />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={ad.url} alt="" className={cn("object-cover", className)} />
  );
}

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-slate-900 font-bold uppercase text-white" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {name.charAt(0)}
    </span>
  );
}

/** Le texte principal coupé comme chez Meta, avec « Voir plus ». */
function Body({ text, lines = 3, className }: { text: string; lines?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > lines * 40 || text.split("\n").length > lines;
  return (
    <div className={className}>
      <p className={cn("whitespace-pre-line", !open && long && "line-clamp-3")}>{text}</p>
      {long && !open ? (
        <button type="button" onClick={() => setOpen(true)} className="font-semibold opacity-60">
          Voir plus
        </button>
      ) : null}
    </div>
  );
}

function FacebookFeed({ ad }: { ad: AdView }) {
  return (
    <div className="bg-white text-[12.5px] text-slate-900">
      <div className="flex items-center gap-2 px-3 py-2">
        <Avatar name={ad.pageName} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-semibold">{ad.pageName}</p>
          <p className="flex items-center gap-1 text-[11px] text-slate-500">
            Sponsorisé · <Globe className="h-3 w-3" />
          </p>
        </div>
        <MoreHorizontal className="h-4 w-4 text-slate-500" />
        <X className="h-4 w-4 text-slate-500" />
      </div>
      <Body text={ad.body} className="px-3 pb-2" />
      <Media ad={ad} className="aspect-square w-full" />
      <div className="flex items-center gap-2 bg-slate-100 px-3 py-2.5">
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[10.5px] uppercase text-slate-500">{ad.domain}</p>
          <p className="line-clamp-2 font-semibold">{ad.headline}</p>
          {ad.description ? <p className="truncate text-[11px] text-slate-500">{ad.description}</p> : null}
        </div>
        <span className="shrink-0 rounded-md bg-slate-200 px-3 py-1.5 text-[12px] font-semibold">{ad.cta}</span>
      </div>
      <div className="flex justify-around border-t border-slate-100 py-2 text-[11.5px] font-medium text-slate-500">
        <span className="flex items-center gap-1">
          <ThumbsUp className="h-3.5 w-3.5" /> J&apos;aime
        </span>
        <span className="flex items-center gap-1">
          <MessageCircle className="h-3.5 w-3.5" /> Commenter
        </span>
        <span className="flex items-center gap-1">
          <Share2 className="h-3.5 w-3.5" /> Partager
        </span>
      </div>
    </div>
  );
}

function InstagramFeed({ ad }: { ad: AdView }) {
  const handle = ad.pageName.toLowerCase().replace(/\s+/g, "");
  return (
    <div className="bg-white text-[12.5px] text-slate-900">
      <div className="flex items-center gap-2 px-3 py-2">
        <Avatar name={ad.pageName} size={28} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-semibold">{handle}</p>
          <p className="text-[10.5px] text-slate-500">Sponsorisé</p>
        </div>
        <MoreHorizontal className="h-4 w-4" />
      </div>
      <Media ad={ad} className="aspect-[4/5] w-full" />
      <div className="flex items-center justify-between bg-[#3797f0] px-3 py-2 text-[12.5px] font-semibold text-white">
        {ad.cta}
        <ChevronRight className="h-4 w-4" />
      </div>
      <div className="flex items-center gap-3 px-3 pt-2">
        <Heart className="h-5 w-5" />
        <MessageCircle className="h-5 w-5" />
        <Send className="h-5 w-5" />
        <Bookmark className="ml-auto h-5 w-5" />
      </div>
      <div className="px-3 pb-3 pt-1.5">
        <p className="font-semibold">{ad.headline}</p>
        {ad.body ? (
          <Body text={`${handle} ${ad.body}`} className="mt-0.5" />
        ) : null}
      </div>
    </div>
  );
}

function FullScreen({ ad, reels }: { ad: AdView; reels: boolean }) {
  const handle = ad.pageName.toLowerCase().replace(/\s+/g, "");
  return (
    <div className="relative h-full w-full text-white">
      <Media ad={ad} className="absolute inset-0 h-full w-full" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70" />
      {!reels ? (
        <div className="absolute inset-x-3 top-10 z-10">
          <div className="h-0.5 rounded-full bg-white/40">
            <div className="h-full w-1/3 rounded-full bg-white" />
          </div>
        </div>
      ) : null}
      <div className={cn("absolute inset-x-3 z-10 flex items-center gap-2", reels ? "top-11" : "top-[52px]")}>
        {reels ? <p className="text-[15px] font-bold">Reels</p> : null}
        {!reels ? (
          <>
            <Avatar name={ad.pageName} size={26} />
            <p className="text-[12px] font-semibold">{handle}</p>
            <p className="text-[11px] opacity-80">Sponsorisé</p>
          </>
        ) : null}
      </div>
      <div className="absolute inset-x-3 bottom-5 z-10 space-y-2">
        {reels ? (
          <div className="flex items-center gap-2">
            <Avatar name={ad.pageName} size={26} />
            <p className="text-[12px] font-semibold">{handle}</p>
            <p className="text-[11px] opacity-80">· Sponsorisé</p>
          </div>
        ) : null}
        {ad.body ? <p className="line-clamp-2 text-[12px] leading-snug drop-shadow">{ad.body}</p> : null}
        <div className={cn("flex items-center justify-center gap-1 rounded-full py-2 text-[13px] font-semibold", reels ? "bg-white/25 backdrop-blur" : "bg-white text-slate-900")}>
          {ad.cta}
          <ChevronRight className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}
