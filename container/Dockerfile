# syntax=docker/dockerfile:1.7
# ClipForge media container for Cloudflare Containers (linux/amd64).
# Runs yt-dlp, FFmpeg and OpenCV face detection. Speech-to-text runs on Workers AI, not here.
# Build context is the repository root (see wrangler.jsonc `image_build_context`).

FROM node:22-bookworm-slim AS build
WORKDIR /build
RUN npm install --no-save --no-audit --no-fund esbuild@0.25.11
COPY shared ./shared
COPY container ./container
RUN npx esbuild container/server.ts --bundle --platform=node --target=node22 --format=esm --outfile=dist/server.mjs

FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates fonts-dejavu-core fonts-liberation2 fontconfig tini \
  && rm -rf /var/lib/apt/lists/*
# yt-dlp[default] bundles yt-dlp-ejs; Node in this image is the JavaScript runtime it needs for YouTube.
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir "yt-dlp[default]" opencv-python-headless numpy
ENV PATH="/opt/venv/bin:${PATH}" PYTHON_BIN=/opt/venv/bin/python FACE_SCRIPT=/app/face_center.py PORT=8080 WORK_DIR=/tmp/clipforge
WORKDIR /app
COPY --from=build /build/dist/server.mjs ./server.mjs
COPY container/face_center.py ./face_center.py
RUN useradd --system --create-home clipforge && mkdir -p /tmp/clipforge && chown clipforge /tmp/clipforge
USER clipforge
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.mjs"]
