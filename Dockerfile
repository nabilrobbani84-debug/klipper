# syntax=docker/dockerfile:1.7
# syntax=docker/dockerfile:1.7
# ClipForge AI — multi-target image.
#   target "app"    : API + built React frontend (same origin), no heavy media tooling
#   target "worker" : queue worker with FFmpeg, yt-dlp, Whisper (CPU) and OpenCV

FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.loc[k] ./
RUN bun install --no-frozen-lockfile

FROM deps AS build
COPY . .
# Same-origin deployment: the API serves the SPA, so no API URL is baked in.
ENV VITE_API_URL=""
RUN bun run build

FROM oven/bun:1 AS prod-deps
WORKDIR /app
COPY package.json bun.loc[k] ./
RUN bun install --production --no-frozen-lockfile

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system clipforge && useradd --system --gid clipforge --create-home --home-dir /home/clipforge clipforge \
  && mkdir -p /data/storage /data/tmp && chown -R clipforge:clipforge /data
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
ENV STORAGE_DIR=/data/storage TEMP_DIR=/data/tmp
ENTRYPOINT ["/usr/bin/tini", "--"]

FROM base AS app
COPY --from=build /app/dist ./dist
ENV PORT=8080 FRONTEND_DIST=/app/dist SERVE_FRONTEND=true
USER clipforge
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/index.ts"]

FROM base AS worker
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv fonts-dejavu-core fonts-liberation2 fontconfig \
  && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
  && /opt/venv/bin/pip install --no-cache-dir openai-whisper yt-dlp opencv-python-headless
ENV PATH="/opt/venv/bin:${PATH}" PYTHON_BIN=/opt/venv/bin/python XDG_CACHE_HOME=/data/cache
RUN mkdir -p /data/cache && chown -R clipforge:clipforge /data
USER clipforge
CMD ["node", "--import", "tsx", "server/worker.ts"]
