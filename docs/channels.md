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

1. **Members** — hand-picked entries added via the search box: a whole **show**,
   a single **season** of one, an individual **episode**, or a **movie**. A
   collection can hold any mix. **Drag members to reorder them**: *Your order*,
   *Release order* and *Rotate shows* all follow that arrangement.
2. **Smart filter** — optional: by library, media type, exact show, title
   search, or genre. Filter results have no hand-picked position, so they come
   after the members, show by show, A–Z.

Only playable items count (files that exist and have a known duration).

**Plays in this order** (in the collection's **Settings**) sets its own playback
order (below), with each choice explained and the collection's first airings
previewed as you pick. Every rotation item and time block defaults to
*collection default*, so a collection airing in five places only needs its
order set once — override it per slot when you actually want them to differ.

**What airs** lists what the collection resolves to, in its order — the
quickest way to check an arrangement came out the way you meant.

## Rotation

The rotation is the channel's 24/7 backbone: an ordered list of collections
that loops forever. Per entry:

- **1 at a time / multiple (N)** — how many items play before moving to the
  next entry. `Sitcoms ×2 → Movies ×1` gives you two episodes then a movie,
  repeating.
- **Playback order** (defaults to **collection default** — the order set on the
  collection itself):
  - **Your order** — the collection's members in the exact order you arranged
    them, each show expanded into its own episodes in sequence: one show's
    full run, then the next member.
  - **Release order** — oldest first: movies by year, each show's episodes in
    order (S01E01 → S01E02 → …), the shows one after another in your
    arrangement. A movie series added in any order still airs 1978 → 1981 → 1988.
  - **Rotate shows** — round-robin across the shows, in your arrangement: one
    episode from each show in turn. Everything without a show (movies,
    one-offs) shares a single turn, so one show plus fifty movies still splits
    the airtime evenly rather than 1:50.
  - **Rotate shows, mixed** — every show still gets one episode per round, but
    each round is dealt in a new random order (and never opens with the show
    that closed the last one). Episodes stay in sequence. With two shows there's
    nothing to mix, so they alternate.
  - **Shuffle** — every item in random order, re-dealt every time the
    collection is played through, so a second pass isn't the same running order
    as the first.

  In both rotations **each show keeps its own place**: add a show and it starts
  at its first episode while the rest carry on; drop one and it resumes where it
  was if you add it back; reorder them and only whose turn is next changes.

  The random orders derive their deal from the playback position rather than
  storing it, so a guide rebuild reproduces the timeline exactly. (With only two
  or three groups, consecutive passes can land on the same arrangement by
  chance — that's the shuffle being honest, not a stuck seed.)

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
- **Logo override** — a different on-screen watermark while the block airs.
- **"Coming up next" override** — per-block caption settings, including
  turning it off for just this block.

A block's **filler mode** — how leftover time inside it is handled so it ends
on schedule — lives on the **Fillers** tab instead, next to the clips it
governs: **off** (programs may overrun), **between** (filler spread between
programs), or **end** (one filler stretch at the end).

Blocks-only channels (no rotation) are fine, but note that the time *between*
blocks is dead air (black), not filler — only the gaps described under
[Station-ID filler](branding.md#station-id-filler) are filled.

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
