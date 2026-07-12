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
FROM node:22-slim AS runtime
# ffmpeg = streaming pipeline (later); openssl = required by Prisma
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/data/mesatztv.db
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
