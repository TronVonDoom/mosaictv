# Changelog

## 0.7.2 — Read-rate cushion detection (2026-07-21)

- **The read-rate cushion is detected per option, so ffmpeg 7.1 actually gets
  it.** 0.7.1 added the missing `-readrate` but still probed
  `-readrate_initial_burst` and `-readrate_catchup` as a pair — and Debian
  trixie's ffmpeg 7.1 doesn't ship `-readrate_catchup` at all, so the combined
  probe failed on the option that isn't there and the burst was dropped along
  with it. The two are now probed independently: this ffmpeg has the initial
  burst, so streams get their connect-time cushion, and it simply skips the
  catch-up rate it lacks. The probe also logs ffmpeg's own error when it
  rejects an option, so the next mismatch says *why* instead of a bare "lacks"
  line.

## 0.7.1 — Plex-direct tuner (2026-07-21)

- **ffmpeg 7.x is recognized as supporting the connect-time read-rate burst.**
  The capability probe tested `-readrate_initial_burst` / `-readrate_catchup`
  without the `-readrate` they qualify. ffmpeg 6.1 quietly ignored that
  combination; 7.x rejects it outright, so the probe exited non-zero and every
  stream fell back to plain read-rate — the very trixie image built to *gain*
  the burst cushion was detected as lacking it. The probe now sets `-readrate`
  the way the streaming path does — necessary, but as it turned out not
  sufficient on its own (see 0.7.2).
- **The log says which stream each line belongs to.** With two people watching,
  every ffmpeg exit and stall warning read as though it came from the same
  place. Each viewer connection now gets a tag — `V3 Plex`, `V4 Jellyfin`,
  identified from the player's own User-Agent — carried through everything that
  session does, including the per-item encodes the outer ffmpeg fetches back
  over loopback. Click a tag in **Logs** to follow just that viewer, or pick one
  from the new stream filter. Shared-HLS channels log under `HLS ch5` instead,
  since that encoder genuinely is shared, with a line when a new client joins
  it.
- **Container load is logged every minute.** The resource graph only lives in
  memory, so a downloaded log said nothing about what the box was doing when the
  freeze happened. CPU (average and peak over the minute), memory against the
  container's limit, the live ffmpeg count, and who was watching now go into the
  log itself. A healthy beat is a debug line so it doesn't crowd the view; it's
  raised to info when CPU is near saturation or memory near the limit. Idle
  minutes are thinned to one line every five.
- **Debug lines are hidden until you ask for them**, behind an *Include debug*
  switch in **Logs** — they're always recorded, they were just burying the lines
  that matter. **Copy all** and **Download** now hand over the entire log
  regardless of any filter, so a filter you forgot about can't quietly withhold
  the line that explains the bug.

- **Plex can add MosaicTV directly — no Threadfin.** Plex's Live TV wants an
  HDHomeRun tuner rather than a raw M3U, which meant running Threadfin or xTeVe
  purely to translate. MosaicTV now answers the tuner protocol itself
  (`/discover.json`, `/lineup.json`), so you point Plex's "enter the address
  manually" box at it and the channels come straight in. Emby accepts it the
  same way. There's no broadcast discovery, so it won't show up in a device
  scan — add it by address. The tuner always hands out MPEG-TS regardless of
  the streaming mode, since a tuner URL is a raw transport stream by contract
  and Plex won't tune anything else. **Settings → Streaming** shows the tuner's
  device ID and lets you set its name and how many simultaneous streams it
  advertises — the name is worth setting if you run two instances, which would
  otherwise both show up in Plex as "MosaicTV", and the count matters because
  Plex stops playback once it runs out of tuners. Threadfin still works if you
  want its remapping and filtering.

- **Collections play in the order you arrange them.** Members were stored with
  a position that nothing ever read — the resolver re-sorted everything
  alphabetically, so adding *Rugrats, Doug, Hey Arnold* always aired Doug first.
  Members are now draggable and there's a **hand-picked order** playback mode
  that airs them in your sequence, each show expanded into its own episodes.
  The other orders are unchanged.
- **Shuffle actually reshuffles.** It was seeded once per channel+collection, so
  a collection played through twice repeated the identical running order
  forever. Each pass now gets its own deal. It stays derived from the playback
  position rather than stored, so guide rebuilds still reproduce the timeline
  exactly and your place in a collection survives restarts.
- **A new "shuffle shows" order** puts the shows in random order while keeping
  each one's episodes in sequence — a marathon of one show, then a marathon of
  another, with the running order re-dealt each pass.
- **Collections carry their own playback order.** Rotation items and time blocks
  now default to *collection default* instead of making you pick an order at
  every slot; five day-blocks of "Snick" need it set once. Overriding a single
  slot still works.
- **Collections can hold a season or a single episode**, not just whole shows
  and movies — which is what makes a hand-picked running order worth having (a
  "best of" marathon). The member search offers all four.
- **"Rotate shows" no longer starves a show that shares a collection with a pile
  of movies.** Movies each counted as their own show in the round-robin, so one
  show plus fifty movies gave the show 1/51 of the airtime instead of half. They
  now share a single turn.
- **Collections have a Preview** listing what they resolve to in their own
  order, so you can check a hand-picked arrangement without building a guide.
  Listing collections also stopped issuing a query per member show.

- **The navigation is six destinations in three groups.** Two pairs of nav items
  were the same idea under different names: **Browse** showed what was indexed
  and **Libraries** managed the folders it came from, so they merged into
  **Library** with *Browse* and *Sources* tabs. **Media** became **Studio** —
  "media" also meant the media in your library — and absorbed the **Logos** page,
  which had its own route but never appeared in the nav. Everything is grouped
  now: *Broadcast* (Dashboard, Channels), *Content* (Library, Studio), *System*
  (Logs, Settings). Old links still work: `/browse/3/show/Foo` keeps its ids and
  lands on `/library/3/show/Foo`.
- **⌘K / Ctrl-K jumps to anything** — pages, settings and studio tabs by what
  they do rather than what they're called ("backup" finds Maintenance, "bumper"
  finds Fillers), plus every channel and library by name. There's a Search button
  in the sidebar carrying the shortcut, so it's findable without knowing it.
- **The Dashboard leads with the setup checklist** until it's complete, instead
  of putting it below three panels of zeroes on a fresh instance. It shows
  progress and marks the next actionable step; once you're broadcasting it
  disappears and the live guide takes the top slot.
- **Tabs are linkable.** Tab state across Settings, Studio, Library and the
  channel editor lives in the URL hash, so a tab survives a reload and can be
  linked to. One consequence: leaving a tab discards an unsaved form on it.
- **The sidebar says whether you're on air** — how many channels are live and
  how many people are watching, from anywhere in the app.
- Descriptions throughout moved out of paragraph-length preambles into hints
  attached to the control they explain, empty states now say what the thing is
  and offer the next step, and pages show skeletons while loading instead of
  popping in.

- **Fillers are manageable from one place.** A block's filler mode moved off
  the Schedule tab's block form (where it was an unlabelled dropdown) onto the
  channel's **Fillers** tab, next to the clips it governs, and saves on its own.
  The tab now warns when nothing on the channel opens a filler slot at all —
  previously you could assign fillers to a rotation-only channel and silently
  get nothing on air. **+ New filler** builds one and assigns it without a trip
  to the Studio page and back.
- **Filler previews are branded correctly.** Generating a preview read the
  Filler row's own channel/block, which the shared-library migration nulls, so
  every generated clip came out with the bundled mark instead of the channel
  logo it airs with. Previews now brand from an explicit **Preview as** channel,
  falling back to wherever the filler is assigned.
- Editing a filler discards its generated clip instead of leaving a preview of
  the old settings, generated clips are badged `generated` on the Studio page
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
