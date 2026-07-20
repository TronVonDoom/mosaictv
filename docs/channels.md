# Channels & Scheduling

How MosaicTV decides what airs when — in depth. For the quick version, see
[Getting Started](getting-started.md).

## The model

```
Channel
├── Collections   (pools of media this channel draws from)
├── Rotation      (ordered list of collections — the 24/7 default)
├── Time blocks   (day/time slots that override the rotation)
└── Playout       (the generated timeline = what actually airs)
```

## Channels

**Channels** page → **Add channel**.

- **Number** — the channel's position on the dial, used in the M3U/XMLTV and
  the stream URL (`/iptv/channel/7.ts`). Leave blank for a **draft**: hidden
  from the guide and stream while you build it out.
- **Name / Group** — shown in players. Group becomes the M3U `group-title`,
  which many players use to categorize channels.
- **Encoding profile** — which output settings this channel streams with
  (default: built-in 720p30). See [Hardware Acceleration](hardware-acceleration.md).
- **Logo** — shown in players' guides, and doubles as the default on-screen
  watermark. See [Branding](branding.md).
- **Coming up next** — optional burned-in caption naming the next program.

## Collections

Each channel manages its own collections (**Collections** tab). A collection
resolves to a set of playable items from two sources, combined and deduped:

1. **Members** — hand-picked shows and movies added via the search box. A
   collection can hold multiple shows.
2. **Smart filter** — optional: by library, media type, exact show, title
   search, or genre.

Only playable items count (files that exist and have a known duration).

## Rotation

The rotation is the channel's 24/7 backbone: an ordered list of collections
that loops forever. Per entry:

- **1 at a time / multiple (N)** — how many items play before moving to the
  next entry. `Sitcoms ×2 → Movies ×1` gives you two episodes then a movie,
  repeating.
- **Playback order**:
  - **in order** — chronological (S01E01 → S01E02 → …; movies by year).
  - **rotate shows** — round-robin across shows in the collection: each show
    takes a turn, each continuing from its own last-played episode.
  - **shuffle** — seeded shuffle; the sequence is stable until it reshuffles
    after a full pass.

Every show/collection keeps its **position** — a channel resumes exactly where
it left off, even across guide rebuilds and container restarts.

## Time blocks

Blocks override the rotation during specific day/time windows (*Sat–Sun
08:00–11:00 → Cartoons*). Add them from the weekly grid or the form.

Per block:

- **Days + start/end time** (channel timezone = the container's `TZ`).
- **Collection + playback order** — same options as rotation.
- **Start mode**:
  - **soft** — the block takes over at the next program boundary; nothing gets
    cut off.
  - **hard** — the block starts exactly on time; the gap before it is filled
    with filler so the previous program doesn't overrun.
- **Filler mode** — how leftover time inside the block is handled so it ends
  on schedule: **none** (programs may overrun), **between** (filler spread
  between programs), or **end** (one filler stretch at the end). Which clips
  play is set on the **Fillers** tab.
- **Logo override** — a different on-screen watermark while the block airs.
- **"Coming up next" override** — per-block caption settings, including
  turning it off for just this block.

Blocks-only channels (no rotation) are fine: the channel plays filler between
blocks.

## The playout (guide)

**Guide** tab → **Build 48h** generates the timeline. The engine walks
forward from the anchor point, applying blocks when active and the rotation
otherwise, packing programs and inserting filler to land on block boundaries.

- **Timeline / list view** — preview exactly what airs when.
- **Rebuild** — clears and regenerates the schedule anchored to *now*.
  **Positions are kept** — shows continue where they were.
- **Restart from S1E1** — the nuclear option: also resets every position.

The playout extends itself automatically as time passes; you don't need to
rebuild manually unless you've changed the schedule.

## Streams

Each channel is a continuous MPEG-TS stream at
`/iptv/channel/<number>.ts`. Tuning in mid-program starts at the right offset
— just like real TV. Multiple clients can watch the same channel; each gets
its own stream. All items are normalized to the channel's encoding profile so
transitions are seamless.
