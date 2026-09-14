/**
 * Images jointes au composer : lues dans le navigateur, réduites (bord max
 * 1600 px) et encodées en data URL avant l'envoi. Rien n'est stocké côté CRM :
 * l'image traverse la requête puis part chez Hermes inline. Une vignette
 * 96 px sert à l'aperçu et à l'historique local.
 */

export type LoadedImage = { id: string; name: string; dataUrl: string; thumb: string; width: number; height: number };

const MAX_EDGE = 1600;
const THUMB_EDGE = 96;
const ACCEPTED = /^image\/(png|jpeg|webp|gif)$/;

export function isImageFile(file: File) {
  return ACCEPTED.test(file.type);
}

export function imageFilesFrom(transfer: DataTransfer | null | undefined): File[] {
  if (!transfer) return [];
  const files: File[] = [];
  if (transfer.items?.length) {
    for (const item of Array.from(transfer.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file && isImageFile(file)) files.push(file);
    }
  }
  if (!files.length && transfer.files?.length) {
    for (const file of Array.from(transfer.files)) if (isImageFile(file)) files.push(file);
  }
  return files;
}

function loadBitmap(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image illisible"));
    };
    image.src = url;
  });
}

function draw(image: HTMLImageElement, maxEdge: number, type: string, quality: number) {
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas indisponible");
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(image, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL(type, quality), width, height };
}

export async function loadImageFile(file: File): Promise<LoadedImage> {
  const image = await loadBitmap(file);
  // PNG gardé tel quel s'il reste raisonnable (transparence, aplats de texte) ; sinon JPEG.
  let main = file.type === "image/png" ? draw(image, MAX_EDGE, "image/png", 1) : draw(image, MAX_EDGE, "image/jpeg", 0.88);
  if (main.dataUrl.length > 2_500_000) main = draw(image, MAX_EDGE, "image/jpeg", 0.8);
  if (main.dataUrl.length > 2_500_000) main = draw(image, 1200, "image/jpeg", 0.75);
  const thumb = draw(image, THUMB_EDGE, "image/jpeg", 0.7);
  const name = (file.name || "image").slice(0, 120);
  return { id: `img-${Math.random().toString(36).slice(2, 10)}`, name, dataUrl: main.dataUrl, thumb: thumb.dataUrl, width: main.width, height: main.height };
}

/** Vignette d'une image déjà servie par le CRM (créa du moteur), pour l'historique local. */
export async function thumbFromUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) return null;
    const blob = await response.blob();
    const file = new File([blob], "creative.png", { type: blob.type || "image/png" });
    if (!isImageFile(file)) return null;
    const image = await loadBitmap(file);
    return draw(image, THUMB_EDGE, "image/jpeg", 0.7).dataUrl;
  } catch {
    return null;
  }
}
