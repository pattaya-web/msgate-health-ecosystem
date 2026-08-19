export type CaptionPreset = "tiktok" | "boxed" | "pop" | "minimal";

export type OverlayStyle = {
  align: "left" | "center" | "right";
  size: number;
  y: number;
  fill: string;
  stroke: string;
};

export type CaptionStyle = {
  preset: CaptionPreset;
  fill: string;
  stroke: string;
  highlight: string;
  y?: number;
  size?: number;
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
};

const W = 1080;
const H = 1920;
const FPS = 30;

function loadVideo(file: File) {
  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const el = document.createElement("video");
    el.muted = true;
    el.playsInline = true;
    el.preload = "auto";
    el.src = URL.createObjectURL(file);
    el.onloadedmetadata = () => resolve(el);
    el.onerror = () => reject(new Error(`Vidéo illisible: ${file.name}`));
  });
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

export function captionWindow(script: string, t: number, duration: number) {
  const words = script.trim().split(/\s+/).filter(Boolean);
  if (!words.length || duration <= 0) return { line: [] as string[], active: -1 };
  const idx = Math.min(words.length - 1, Math.floor((t / duration) * words.length));
  const size = 4;
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

function pickMime() {
  const types = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "video/webm";
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
  const clipDur = videos.reduce((s, v) => s + (v.duration || 0), 0);
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
      const len = Math.min(video.duration || 4, Math.max(0.2, duration - t));
      if (len <= 0.05) return;
      cuts.push({ t0: t, t1: t + len, clip: i, start: 0 });
      t += len;
    });
  } else {
    let t = 0;
    videos.forEach((video, i) => {
      const len = Math.max(0.2, video.duration || 1);
      cuts.push({ t0: t, t1: t + len, clip: i, start: 0 });
      t += len;
    });
    const target = Math.max(t, voiceBuffer?.duration || t);
    if (t > 0 && target > t + 0.05) {
      let extra = t;
      let n = 0;
      while (extra < target - 0.05) {
        const clip = n % videos.length;
        const vd = videos[clip].duration || 1;
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
  const audioTrack = dest.stream.getAudioTracks()[0];
  if (audioTrack) stream.addTrack(audioTrack);

  const chunks: BlobPart[] = [];
  const rec = new MediaRecorder(stream, { mimeType: pickMime(), videoBitsPerSecond: 8_000_000 });
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
  });

  await document.fonts.load('700 72px "TikTok Sans"').catch(() => undefined);
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
  rec.start(200);
  voiceSource?.start();
  const t0 = audioCtx.currentTime;
  input.onProgress?.(8, "Assemblage");

  await new Promise<void>((resolve, reject) => {
    const tick = () => {
      try {
        const now = Math.min(duration, audioCtx.currentTime - t0);
        const cut = cuts.find((c) => now >= c.t0 && now < c.t1) || cuts[cuts.length - 1];
        const video = videos[cut.clip];
        const local = cut.start + (now - cut.t0);
        if (Math.abs((video.currentTime || 0) - local) > 0.12) {
          video.currentTime = Math.min(Math.max(0, local), (video.duration || 1) - 0.05);
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

        if (input.overlayText.trim()) {
          const style = input.overlay || { align: "center" as const, size: 64, y: 16, fill: "#ffffff", stroke: "#000000" };
          const size = Math.max(24, style.size || 64);
          ctx.font = `700 ${size}px "TikTok Sans", ui-sans-serif, system-ui`;
          ctx.textAlign = style.align || "center";
          ctx.lineJoin = "round";
          ctx.miterLimit = 2;
          const x = style.align === "left" ? 72 : style.align === "right" ? W - 72 : W / 2;
          const maxW = style.align === "center" ? 920 : 900;
          const lines = wrap(ctx, input.overlayText, maxW);
          const y0 = (Math.min(90, Math.max(6, style.y)) / 100) * H;
          lines.forEach((line, i) => {
            const y = y0 + i * (size + 14);
            ctx.lineWidth = Math.max(8, Math.round(size / 4));
            ctx.strokeStyle = style.stroke || "#000";
            ctx.strokeText(line, x, y);
            ctx.fillStyle = style.fill || "#fff";
            ctx.fillText(line, x, y);
          });
        }

        emojis.forEach((img, i) => {
          const size = 96;
          ctx.drawImage(img, 90 + (i % 4) * 110, 430 + Math.floor(i / 4) * 110, size, size);
        });

        if (input.captions && input.script.trim()) {
          const { line, active } = captionWindow(input.script, now, duration);
          if (line.length) {
            ctx.textAlign = "center";
            const capSize = input.caption.size || 56;
            ctx.font = `700 ${capSize}px "TikTok Sans", ui-sans-serif, system-ui`;
            ctx.lineJoin = "round";
            const joined = line.join(" ");
            const y = ((input.caption.y ?? 79) / 100) * H;
            if (input.caption.preset === "boxed" || input.caption.preset === "pop") {
              const pad = 22;
              const width = Math.min(980, ctx.measureText(joined).width + pad * 2);
              const x = (W - width) / 2;
              drawRounded(ctx, x, y - 58, width, 84, 16);
              ctx.fillStyle = input.caption.preset === "pop" ? input.caption.highlight : "rgba(0,0,0,0.72)";
              ctx.fill();
              ctx.fillStyle = input.caption.fill;
              ctx.fillText(joined, W / 2, y);
            } else if (input.caption.preset === "minimal") {
              ctx.fillStyle = input.caption.fill;
              ctx.fillText(joined, W / 2, y);
            } else {
              let x = W / 2;
              const total = ctx.measureText(joined).width;
              x = W / 2 - total / 2;
              line.forEach((word, i) => {
                const w = ctx.measureText(word).width;
                ctx.lineWidth = 14;
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
  videos.forEach((v) => URL.revokeObjectURL(v.src));
  await audioCtx.close().catch(() => undefined);
  input.onProgress?.(100, "Prêt");
  return new Blob(chunks, { type: rec.mimeType || "video/webm" });
}
