<p align="center">
  <img src="web/public/logo-full.png" alt="MosaicTV" width="420" />
</p>

<p align="center">
  <b>Turn your media library into scheduled 24/7 live TV channels.</b><br/>
  Your shows and movies, playing on a real schedule — with station logos, filler,
  "coming up next" captions, and a TV guide — in Plex, Jellyfin, Emby, or any IPTV player.
</p>

---

Remember channel surfing? MosaicTV brings it back, but every channel is built
from *your* library. Set up a Saturday-morning cartoons block, a 24/7 sitcom
rotation, a late-night movie channel — then flip to it like real TV: it's
already playing, mid-episode, right on schedule.

Inspired by [ErsatzTV](https://ersatztv.org/), rebuilt from scratch to be
simple to run and pleasant to configure.

## Features

- 📺 **Real live-TV channels** — tune in mid-program like broadcast TV.
  Channels resume where they left off, forever. Serve them as shared HLS (one
  transcode per channel, however many viewers) or per-client MPEG-TS.
- 🗓 **Scheduling that thinks like a station** — 24/7 rotations (in order /
  round-robin across shows / shuffle) plus day/time blocks (*weekdays 6–9pm →
  Cartoons*) with soft or exact-time starts.
- 🎬 **Station-ID filler** — gaps auto-filled so blocks end on time: seven
  generated ident styles branded with your channel logo, or your own bumper
  clips, per channel and per block.
- 🖼 **Broadcast polish** — corner watermark (permanent or intermittent with
  fades), per-block logo overrides, burned-in "coming up next" captions.
- 📡 **Standard M3U + XMLTV output** — works with Jellyfin and Emby directly,
  Plex via Threadfin, VLC, TiviMate, and any IPTV player.
- 🔍 **Library management built in** — Plex-style scanner (incremental,
  ffprobe-backed) for TV, movies, and music videos; TMDB posters & metadata,
  local artwork support, a poster-wall browser.
- ⚙️ **Per-channel encoding profiles** — resolution, fps, bitrate ladder,
  deinterlacing, subtitle burn-in, loudness normalization; **GPU encoding** on
  NVIDIA, Intel QuickSync, VAAPI, AMD AMF or Apple VideoToolbox, each verified
  by a real test encode on your host, with a clean CPU fallback.
- 📦 **One container** — web UI, database, and ffmpeg included. Runs on
  Unraid, any Docker host, or a NAS.

## Quick start

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

Open `http://YOUR-SERVER:8688`, add a library, scan, build a channel — the
[Getting Started guide](docs/getting-started.md) walks you through all of it
in about ten minutes.

> ⚠️ MosaicTV has no login — keep it on your LAN (or behind a VPN like
> Tailscale). See [Security](docs/security.md).

## Documentation

| | |
| - | - |
| 🚀 [Installation](docs/install.md) | Docker run · Portainer · **Unraid template** · Compose |
| 🏁 [Getting Started](docs/getting-started.md) | First library → first channel → first stream |
| 🗓 [Channels & Scheduling](docs/channels.md) | Collections, rotations, time blocks, the guide |
| 🎨 [Branding](docs/branding.md) | Logos, watermarks, filler styles, up-next captions |
| 📡 [Connecting Players](docs/clients.md) | Jellyfin · Emby · Plex/Threadfin · VLC · IPTV apps |
| ⚡ [Hardware Acceleration](docs/hardware-acceleration.md) | CPU vs NVIDIA, setup per platform, profiles |
| 🔒 [Security](docs/security.md) | LAN-only stance, VPN access, reverse proxies |
| 🛠 [Troubleshooting & Backup](docs/troubleshooting.md) | Common fixes, logs, backup/restore |

## Tech stack

Express + TypeScript backend, React + Vite + Tailwind frontend, Prisma +
SQLite, ffmpeg for everything video. See [CHANGELOG.md](CHANGELOG.md) for
release history.

For local development:

```bash
npm run install:all   # root + server + web dependencies
npm run dev           # backend :8688, frontend :5173
```

## Contributing

Issues and PRs welcome — bug reports with the in-app log download attached are
extra welcome. If you're missing a feature (Intel QSV? another filler style?),
open an issue and let's talk.

## License

[GPL-3.0](LICENSE) — free to use, modify, and share; derivatives stay open.
