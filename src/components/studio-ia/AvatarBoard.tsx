"use client";

import { useState } from "react";
import { Modal, useToast } from "@/components/studio-ia/ui";

export type AvatarPhoto = { label: string; src: string };

function fileName(src: string) {
  return src.split("/").pop() ?? "avatar.png";
}

/**
 * Les photos de l'avatar du shop, toujours sous la main en haut du Studio IA :
 * « Utiliser » la met en photo de référence du formulaire en un clic,
 * « Copier » la place dans le presse-papiers (Ctrl+V dans un champ photo),
 * « Télécharger » enregistre le fichier d'origine, et un clic l'agrandit.
 */
export function AvatarBoard({
  avatars,
  onUse,
}: {
  avatars: AvatarPhoto[];
  onUse: (src: string, name: string) => Promise<void>;
}) {
  const toast = useToast();
  const [zoom, setZoom] = useState<AvatarPhoto | null>(null);
  const [using, setUsing] = useState<string | null>(null);

  const copy = async (photo: AvatarPhoto) => {
    try {
      if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("unsupported");
      // Promesse passée telle quelle : Safari exige que l'écriture parte du clic lui-même.
      const blob = fetch(photo.src).then((r) => r.blob()).then((b) => new Blob([b], { type: "image/png" }));
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("Photo copiée : colle-la avec Ctrl+V dans un champ photo.");
    } catch {
      toast("Copie impossible sur ce navigateur : utilise « Utiliser » ou « Télécharger ».", "err");
    }
  };

  const use = async (photo: AvatarPhoto) => {
    setUsing(photo.src);
    try {
      await onUse(photo.src, fileName(photo.src));
    } finally {
      setUsing(null);
    }
  };

  return (
    <div className="card p-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
        <div className="font-semibold text-sm">Notre avatar</div>
        <div className="text-xs opacity-70">
          « Utiliser » la met en photo de référence, puis écris ton prompt et lance.
        </div>
      </div>
      <div className="flex gap-3 flex-wrap">
        {avatars.map((photo) => (
          <div key={photo.src} className="flex flex-col gap-2" style={{ width: "min(100%, 260px)" }}>
            <button
              type="button"
              onClick={() => setZoom(photo)}
              title="Agrandir"
              className="block overflow-hidden rounded-lg border"
              style={{ height: 150, background: "var(--surface-2, #f4f4f5)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.src} alt={`Avatar Moosha — ${photo.label}`} className="w-full h-full object-cover" />
            </button>
            <div className="text-xs font-medium">{photo.label}</div>
            <div className="flex gap-1 flex-wrap">
              <button className="btn btn-sm btn-primary" disabled={using !== null} onClick={() => void use(photo)}>
                {using === photo.src ? <span className="spinner" /> : "＋"} Utiliser
              </button>
              <button className="btn btn-sm" onClick={() => void copy(photo)}>
                Copier
              </button>
              <a className="btn btn-sm" href={photo.src} download={fileName(photo.src)}>
                Télécharger
              </a>
            </div>
          </div>
        ))}
      </div>

      <Modal open={zoom !== null} onClose={() => setZoom(null)} title={zoom ? `Avatar — ${zoom.label}` : ""} wide>
        {zoom && (
          <div className="flex flex-col gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={zoom.src} alt={`Avatar Moosha — ${zoom.label}`} className="w-full h-auto rounded-lg" />
            <div className="flex gap-2 flex-wrap">
              <button
                className="btn btn-primary"
                disabled={using !== null}
                onClick={() => void use(zoom).then(() => setZoom(null))}
              >
                ＋ Utiliser comme référence
              </button>
              <button className="btn" onClick={() => void copy(zoom)}>Copier</button>
              <a className="btn" href={zoom.src} download={fileName(zoom.src)}>Télécharger</a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
