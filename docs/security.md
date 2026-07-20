# Security

**MosaicTV has no login. Treat it as LAN-only.**

Like most self-hosted media tools of its kind (ErsatzTV, Threadfin, xTeVe…),
MosaicTV assumes it runs on a trusted home network. Anyone who can reach port
8688 can open the admin UI, change your channels, and read your media library
listing. That's the deal — so control who can reach the port.

## Rules of thumb

- ✅ **Do** run it on your home LAN and connect players on the same network.
- ✅ **Do** mount your media **read-only** (`:ro`) — the app never needs to
  write to it, and every install guide in these docs already does this.
- ❌ **Don't** port-forward 8688 on your router.
- ❌ **Don't** put it on a VPS/cloud host with a public IP and no protection.

## Watching away from home

The right way is a VPN into your home network — then everything works exactly
as if you were home:

- **[Tailscale](https://tailscale.com/)** (easiest): install on the server and
  your devices; use the server's Tailscale IP in the M3U/guide URLs.
- **WireGuard** — built into many routers and most NAS/Unraid setups.

## Reverse proxy (advanced)

If you must expose it, put a reverse proxy (Caddy, Nginx Proxy Manager,
Traefik) in front with authentication — e.g. basic auth or an SSO layer like
Authelia/Authentik.

- MosaicTV honors `X-Forwarded-Proto` / `X-Forwarded-Host`, so the URLs inside
  the generated M3U/XMLTV stay correct behind a proxy.
- Heads-up: most TV clients (Jellyfin apps, IPTV boxes) can't do interactive
  SSO logins on a raw MPEG-TS stream URL. In practice this means auth in front
  works for the *admin UI*, but the *stream endpoints* need either network
  trust (VPN) or basic-auth credentials embedded in the URL where the client
  supports it. A VPN sidesteps all of this — use one if you can.

## What the app itself limits

- The in-app folder picker only browses inside the media root
  (`/media`, override with `MEDIA_ROOT`) — it can't wander the host
  filesystem.
- Media is only ever read, never modified.
- Nothing phones home; the only outbound calls are to TMDB (metadata you
  request) and any logo URLs you configure.
