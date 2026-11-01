# syntax=docker/dockerfile:1
# MSGate sur le VPS Hostinger (Coolify), comme mvdyprince.fr : un vrai disque, donc Drive,
# Studio IA, factures et réglages sont gardés (Vercel n'en a pas).

# ---------- Build ----------
FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- Run ----------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    KEEP_ALIVE_TIMEOUT=125000

# ffmpeg / ffprobe (Studio IA, montage, rendus) et yt-dlp (Download TikTok, médias Instagram).
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python-is-python3 ffmpeg ca-certificates git \
 && pip3 install --no-cache-dir --break-system-packages yt-dlp \
 && apt-get purge -y python3-pip \
 && apt-get autoremove -y \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Le binaire de ffmpeg-static n'est pas suivi par le traçage de Next : on le recopie.
COPY --from=builder /app/node_modules/ffmpeg-static ./node_modules/ffmpeg-static
# Keep-alive plus long que celui de Traefik : sinon des POST tombent en 502 au hasard (voir le fichier).
COPY --from=builder /app/keepalive.cjs ./keepalive.cjs

# Les données : à monter en dossiers persistants (Coolify « file storage »).
RUN mkdir -p /app/data/media /app/.msgate-cache /app/.phoenix-cache && chown -R node:node /app
USER node
VOLUME ["/app/data", "/app/.msgate-cache", "/app/.phoenix-cache"]

EXPOSE 3000
CMD ["node", "-r", "./keepalive.cjs", "server.js"]
