# MosaicTV Documentation

Turn your media library into scheduled 24/7 live TV channels — with filler,
watermarks, "coming up next" captions, and standard M3U + XMLTV output that
plugs into Plex, Jellyfin, Emby, or any IPTV player.

## Guides

| Guide | What's in it |
| ----- | ------------ |
| [Installation](install.md) | Docker run, Docker Compose, Portainer, Unraid — plus updating and all settings |
| [Getting Started](getting-started.md) | Zero to your first live channel, step by step |
| [Channels & Scheduling](channels.md) | Collections, rotations, time blocks, playback orders, the guide |
| [Branding: Logos, Watermarks & Filler](branding.md) | On-screen logos, watermark behavior, station-ID filler clips, "coming up next" |
| [Connecting Players](clients.md) | Jellyfin, Emby, Plex (via Threadfin), VLC, and friends — plus shared HLS vs MPEG-TS |
| [Hardware Acceleration](hardware-acceleration.md) | CPU vs GPU encoding (NVIDIA/QuickSync/VAAPI/AMF/VideoToolbox), setup per platform, encoding profiles |
| [Security](security.md) | Why MosaicTV is LAN-only and how to access it remotely the safe way |
| [Troubleshooting & Backup](troubleshooting.md) | Common issues, logs, backing up and restoring |

## Quick links

- Web UI: `http://YOUR-SERVER:8688`
- M3U playlist: `http://YOUR-SERVER:8688/iptv/channels.m3u`
- XMLTV guide: `http://YOUR-SERVER:8688/iptv/xmltv.xml`
- Per-channel stream (MPEG-TS): `http://YOUR-SERVER:8688/iptv/channel/<number>.ts`
- Per-channel stream (shared HLS): `http://YOUR-SERVER:8688/iptv/channel/<number>/index.m3u8`
