# Troubleshooting & Backup

## First stop: the Logs page

**Logs** in the sidebar shows the live application log — scans, stream
starts/stops, ffmpeg fallbacks, errors — and has a download button for filing
issues. Most mysteries are explained there.

## Common issues

### The dashboard says "ffmpeg: NOT available"
Only possible in non-Docker/dev setups (the Docker image bundles ffmpeg).
Install ffmpeg and make sure it's on the PATH.

### My library scanned 0 items
- The library **path** must be the *container* path (under `/media`), not the
  host path. Host `/mnt/user/media/tv` ⇒ container `/media/tv`.
- Check the volume mount actually contains your files:
  `docker exec mosaictv ls /media`.
- Filenames need to be Plex-style parseable — see
  [Getting Started](getting-started.md#1-add-a-library).

### Shows/movies have no posters
- Add a **TMDB API key** (Settings) and run **Metadata** on the library.
- Local artwork is only picked up during a **scan** — rescan after adding
  `poster.jpg`/`folder.jpg` files.

### A channel isn't in the M3U / guide
- Draft channels (no **number**) are excluded on purpose — set a number.
- The channel needs a schedule (rotation and/or blocks) and a built playout —
  open the **Guide** tab and hit **Build 48h** once.

### The stream stops when a second device tunes in
That's your *player's* tuner limit, not MosaicTV: raise Jellyfin's
*Simultaneous stream limit* (0 = unlimited), or give Threadfin/xTeVe more
tuners for Plex. MosaicTV happily serves them all — in MPEG-TS mode each
client gets its own stream, and in shared-HLS mode they all read one.

### Playback stutters / CPU is pegged
- If several people watch at once, switch **Settings → Streaming** to
  **shared HLS** — one transcode per channel instead of one per viewer. This is
  usually the single biggest win. See [Connecting Players](clients.md#streaming-mode-shared-hls-vs-mpeg-ts).
- Lower the encoding profile (720p, faster preset), or
- enable [hardware acceleration](hardware-acceleration.md).
- Remember: only channels **being watched** are encoded.
- Look for `encoder slower than real-time` in **Logs** — that's the encoder
  failing to keep up, and it's what viewers see as freezing.

### Schedule times are off by hours
Set the `TZ` environment variable to your timezone and restart the container.
Rebuild the guide afterwards.

### I edited my schedule but the stream still plays the old one
Open the channel's **Guide** tab and **Rebuild** — it re-anchors to now while
keeping every show's position. (**Restart from S1E1** also resets positions —
usually not what you want.)

### GPU isn't being used
Check the [Hardware Acceleration](hardware-acceleration.md) setup for your
platform, then look in **Logs** for either:

- `Video encoder selected: …` — what MosaicTV actually settled on, or
- `Profile requests <vendor> but <encoder> does not work on this host` — the
  encoder failed its startup test encode, so the stream fell back to the CPU.

MosaicTV verifies an encoder by really using it, so this warning means the
encoder is genuinely unusable here, not merely unlisted. On NVIDIA,
`docker exec mosaictv nvidia-smi` should list your GPU; if it doesn't, the
container isn't seeing the card (runtime/toolkit issue). On VAAPI, make sure
`/dev/dri` is passed into the container.

---

## Backup & restore

Everything MosaicTV owns lives in **one folder**: the `/app/data` volume
(database, uploaded logos, generated filler). Your media is never touched.

- **In-app:** **Settings → Maintenance → Download backup (.tar.gz)** — grabs
  the database + logos + filler in one archive.
- **Manual:** stop the container and copy the host folder mapped to
  `/app/data`.

**Restore:** stop the container, extract/copy the backup into the data folder,
start it again.

**Reset:** **Settings → Maintenance → Reset to clean slate** wipes the
database (optionally also uploaded logos/filler) for a fresh start — take a
backup first.

## Still stuck?

Open an issue: <https://github.com/TronVonDoom/mosaictv/issues> — include the
downloaded logs and what you expected vs. what happened.
