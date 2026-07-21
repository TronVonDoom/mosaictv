# Getting Started

From a fresh install to your first live TV channel. Each step builds on the
last; the whole thing takes about ten minutes plus scan time.

**The flow:** add a **library** → **scan** it → build a **channel** with
**collections** → **build the guide** → point your **player** at the M3U.

---

## 1. Add a library

**Library → Sources** → **Add library**.

- **Name** — whatever you like ("TV Shows", "Movies", "Cartoons").
- **Path** — a folder *inside the container*, i.e. under `/media`. If your
  host mount is `/mnt/user/media` → `/media`, then the host folder
  `/mnt/user/media/tv` is `/media/tv` here. The folder picker only browses
  under `/media`.
- **Type** — TV Shows, Movies, or Music Videos. This controls how filenames
  are parsed.

MosaicTV expects Plex-style naming, which you likely already have:

```
TV/Show Name (2005)/Season 01/Show Name - S01E01 - Episode Title.mkv
Movies/Movie Name (1999)/Movie Name (1999).mkv
```

**Music Videos** parse artist and track out of the folder layout — any of
these work:

```
Music/Artist/Album/Title.mkv
Music/Artist/Title.mkv
Music/Artist - Title.mkv
```

A music-video channel shows a lower-third naming the track as each one starts,
and its guide entries read "Artist – Title" with the album as the sub-title.

## 2. Scan it

Hit **Scan** on the library. A progress bar tracks files as they're probed
(duration, resolution, codecs via ffprobe) and parsed into shows / seasons /
episodes. Re-scans are incremental — unchanged files are skipped, deleted files
are flagged missing.

## 3. (Optional but recommended) TMDB metadata

**Settings** → paste a free [TMDB API key](https://www.themoviedb.org/settings/api)
→ **Save**. Then hit **Metadata** on each library. You get posters, overviews,
genres, and ratings — used in Library → Browse and in your players' guide data.
Local artwork (`poster.jpg`, `folder.jpg`, Plex/Kodi/Jellyfin naming) is used
first when present.

Check your results under **Library → Browse** — drill into shows, seasons, episodes.

## 4. Create a channel

**Channels** → **Add channel**. Give it a **number** (its spot on the dial) and
a **name**. Leave the number blank to keep it a **draft** — hidden from the
guide and stream until you're ready.

Open the channel. It has five tabs: **General · Collections · Schedule ·
Fillers · Guide**.

## 5. Add collections

Collections are the pools of media the channel draws from — created on the
channel's **Collections** tab.

- **Hand-pick** shows/movies with the search box (mix multiple shows in one
  collection), and/or
- add a **smart filter** (by library, type, exact show, title search, or
  genre).

The result is the union of both, deduplicated. Examples: "90s Sitcoms" holding
three hand-picked shows; "Sci-Fi Movies" as a genre filter on your movie
library.

## 6. Schedule it

On the **Schedule** tab:

- **Rotation** — the 24/7 default. An ordered list of collections that loops
  forever. Each entry plays **1 or N** items per turn, **in order**,
  **rotate shows** (round-robin S01E01 of each show, then S01E02…), or
  **shuffle**.
- **Time blocks** (optional) — day/time slots that override the rotation, e.g.
  *Weekdays 18:00–21:00 → Cartoons*. Click the weekly grid to add one. Blocks
  can have their own playback order, filler, logo, and "coming up next"
  settings. **Soft start** waits for the current program to finish; **hard
  start** begins exactly on time and fills the gap before it.

A channel can be rotation-only, blocks-only, or both. Episode positions are
remembered — shows resume where they left off, across days and rebuilds.

## 7. Build the guide

**Guide** tab → **Build 48h**. This generates the playout timeline — what airs
when. Preview it as a timeline or list. It rebuilds automatically as time
passes; **Rebuild** re-anchors to now (positions kept), **Restart from S1E1**
starts every show over.

## 8. Watch!

The bar at the top of **Channels** has your two URLs:

- **M3U**: `http://YOUR-SERVER:8688/iptv/channels.m3u`
- **XMLTV**: `http://YOUR-SERVER:8688/iptv/xmltv.xml`

Add them to Jellyfin, Emby, Threadfin (for Plex), or open the M3U straight in
VLC. Full player-by-player instructions: [Connecting Players](clients.md).

---

## Polish (when you're ready)

- **Logos & watermark** — upload channel logos on the **Logos** page, assign
  them per channel/block, and tune the on-screen watermark under **Settings**.
  → [Branding](branding.md)
- **Station-ID filler** — fill the gaps between programs with generated
  station-ID clips (7 styles) or your own bumpers, per channel and per block.
  → [Branding](branding.md)
- **"Coming up next" captions** — burn a caption naming the next program, per
  channel or per block. Channel **General** tab.
- **Encoding profiles** — resolution/fps/bitrate/GPU per channel under
  **Settings**. → [Hardware Acceleration](hardware-acceleration.md)
- **Backups** — **Settings → Maintenance → Download backup**.
  → [Troubleshooting & Backup](troubleshooting.md)
