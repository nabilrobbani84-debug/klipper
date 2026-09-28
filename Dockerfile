FROM oven/bun:1.2.14 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install

FROM dependencies AS build
COPY . .
RUN bun run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip postgresql-client ca-certificates && rm -rf /var/lib/apt/lists/* \
  && pip3 install --no-cache-dir --break-system-packages yt-dlp openai-whisper
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY server ./server
COPY tsconfig.server.json ./tsconfig.server.json
COPY .env.example ./.env.example
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "--import", "tsx", "server/index.ts"]
