# Changelog

## Unreleased

- **Fillers are manageable from one place.** A block's filler mode moved off
  the Schedule tab's block form (where it was an unlabelled dropdown) onto the
  channel's **Fillers** tab, next to the clips it governs, and saves on its own.
  The tab now warns when nothing on the channel opens a filler slot at all —
  previously you could assign fillers to a rotation-only channel and silently
  get nothing on air. **+ New filler** builds one and assigns it without a trip
  to the Media page and back.
- **Filler previews are branded correctly.** Generating a preview read the
  Filler row's own channel/block, which the shared-library migration nulls, so
  every generated clip came out with the bundled mark instead of the channel
  logo it airs with. Previews now brand from an explicit **Preview as** channel,
  falling back to wherever the filler is assigned.
- Editing a filler discards its generated clip instead of leaving a preview of
  the old settings, generated clips are badged `generated` on the Media page
  and no longer offered as a "custom clip" source, and deleting one clears the
  filler's reference to it.
- **One Fillers tab instead of two.** "Filler clips" and "Fillers" merged: an
  uploaded clip was only ever readable through a filler that pointed at it, so
  uploading now creates that filler in the same action. Leftover uploads nothing
  points at are listed under a collapsed *Unused clips* disclosure, and deleting
  a custom filler takes its clip with it unless another filler shares it.
- **Generation survives leaving the page.** It always ran on the server, but the
  progress bar was local state, so navigating away made a running build look
  stopped — and coming back offered "Generate" again. The server now exposes its
  job list (`GET /api/fillers/generating`), the page resumes any build in flight
  on mount, and the bar carries a percentage.
- Docs corrected: the gaps *between* blocks on a blocks-only channel are dead
  air, not filler, and the retired filler styles are documented as retired.

- **Container load chart** on the Dashboard — CPU and memory sampled every 3s
  from the container's cgroup, graphed over the last 5/15/60 minutes with a
  marker at every playout change (episode, filler, music video). Sampling runs
  continuously and transitions annotate the timeline, so a step change in load
  can be attributed to the item that caused it rather than to the encoder spawn.
  Exposed at `GET /api/metrics`.

## 0.7.0 — Scale & polish (2026-07-20)

- **Shared HLS output** — one transcode per channel instead of one per viewer,
  the biggest gap vs ErsatzTV. A single long-lived encoder muxes the channel
  into rolling segments served to everyone; it starts on first request and is
  reaped 30s after the last viewer leaves.
- **Selectable streaming mode** — **Settings → Streaming** picks what the M3U
  advertises: shared HLS (recommended for multiple viewers) or per-client
  MPEG-TS. Both endpoints stay live either way; the default stays MPEG-TS.
- **Multi-vendor hardware acceleration** — beyond NVENC to Intel QuickSync,
  VAAPI, AMD AMF, and Apple VideoToolbox. Support is *functionally probed* (a
  real test encode on your host), so an encoder that's listed but unusable
  falls back to CPU instead of breaking the stream. Hardware decode stays
  NVIDIA-only (NVDEC).
- **Subtitle burn-in** — a per-profile toggle renders the source's first
  embedded subtitle track into the picture, sized for the output resolution.
- **Music videos** — a `music` library type that parses Artist/Album/Title
  layouts, plus an on-screen lower-third chyron naming the track as it starts
  and "Artist – Title" programme entries in the guide.
- The version reported on the Dashboard now comes from `package.json` rather
  than a hardcoded constant that had drifted behind releases.

## 0.6.0 — MosaicTV (2026-07-19)

- **Rebranded MeSatzTV → MosaicTV**: new name, logos, favicons, image
  (`ghcr.io/tronvondoom/mosaictv`), and repository.
- **GPL-3.0 license** — MosaicTV is now properly open source.
- **Ready to share**: full user documentation under `docs/`, GPU made
  optional in the Docker/Unraid defaults (CPU encoding out of the box,
  NVIDIA opt-in), folder picker clamped to the media root.
- Getting-started onboarding on the Dashboard for fresh installs.
- ⚠️ Migration from a MeSatzTV install: rename `mesatztv.db` →
  `mosaictv.db` in your data folder (plus any `-wal`/`-shm` files) before
  starting the new image.

## 0.5.x — Streaming, filler & polish (2026-07)

- Live MPEG-TS streaming per channel (`/iptv/channel/N.ts`): normalized
  transcode, mid-program tune-in, real-time pacing, per-client streams.
- ffmpeg concat-demuxer pipeline for seamless segment transitions.
- NVIDIA support: NVENC encoding, NVDEC decoding (per-codec capability probe),
  automatic CPU fallback.
- Per-channel **encoding profiles**: resolution, fps, quality ladder, preset,
  deinterlacing, scaling, audio settings, loudness normalization.
- **Station-ID filler**: between/end distribution inside blocks, hard-start
  gap filling; generated styles (frosted, logo wall, pulse, animated, retro,
  vintage) + custom clips, per channel and per block, with audio bake-in.
- **Watermarks**: permanent or intermittent with fades, four corners,
  size/margin/opacity controls; hidden during filler; per-block logo overrides.
- **"Coming up next" captions**, per channel and per block.
- **Logo library**: uploads, guide + watermark integration.
- Maintenance: one-click backup (.tar.gz), reset to clean slate, log viewer
  with download.

## 0.4.0 — Guide output (M4)

- M3U playlist (`/iptv/channels.m3u`) + XMLTV EPG (`/iptv/xmltv.xml`).
- Reverse-proxy-aware URLs; channel groups and logos in the guide.
- Rotate-shows playback order; blocks-only channels.

## 0.3.0 — Channels & scheduler (M3)

- Collections (hand-picked members + smart filters), channels with 24/7
  rotations and day/time blocks, hybrid playout engine with persistent
  positions, guide preview.

## 0.2.x — Library & metadata (M2, M2.5)

- Prisma/SQLite, ffprobe scanner with incremental re-scan and missing
  detection, Plex-style name parsing.
- Plex-style browser (shows → seasons → episodes), local artwork detection,
  TMDB metadata & posters.
- GHCR image pipeline, Unraid template.

## 0.1.0 — Deploy loop (M1)

- Repo, Docker image, Express + React skeleton, Unraid update flow.
