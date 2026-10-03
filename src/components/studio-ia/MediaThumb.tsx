"use client";

/* eslint-disable @next/next/no-img-element */

import { useState } from "react";

/**
 * Vignettes legeres pour les galeries.
 *
 * Un media stocke chez nous (/api/media/...) a une vignette JPEG servie par
 * `?poster=1` : une image de 20-40 Ko au lieu d'une lecture partielle du mp4
 * ou d'un PNG de 3 Mo. Un media distant (CDN d'un fournisseur) n'en a pas :
 * on retombe sur l'element d'origine.
 */

export const isLocalMedia = (url: string) => url.startsWith("/api/media/");

/**
 * URL de la vignette : `?poster=1` pour un media stocke chez nous,
 * `/api/thumb?url=` pour un resultat sur le CDN d'un fournisseur (le serveur
 * n'accepte que ses hotes), l'URL intacte pour tout le reste (blob local,
 * data URL, lien quelconque).
 */
export function thumbUrl(url: string, width?: 240 | 360 | 480): string {
  const w = width ? `&w=${width}` : "";
  if (isLocalMedia(url)) return `${url}?poster=1${w}`;
  if (/^https:\/\//.test(url)) return `/api/thumb?url=${encodeURIComponent(url)}${w}`;
  return url;
}

/**
 * Deux tailles pour les tuiles : 240 px suffit a une colonne de telephone,
 * 360 px aux tuiles de bureau. Le navigateur choisit selon `sizes`.
 */
function srcSetFor(url: string): { srcSet?: string; sizes?: string } {
  if (thumbUrl(url) === url) return {};
  return {
    srcSet: `${thumbUrl(url, 240)} 240w, ${thumbUrl(url, 360)} 360w`,
    // 30vw sur telephone : trois tuiles par ligne, 240 px suffisent meme en ecran retina.
    sizes: "(max-width: 640px) 30vw, 200px",
  };
}

/**
 * Image de vignette avec repli : si le serveur ne sait pas la produire
 * (hote inconnu, ffmpeg en echec), on affiche le media d'origine.
 */
export function ThumbImg({
  src,
  className = "w-full h-full object-cover",
  style,
  alt = "",
}: {
  src: string;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = failed ? src : thumbUrl(src);
  return (
    <img
      src={url}
      {...(failed ? {} : srcSetFor(src))}
      alt={alt}
      className={className}
      style={style}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => { if (!failed && url !== src) setFailed(true); }}
    />
  );
}

/**
 * Apercu fixe d'une video (image extraite) ; la video elle-meme n'est
 * chargee que si la vignette manque (fichier distant, ffmpeg en echec).
 */
export function VideoThumb({
  src,
  className = "w-full h-full object-cover",
  style,
}: {
  src: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  // Pas de vignette possible (fichier en cours d'envoi, hote inconnu) : la video elle-meme.
  if (failed || thumbUrl(src) === src) {
    return <video src={src} muted playsInline preload="metadata" className={className} style={style} />;
  }
  return (
    <img
      src={thumbUrl(src)}
      {...srcSetFor(src)}
      alt=""
      className={className}
      style={style}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
