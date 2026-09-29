# Multi-Stage Production Dockerfile for ClipForge AI
# Stage 1: Build Frontend Assets
FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Production Container with FFmpeg
FROM node:22-slim AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Install FFmpeg and required audio/video codecs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/src/types ./src/types
COPY --from=builder /app/src/data ./src/data
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Create storage mounts
RUN mkdir -p /app/storage/original \
    /app/storage/projects \
    /app/storage/clips \
    /app/storage/exports \
    /app/storage/thumbnails \
    /app/storage/temp

EXPOSE 3000

CMD ["node", "--loader", "tsx", "server.ts"]
