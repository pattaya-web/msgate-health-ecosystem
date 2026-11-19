"use client";

/**
 * Le dessin des textes et des emojis, pour l'export.
 *
 * Chaque élément devient une image PNG transparente de la taille de la vidéo,
 * que le serveur incruste pendant sa fenêtre de temps. Le navigateur dessine
 * avec la vraie police TikTok et les vrais emojis iPhone : rien à installer
 * sur le serveur, et le fichier final ressemble exactement à l'aperçu.
 */

import { tiktokFamily } from "@/lib/studio/compose-video";
import { appleEmoji, appleEmojiFallback, emojiUnified, textParts, type MontageOverlay } from "@/lib/montage/timeline";

const images = new Map<string, Promise<HTMLImageElement | null>>();

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** Le PNG Apple d'un emoji (avec ou sans FE0F selon le fichier disponible). */
export function emojiImage(unified: string): Promise<HTMLImageElement | null> {
  let hit = images.get(unified);
  if (!hit) {
    hit = loadImage(appleEmoji(unified)).then((img) => img ?? loadImage(appleEmojiFallback(unified)));
    images.set(unified, hit);
  }
  return hit;
}

/** Hauteur de ligne du texte, en multiples de la taille de police. */
const LINE = 1.18;

/** Coupe le texte en lignes (retours à la ligne saisis + largeur maximale). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, emojiWidth: number) {
  const measure = (value: string) =>
    textParts(value).reduce((sum, part) => sum + (part.emoji ? emojiWidth : ctx.measureText(part.value).width), 0);
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return { lines, measure };
}

/**
 * Dessine un élément sur un canvas de la taille de la vidéo.
 * `scale` = largeur de la vidéo / 1080 (les tailles sont saisies pour 1080).
 */
export async function drawOverlay(ctx: CanvasRenderingContext2D, item: MontageOverlay, width: number, height: number) {
  const scale = width / 1080;
  const cx = (item.x / 100) * width;
  const cy = (item.y / 100) * height;

  if (item.kind === "emoji") {
    const size = item.size * scale;
    const img = await emojiImage(item.unified);
    if (img) ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    return;
  }

  const size = item.size * scale;
  const family = tiktokFamily();
  await document.fonts.load(`800 ${Math.round(size)}px ${family}`).catch(() => undefined);
  ctx.font = `800 ${size}px ${family}`;
  ctx.textBaseline = "middle";
  const emojiSize = size * 1.05;
  const { lines, measure } = wrap(ctx, item.text, width * 0.86, emojiSize);
  const lineHeight = size * LINE;
  const top = cy - (lines.length * lineHeight) / 2 + lineHeight / 2;

  // Le fond « box » : un bloc arrondi par ligne, comme les textes TikTok.
  if (item.style === "box") {
    lines.forEach((line, index) => {
      const w = measure(line) + size * 0.7;
      const h = lineHeight * 1.02;
      const x = cx - w / 2;
      const y = top + index * lineHeight - h / 2;
      const r = Math.min(h / 3, 18 * scale);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      ctx.fillStyle = item.color.toLowerCase() === "#ffffff" ? "rgba(0,0,0,0.88)" : "#ffffff";
      ctx.fill();
    });
  }

  for (const [index, line] of lines.entries()) {
    const y = top + index * lineHeight;
    let x = cx - measure(line) / 2;
    for (const part of textParts(line)) {
      if (part.emoji) {
        const img = await emojiImage(emojiUnified(part.value));
        if (img) ctx.drawImage(img, x, y - emojiSize / 2, emojiSize, emojiSize);
        x += emojiSize;
        continue;
      }
      ctx.textAlign = "left";
      if (item.style === "tiktok") {
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(2, size * 0.16);
        ctx.strokeStyle = item.color.toLowerCase() === "#000000" ? "#ffffff" : "#000000";
        ctx.strokeText(part.value, x, y);
      }
      ctx.fillStyle = item.color;
      ctx.fillText(part.value, x, y);
      x += ctx.measureText(part.value).width;
    }
  }
}

/** L'image PNG (data URL) d'un élément, à la taille de la vidéo. */
export async function renderOverlayPng(item: MontageOverlay, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible");
  await drawOverlay(ctx, item, width, height);
  return canvas.toDataURL("image/png");
}
