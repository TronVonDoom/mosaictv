# syntax=docker/dockerfile:1

# ---- Stage 1: build the React frontend ----
FROM node:22-slim AS web-build
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Stage 2: compile the Express backend + generate Prisma client ----
FROM node:22-slim AS server-build
WORKDIR /server
COPY server/package*.json ./
RUN npm ci
COPY server/prisma ./prisma
RUN npx prisma generate
COPY server/ ./
RUN npm run build

# ---- Stage 3: lean runtime image ----
# Trixie (Debian 13) rather than bookworm purely for ffmpeg: bookworm ships
# 5.1, which has neither -readrate_initial_burst (6.1+) nor -readrate_catchup
# (7.0+), so every viewer connected with no buffer cushion and no way to earn
# one back after a stall — the streaming path asks for both and silently went
# without. Trixie ships 7.1. The build stages stay where they are; only
# compiled JS crosses from them, and this is the stage ffmpeg comes from.
FROM node:22-trixie-slim AS runtime
# ffmpeg = streaming pipeline (later); openssl = required by Prisma;
# fonts-dejavu-core = a known TTF on disk so ffmpeg's drawtext (burned-in
# "coming up next" / schedule text) has a font to render with.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/data/mosaictv.db
WORKDIR /app

# Production dependencies (includes prisma CLI + client) + generated client
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/prisma ./prisma
RUN npx prisma generate

# Compiled backend + built frontend
COPY --from=server-build /server/dist ./dist
COPY --from=web-build /web/dist ./public
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 8688
CMD ["./docker-entrypoint.sh"]
