#!/usr/bin/env sh
# Pull the latest MosaicTV from GitHub and rebuild the container.
# Run this on Unraid whenever you've pushed changes:  ./scripts/update.sh
set -e

cd "$(dirname "$0")/.."

echo "==> Pulling latest from GitHub..."
git pull --ff-only

echo "==> Rebuilding and restarting the container..."
docker compose up -d --build

echo "==> Cleaning up old images..."
docker image prune -f

echo "==> Done. MosaicTV is up to date."
