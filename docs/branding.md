# Branding: Logos, Watermarks & Filler

The touches that make a channel feel like a real station: an on-screen bug in
the corner, station-ID filler between programs, and "coming up next" captions.

## Logos

Upload logos on the **Logos** page (PNG with transparency looks best). Uploaded
logos are stored in your data volume and can be assigned to:

- a **channel** (General tab) — used in players' guides (M3U `tvg-logo` +
  XMLTV icon) *and* as the default on-screen watermark;
- a **time block** (Schedule tab) — overrides the on-screen logo while that
  block airs.

Priority on screen: **block logo → channel logo**.

## Watermark behavior

**Settings → Default watermark** controls how the on-screen logo is drawn:

- **Mode** — `permanent` (always on), `intermittent` (appears every N minutes
  for a set duration, with fade in/out), or `none`.
- **Position** — any corner; margins in percent.
- **Size** — width as a percent of the frame.
- **Opacity** — see-through like a real station bug.
- **Intermittent timing** — frequency (minutes), on-screen duration (seconds),
  fade time (seconds).

The watermark hides during filler by default, fading across the boundary.

## Station-ID filler

Filler is what plays in the gaps the schedule opens for it:

- Between (or at the end of) the programs inside a time block, so the block
  ends exactly on schedule — controlled by that block's **filler mode**.
- Before a **hard-start** block, so it begins exactly on time.

Nothing else creates a filler slot. In particular, the time between blocks on
a blocks-only channel is dead air (black), and a rotation-only channel never
plays filler at all — the channel editor warns you when that's the case.

Configure it per channel on the **Fillers** tab:

- **Filler mode** — per block, whether it fills its leftover time (off /
  between programs / at the end).
- **Channel default** — the clips used in any slot where the active block has
  none of its own.
- **Per-block filler** — a block can override that with its own set.

Assign more than one and each gap plays one of them, rotating by start time.
Fillers come from a shared library that lives under **Studio → Fillers**; the
**+ New filler** button on the Fillers tab creates one and assigns it without
leaving the channel.

### The library

**Studio → Fillers** holds every filler in one list, with two ways to add one:

- **Upload clip** — your own bumper or ident reel. The upload and the filler
  that wraps it are created together; there's no separate step to "register"
  the file. (Deleting the filler removes the clip too, unless another filler
  shares it.)
- **+ Add filler** — a generated station ID built from a channel's logo.

Anything uploaded that no filler uses shows under **Unused clips** at the
bottom of the list, so nothing becomes unreachable — normally it's empty.

### Filler styles

Filler clips are **generated for you** in one of several styles — each
composites the channel's (or block's) logo into an animated station-ID loop:

| Style | Look | Uses your logo |
| ----- | ---- | -------------- |
| `frosted` | Frosted-glass scene: scrolling logo rows behind, logo in front | ✅ |
| `custom` | **Your own clip** — bumpers, ident reels, anything | your call |

Earlier builds also offered `logowall`, `pulse`, `animated`, `retro` and
`vintage`. Only the polished frosted-glass ident ships today; existing fillers
on a retired style keep playing and stay editable, but new ones can't pick it.
(`animated` also remains the internal fallback whenever a branded clip can't be
built.)

You can attach an **audio track** to have the music baked in and the clip
length matched to it.

**Generating is for previewing.** A filler plays on air whether or not you ever
press it — the clip is built and cached on demand. Because a generated style
composites *the logo of wherever it's playing*, one filler renders differently
per channel, so the library's **Preview as** selector picks which channel's
branding to build; without one it uses wherever the filler is first assigned.
The result is discarded automatically when you edit the filler, so a preview
never shows stale settings.

Generation runs **on the server**, not in the page: the progress bar shows a
percentage, and leaving the Studio page (or reloading) doesn't cancel anything —
come back and the bar picks up where the build actually is, or shows the
finished clip.

Filler is looped/trimmed to exactly fill each gap, so blocks always land on
their boundaries. The watermark stays off during filler; "coming up next"
captions never show on filler either.

## "Coming up next" captions

A caption burned into the last stretch of a program announcing what's next.

- **Channel-wide**: General tab → Coming up next.
- **Per block**: Schedule tab → edit a block → override (including turning it
  off for that block only).

Captions apply to programs from both rotation and blocks — never to filler.
