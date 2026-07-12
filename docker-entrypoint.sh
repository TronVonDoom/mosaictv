#!/usr/bin/env sh
# Container startup: ensure the data dir exists, sync the DB schema, then run.
set -e

mkdir -p /app/data

echo "==> Syncing database schema (prisma db push)..."
npx prisma db push --skip-generate

echo "==> Starting MeSatzTV..."
exec node dist/index.js
