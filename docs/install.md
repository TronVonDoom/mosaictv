# Installation

MosaicTV ships as a single Docker container:
**`ghcr.io/tronvondoom/mosaictv:latest`** — web UI, database, and ffmpeg all
included. It runs anywhere Docker runs: Unraid, Synology/QNAP, Proxmox, a
Raspberry Pi 5, or any Linux box.

Every install needs the same two mounts and one port:

| | Container path | Purpose |
| - | ------------- | ------- |
| **Data** | `/app/data` | Database, logos, generated filler — **persistent, keep it** |
| **Media** | `/media` | Your media library — mount **read-only** |
| **Port** | `8688` | Web UI + IPTV endpoints |

> ⚠️ MosaicTV has **no login**. Keep it on your LAN — see [Security](security.md).

---

## Option 1 — `docker run` (any platform)

```bash
docker run -d \
  --name mosaictv \
  --restart unless-stopped \
  -p 8688:8688 \
  -e TZ=America/Chicago \
  -v /path/to/appdata/mosaictv:/app/data \
  -v /path/to/your/media:/media:ro \
  ghcr.io/tronvondoom/mosaictv:latest
```

Change `TZ` to [your timezone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
(it controls schedule times and the TV guide), and the two `-v` left-hand paths
to real folders on your host. Then open `http://YOUR-SERVER:8688`.

**With an NVIDIA GPU** (optional — see [Hardware Acceleration](hardware-acceleration.md)):

```bash
docker run -d \
  --name mosaictv \
  --restart unless-stopped \
  --gpus all \
  -p 8688:8688 \
  -e TZ=America/Chicago \
  -e NVIDIA_VISIBLE_DEVICES=all \
  -e NVIDIA_DRIVER_CAPABILITIES=all \
  -v /path/to/appdata/mosaictv:/app/data \
  -v /path/to/your/media:/media:ro \
  ghcr.io/tronvondoom/mosaictv:latest
```

---

## Option 2 — Unraid (template)

1. On the Unraid terminal, download the template:

   ```bash
   curl -L -o /boot/config/plugins/dockerMan/templates-user/my-MosaicTV.xml \
     https://raw.githubusercontent.com/TronVonDoom/mosaictv/main/unraid/my-MosaicTV.xml
   ```

2. **Docker** tab → **Add Container** → pick **MosaicTV** from the template
   dropdown.
3. Point **Media Library** at your media share (e.g. `/mnt/user/media`) and
   set your **Timezone**. **Apply**.
4. Open the WebUI from the Docker page.

**Updating:** Docker tab → MosaicTV → **Force Update** (or "Check for Updates").
It pulls the newest image built by CI.

**NVIDIA GPU on Unraid:** install the **Nvidia-Driver** plugin (Community
Apps), then edit the container: add `--runtime=nvidia` to **Extra Parameters**
and set **NVIDIA GPUs** to `all` (or one GPU's UUID from `nvidia-smi -L`).
Details in [Hardware Acceleration](hardware-acceleration.md).

---

## Option 3 — Portainer (stack)

Portainer → **Stacks** → **Add stack**, paste:

```yaml
services:
  mosaictv:
    image: ghcr.io/tronvondoom/mosaictv:latest
    container_name: mosaictv
    restart: unless-stopped
    ports:
      - "8688:8688"
    environment:
      - TZ=America/Chicago
    volumes:
      - /path/to/appdata/mosaictv:/app/data
      - /path/to/your/media:/media:ro
```

Edit the paths and timezone, then **Deploy**. To update: re-pull the image and
re-deploy the stack.

---

## Option 4 — Docker Compose from source

For development or if you want to build the image yourself:

```bash
git clone https://github.com/TronVonDoom/mosaictv.git
cd mosaictv
# edit docker-compose.yml: media path, TZ, optional NVIDIA lines
docker compose up -d --build
```

Update later with the bundled script (git pull + rebuild + prune):

```bash
./scripts/update.sh
```

---

## Local development (no Docker)

Requires Node 22+ and ffmpeg on your PATH.

```bash
npm run install:all   # install root, server, and web dependencies
npm run dev           # backend on :8688, frontend on :5173
```

Open <http://localhost:5173>. The dev server proxies `/api/*` to the backend.
First run creates `server/prisma/dev.db` (run `npm --prefix server run db:push`
if it's missing).

---

## Environment variables

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `TZ` | `America/Chicago` | Timezone for schedules and the guide |
| `PORT` | `8688` | Port the app listens on |
| `DATABASE_URL` | `file:/app/data/mosaictv.db` | SQLite database location |
| `MEDIA_ROOT` | `/media` | Root the in-app folder picker may browse |
| `TMDB_API_KEY` | – | TMDB key (can also be set in the UI under Settings) |
| `NVIDIA_VISIBLE_DEVICES` | – | `all` or a GPU UUID, for NVIDIA transcoding |
| `NVIDIA_DRIVER_CAPABILITIES` | – | `all`, for NVIDIA transcoding |

Next step: [Getting Started](getting-started.md) →
