/**
 * Pile de polices réellement chargée pour les sous-titres. `--font-tiktok` est
 * posée par next/font sur <html> ; en repli on garde une grotesque système
 * plutôt que le `sans-serif` générique, qui donnait le rendu « horrible ».
 */
export function tiktokFamily() {
  const fallback = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-tiktok")
    .trim();
  return value ? `${value}, ${fallback}` : fallback;
}

export type CaptionPreset = "tiktok" | "boxed" | "pop" | "minimal";

export type OverlayStyle = {
  align: "left" | "center" | "right";
  size: number;
  /** Position du centre du bloc, en % de la hauteur. */
  y: number;
  /** Position du centre du bloc, en % de la largeur. Défaut : centré. */
  x?: number;
  fill: string;
  stroke: string;
  /** Épaisseur du contour, en % de la taille du texte. 25 = rendu TikTok. */
  strokeWidth?: number;
};

export type CaptionStyle = {
  preset: CaptionPreset;
  fill: string;
  stroke: string;
  highlight: string;
  y?: number;
  size?: number;
  align?: "left" | "center" | "right";
  /** Mots affichés par sous-titre. 1 donne un rendu karaoké mot à mot. */
  words?: number;
  /** Épaisseur du contour, en % de la taille du texte. */
  strokeWidth?: number;
};

export type ComposeInput = {
  clips: File[];
  mode?: "overlay" | "montage";
  captions?: boolean;
  voiceBlob?: Blob | null;
  script: string;
  overlayText: string;
  overlay?: OverlayStyle;
  emojiUrls: string[];
  watermark?: "none" | "tiktok" | "ig";
  caption: CaptionStyle;
  seed: number;
  onProgress?: (p: number, label: string) => void;
  /**
   * Mesures du rendu, remontées pour diagnostic. Une vidéo trop courte à
   * l'arrivée vient forcément d'un de ces trois nombres : la durée lue sur les
   * clips, la durée visée, ou le temps réellement écoulé pendant la capture.
   */
  onMeta?: (info: { clipSeconds: number[]; target: number; recorded: number }) => void;
};

const W = 1080;
const H = 1920;
const FPS = 30;

/**
 * Un fichier sorti d'un enregistreur (MediaRecorder, écran, beaucoup de vidéos
 * TikTok réencodées) annonce souvent `duration = Infinity` à `loadedmetadata`,
 * parce que le conteneur n'a pas d'index. On force alors un saut très loin :
 * le lecteur recale `duration` sur la vraie fin, puis on revient à zéro.
 */
function realDuration(el: HTMLVideoElement) {
  return new Promise<number>((resolve) => {
    if (Number.isFinite(el.duration) && el.duration > 0) {
      resolve(el.duration);
      return;
    }
    const done = (value: number) => {
      el.ontimeupdate = null;
      el.currentTime = 0;
      resolve(value);
    };
    // Filet de sécurité : si le lecteur ne recale rien, on ne bloque pas.
    const timer = window.setTimeout(() => done(0), 3000);
    el.ontimeupdate = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        window.clearTimeout(timer);
        done(el.duration);
      }
    };
    el.currentTime = 1e6;
  });
}

function loadVideo(file: File) {
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const el = document.createElement("video");
    el.muted = true;
    el.playsInline = true;
    el.preload = "auto";
    el.src = URL.createObjectURL(file);
    el.onloadedmetadata = () => {
      void realDuration(el).then(() => resolve(el));
    };
    el.onerror = () => reject(new Error(`Vidéo illisible: ${file.name}`));
  });
}

/** Durée exploitable d'un clip, quoi qu'annonce le conteneur. */
function clipSeconds(el: HTMLVideoElement) {
  return Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Emoji iPhone indisponible"));
    img.src = url;
  });
}

function coverDraw(ctx: CanvasRenderingContext2D, video: HTMLVideoElement) {
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const scale = Math.max(W / vw, H / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function blurZone(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  try {
    const sample = ctx.getImageData(x, y, w, h);
    ctx.save();
    ctx.filter = "blur(18px)";
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    tmp.getContext("2d")?.putImageData(sample, 0, 0);
    ctx.drawImage(tmp, x, y, w, h);
    ctx.restore();
  } catch {
    ctx.fillStyle = "rgba(10,10,12,0.55)";
    ctx.fillRect(x, y, w, h);
  }
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && cur) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

/** `wordsPerLine` pilote la densité du sous-titre : 1 mot = style karaoké. */
export function captionWindow(script: string, t: number, duration: number, wordsPerLine = 4) {
  const words = script.trim().split(/\s+/).filter(Boolean);
  if (!words.length || duration <= 0) return { line: [] as string[], active: -1 };
  const idx = Math.min(words.length - 1, Math.floor((t / duration) * words.length));
  const size = Math.min(8, Math.max(1, Math.round(wordsPerLine)));
  const start = Math.floor(idx / size) * size;
  const line = words.slice(start, start + size);
  return { line, active: idx - start };
}

function drawRounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Le MP4 natif passe en premier : quand le navigateur sait l'enregistrer, on
 * évite complètement le réencodage serveur. Sinon on retombe sur le WebM, qui
 * sera converti après coup.
 */
function pickMime() {
  const types = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4;codecs=h264,aac",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "video/webm";
}

/**
 * Dessin du bloc texte + emoji. Partagé par l'incrustation ffmpeg et l'ancien
 * assemblage canvas, pour qu'un seul code décide de la position et du style.
 */
function drawOverlayBlock(
  ctx: CanvasRenderingContext2D,
  font: string,
  text: string,
  overlay: OverlayStyle | undefined,
  emojis: HTMLImageElement[]
) {
  if (!text.trim() && !emojis.length) return;

  const style =
    overlay || { align: "center" as const, size: 64, y: 16, fill: "#ffffff", stroke: "#000000" };
  const size = Math.max(24, style.size || 64);
  ctx.font = `700 ${size}px ${font}`;
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.textAlign = "left";

  const emojiSize = Math.round(size * 0.95);
  const emojiGap = Math.round(size * 0.12);
  const emojiRun = emojis.length
    ? emojis.length * emojiSize + (emojis.length - 1) * emojiGap + emojiGap
    : 0;

  const centerX = ((style.x ?? 50) / 100) * W;
  const maxW = 940;
  const lines = text.trim() ? wrap(ctx, text, maxW) : [];
  const lineH = size + 14;

  // Le bloc est centré verticalement sur y : c'est ce que montre la preview,
  // où l'on saisit le texte par son milieu.
  const blockH = Math.max(lines.length, 1) * lineH;
  const top = ((style.y ?? 16) / 100) * H - blockH / 2 + size;

  lines.forEach((line, i) => {
    const isLast = i === lines.length - 1;
    const textW = ctx.measureText(line).width;
    const rowW = textW + (isLast ? emojiRun : 0);
    const startX =
      style.align === "left"
        ? centerX - maxW / 2
        : style.align === "right"
          ? centerX + maxW / 2 - rowW
          : centerX - rowW / 2;
    const y = top + i * lineH;

    ctx.lineWidth = Math.max(0, Math.round((size * (style.strokeWidth ?? 25)) / 100));
    ctx.strokeStyle = style.stroke || "#000";
    ctx.strokeText(line, startX, y);
    ctx.fillStyle = style.fill || "#fff";
    ctx.fillText(line, startX, y);

    if (isLast && emojis.length) {
      let ex = startX + textW + emojiGap;
      emojis.forEach((img) => {
        ctx.drawImage(img, ex, y - emojiSize * 0.82, emojiSize, emojiSize);
        ex += emojiSize + emojiGap;
      });
    }
  });

  // Aucun texte : les emoji seuls restent centrés sur l'ancre.
  if (!lines.length && emojis.length) {
    let ex = centerX - (emojiRun - emojiGap) / 2;
    const y = ((style.y ?? 16) / 100) * H;
    emojis.forEach((img) => {
      ctx.drawImage(img, ex, y - emojiSize / 2, emojiSize, emojiSize);
      ex += emojiSize + emojiGap;
    });
  }
}

/**
 * Rend le calque texte seul, sur fond transparent, en 1080×1920.
 *
 * C'est la pièce qui remplace le réenregistrement image par image : au lieu de
 * rejouer la vidéo dans un canvas en temps réel — d'où les saccades, les images
 * figées et la perte de qualité — on produit UNE image, et ffmpeg l'incruste sur
 * la vidéo d'origine sans y toucher. Le texte est dessiné par le navigateur,
 * donc avec la vraie police et exactement le rendu de la preview.
 */
export async function renderOverlayPng(input: {
  overlayText: string;
  overlay: OverlayStyle;
  emojiUrls: string[];
}): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible");

  const captionFont = tiktokFamily();
  await Promise.all([
    document.fonts.load(`700 72px ${captionFont}`).catch(() => undefined),
    document.fonts.load(`600 72px ${captionFont}`).catch(() => undefined),
  ]);

  const emojis = (
    await Promise.all(
      input.emojiUrls.map(async (url) => {
        try {
          return await loadImage(url);
        } catch {
          return null;
        }
      })
    )
  ).filter(Boolean) as HTMLImageElement[];

  drawOverlayBlock(ctx, captionFont, input.overlayText, input.overlay, emojis);
  return canvas.toDataURL("image/png");
}

export async function composeVerticalCreative(input: ComposeInput): Promise<Blob> {
  if (!input.clips.length) throw new Error("Ajoute au moins une vidéo");
  input.onProgress?.(2, "Chargement clips");
  const videos = await Promise.all(input.clips.map(loadVideo));
  const emojis = (
    await Promise.all(
      input.emojiUrls.map(async (url) => {
        try {
          return await loadImage(url);
        } catch {
          return null;
        }
      })
    )
  ).filter(Boolean) as HTMLImageElement[];

  const audioCtx = new AudioContext();
  let voiceBuffer: AudioBuffer | null = null;
  if (input.voiceBlob) {
    voiceBuffer = await audioCtx.decodeAudioData(await input.voiceBlob.arrayBuffer());
  }
  const clipDur = videos.reduce((total, video) => total + clipSeconds(video), 0);
  const mode = input.mode || "montage";
  const duration =
    mode === "overlay"
      ? Math.max(1, clipDur || 4)
      : Math.max(clipDur || 1, voiceBuffer?.duration || clipDur || 1);

  type Cut = { t0: number; t1: number; clip: number; start: number };
  const cuts: Cut[] = [];
  if (mode === "overlay") {
    let t = 0;
    videos.forEach((video, i) => {
      const len = Math.min(clipSeconds(video) || 4, Math.max(0.2, duration - t));
      if (len <= 0.05) return;
      cuts.push({ t0: t, t1: t + len, clip: i, start: 0 });
      t += len;
    });
  } else {
    let t = 0;
    videos.forEach((video, i) => {
      const len = Math.max(0.2, clipSeconds(video) || 4);
      cuts.push({ t0: t, t1: t + len, clip: i, start: 0 });
      t += len;
    });
    const target = Math.max(t, voiceBuffer?.duration || t);
    if (t > 0 && target > t + 0.05) {
      let extra = t;
      let n = 0;
      while (extra < target - 0.05) {
        const clip = n % videos.length;
        const vd = clipSeconds(videos[clip]) || 4;
        const len = Math.min(vd, target - extra);
        cuts.push({ t0: extra, t1: extra + len, clip, start: 0 });
        extra += len;
        n += 1;
      }
    }
  }
  if (!cuts.length) throw new Error("Aucun clip à assembler");

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponible");

  const dest = audioCtx.createMediaStreamDestination();
  let voiceSource: AudioBufferSourceNode | null = null;
  if (voiceBuffer) {
    voiceSource = audioCtx.createBufferSource();
    voiceSource.buffer = voiceBuffer;
    voiceSource.connect(dest);
    voiceSource.connect(audioCtx.destination);
  }

  const stream = canvas.captureStream(FPS);

  /**
   * La piste audio n'est ajoutée QUE si une source l'alimente vraiment.
   *
   * Sans voix-off, rien n'est connecté au `MediaStreamAudioDestinationNode` :
   * la piste existe mais ne produit aucun échantillon. Le multiplexeur se cale
   * alors sur cette piste morte et clôt le fichier au bout d'une seconde, alors
   * que la capture vidéo, elle, a bien tourné jusqu'au bout.
   */
  if (voiceBuffer) {
    const audioTrack = dest.stream.getAudioTracks()[0];
    if (audioTrack) stream.addTrack(audioTrack);
  }

  const chunks: BlobPart[] = [];
  const rec = new MediaRecorder(stream, { mimeType: pickMime(), videoBitsPerSecond: 8_000_000 });
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
  });

  // next/font publie la police sous un nom de famille hashé : le littéral
  // « TikTok Sans » ne résout pas dans un canvas. On lit la vraie pile depuis
  // la variable CSS, puis on attend son chargement avant de dessiner — sinon la
  // première frame est composée avec la police de repli.
  const captionFont = tiktokFamily();
  await Promise.all([
    document.fonts.load(`700 72px ${captionFont}`).catch(() => undefined),
    document.fonts.load(`600 72px ${captionFont}`).catch(() => undefined),
  ]);
  await Promise.all(
    videos.map(async (video) => {
      try {
        await video.play();
        video.pause();
      } catch {
        // autoplay policies — still seekable
      }
    })
  );
  await audioCtx.resume();
  // Sans découpage temporel : un blob unique produit à l'arrêt porte une durée
  // fiable, là où des fragments de 200 ms la laissent souvent incomplète. On ne
  // diffuse rien en direct, le découpage n'apportait donc rien.
  rec.start();
  voiceSource?.start();
  /**
   * Horloge murale plutôt que `audioCtx.currentTime` : sans voix-off, aucune
   * source n'alimente le contexte audio, et un contexte suspendu par la
   * politique d'autoplay fige son temps — le rendu s'arrêtait alors bien avant
   * la fin du clip. `performance.now()` avance toujours.
   */
  const t0 = performance.now();
  input.onProgress?.(8, "Assemblage");

  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      try {
        const now = Math.min(duration, (performance.now() - t0) / 1000);
        const cut = cuts.find((c) => now >= c.t0 && now < c.t1) || cuts[cuts.length - 1];
        const video = videos[cut.clip];
        const local = cut.start + (now - cut.t0);
        if (Math.abs((video.currentTime || 0) - local) > 0.12) {
          video.currentTime = Math.min(Math.max(0, local), Math.max(0.05, clipSeconds(video) - 0.05));
        }
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
        coverDraw(ctx, video);

        if (input.watermark === "tiktok") {
          blurZone(ctx, 36, 1760, 320, 90);
          blurZone(ctx, 760, 64, 280, 70);
        } else if (input.watermark === "ig") {
          blurZone(ctx, 40, 1780, 1000, 80);
        }

        /**
         * Texte et emoji forment un seul bloc, ancré sur (x, y) exprimés en % —
         * ce sont les coordonnées que la preview manipule à la souris. Les
         * emoji se posent EN LIGNE, à la suite de la dernière ligne de texte.
         */
        drawOverlayBlock(ctx, captionFont, input.overlayText, input.overlay, emojis);

        if (input.captions && input.script.trim()) {
          const { line, active } = captionWindow(input.script, now, duration, input.caption.words);
          if (line.length) {
            // Le bloc reste dessiné centré sur son ancre ; c'est l'ancre qui se
            // déplace selon l'alignement choisi.
            ctx.textAlign = "center";
            const capAlign = input.caption.align || "center";
            const capAnchor = capAlign === "left" ? 300 : capAlign === "right" ? W - 300 : W / 2;
            const capSize = input.caption.size || 56;
            ctx.font = `700 ${capSize}px ${captionFont}`;
            ctx.lineJoin = "round";
            const joined = line.join(" ");
            const y = ((input.caption.y ?? 79) / 100) * H;
            if (input.caption.preset === "boxed" || input.caption.preset === "pop") {
              const pad = 22;
              const width = Math.min(980, ctx.measureText(joined).width + pad * 2);
              const x = capAnchor - width / 2;
              drawRounded(ctx, x, y - 58, width, 84, 16);
              ctx.fillStyle = input.caption.preset === "pop" ? input.caption.highlight : "rgba(0,0,0,0.72)";
              ctx.fill();
              ctx.fillStyle = input.caption.fill;
              ctx.fillText(joined, capAnchor, y);
            } else if (input.caption.preset === "minimal") {
              ctx.fillStyle = input.caption.fill;
              ctx.fillText(joined, capAnchor, y);
            } else {
              let x = W / 2;
              const total = ctx.measureText(joined).width;
              x = W / 2 - total / 2;
              line.forEach((word, i) => {
                const w = ctx.measureText(word).width;
                ctx.lineWidth = Math.max(
                  0,
                  Math.round((capSize * (input.caption.strokeWidth ?? 25)) / 100)
                );
                ctx.strokeStyle = input.caption.stroke;
                ctx.strokeText(word, x + w / 2, y);
                ctx.fillStyle = i === active ? input.caption.highlight : input.caption.fill;
                ctx.fillText(word, x + w / 2, y);
                x += w + ctx.measureText(" ").width;
              });
            }
          }
        }

        input.onProgress?.(8 + Math.round((now / duration) * 90), mode === "overlay" ? "Texte" : "Cut auto");
        if (now >= duration - 1 / FPS) {
          rec.stop();
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      } catch (error) {
        reject(error);
      }
    };
    requestAnimationFrame(tick);
  });

  await stopped;
  input.onMeta?.({
    clipSeconds: videos.map((video) => Number(clipSeconds(video).toFixed(2))),
    target: Number(duration.toFixed(2)),
    recorded: Number(((performance.now() - t0) / 1000).toFixed(2)),
  });
  videos.forEach((v) => URL.revokeObjectURL(v.src));
  await audioCtx.close().catch(() => undefined);
  input.onProgress?.(100, "Prêt");
  return new Blob(chunks, { type: rec.mimeType || "video/webm" });
}
