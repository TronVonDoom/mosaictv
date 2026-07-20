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

Filler is what plays in the gaps: between programs inside a time block (so the
block ends exactly on schedule), before a hard-start block, and between blocks
on blocks-only channels.

Configure it per channel on the **Fillers** tab:

- **Channel default** — plays in any gap unless a block overrides it.
- **Per-block filler** — each time block can have its own set.

### Filler styles

Filler clips are **generated for you** in one of several styles — each
composites the channel's (or block's) logo into an animated station-ID loop:

| Style | Look | Uses your logo |
| ----- | ---- | -------------- |
| `frosted` | Frosted-glass scene: scrolling logo rows behind, logo in front | ✅ |
| `logowall` | Tiled wall of the logo | ✅ |
| `pulse` | Logo centered on a dark gradient that slowly breathes | ✅ |
| `animated` | Drifting color gradient with a slow hue sway — "please stand by" | – |
| `retro` | Retro broadcast look, logo-free | – |
| `vintage` | Vintage look, logo-free | – |
| `custom` | **Your own clip** — bumpers, ident reels, anything | your call |

(For logo-free styles the live watermark still overlays during program
playback — it just stays off during the filler itself.)

Generation runs in the background with a progress indicator; clips are saved
as assets and reused. You can attach an **audio track** to have the music baked
in and the clip length matched to it.

Filler is looped/trimmed to exactly fill each gap, so blocks always land on
their boundaries. The watermark stays off during filler; "coming up next"
captions never show on filler either.

## "Coming up next" captions

A caption burned into the last stretch of a program announcing what's next.

- **Channel-wide**: General tab → Coming up next.
- **Per block**: Schedule tab → edit a block → override (including turning it
  off for that block only).

Captions apply to programs from both rotation and blocks — never to filler.
