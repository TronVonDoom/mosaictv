# Branding: Logos, Watermarks & Filler

The touches that make a channel feel like a real station: an on-screen bug in
the corner, station-ID filler between programs, and "up next" cards.

## Logos

Upload logos under **Studio → Logos** (PNG with transparency looks best).
Uploaded logos are stored in your data volume and can be assigned to:

- a **channel** (General tab) — used in players' guides (M3U `tvg-logo` +
  XMLTV icon) *and* as the default on-screen watermark;
- a **time block** (Schedule tab) — overrides the on-screen logo while that
  block airs.

Priority on screen: **block logo → channel logo**.

Click a logo to open it in the inspector: rename it, replace its image, or give
it its own watermark settings. The preview shows the bug over a frame from your
library, in 16:9 or 4:3, as you change them.

## Watermark behavior

**Settings → Watermark** sets how the on-screen logo is drawn, for any logo
without watermark settings of its own (with the same live preview):

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

Nothing else creates a filler slot, and a rotation-only channel never plays
filler at all — the channel editor warns you when that's the case.

The stream also falls back on the channel's filler (its **station ident**)
whenever it has nothing else to show, instead of going to black:

- the time between blocks on a blocks-only channel;
- the rest of a slot whose file turned out shorter than its listing;
- a program that can't be played at all (see
  [Troubleshooting](troubleshooting.md#a-program-shows-the-station-ident-instead)).

Configure it per channel on the **Fillers** tab:

- **Filler mode** — per block, whether it fills its leftover time (off /
  between programs / at the end).
- **Channel default** — the clips used in any slot where the active block has
  none of its own.
- **Per-block filler** — a block can override that with its own set.

A channel with no filler of its own uses the **default station ident**, set
under **Studio → Fillers** from a filler's ⋯ menu (**Make default station
ident**). With none set, it uses a frosted-glass ident built from the
channel's logo. A generated default is still branded with each channel's own
logo, unless the filler pins a logo of its own.

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
- **New filler** — a generated station ID built from a channel's logo.

Anything uploaded that no filler uses shows under **Unused clips** at the
bottom of the list, so nothing becomes unreachable — normally it's empty.

### Filler styles

Filler clips are **generated for you** in one of several styles — each
composites the channel's (or block's) logo into an animated station-ID loop:

| Style | Look | Uses your logo |
| ----- | ---- | -------------- |
| `frosted` | Frosted glass: rows of logos glide behind it, still recognisable through the frost, with out-of-focus lights drifting up at different depths. A more heavily frosted band sits behind your logo, which floats in front on a soft shadow, and light plays across the glass as it runs. Tick **Divider between the halves** for a lit glass seam between your logo and the MosaicTV mark | ✅ |
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
their boundaries. The watermark stays off during filler; "up next" cards
never show on filler either.

## "Up next" cards

Near the end of a program, a card slides in naming what's on next: the next
program's poster, its title, the episode (`S1 · E4`) and episode title, and
its year, genres and rating, under an **UP NEXT** label with the time it
starts. A movie shows its runtime instead of an episode.

There are two styles:

- **Glass** — a frosted panel: the picture behind it is blurred, so it reads on
  a bright cartoon as well as a dark film.
- **Broadcast** — a cable-network bar: the poster stands up out of a dark bar,
  an angled **UP NEXT** tab and the time sit on its top edge, and the bar fades
  out toward the middle of the picture. On the right-hand side it's mirrored.

- **Channel-wide**: General tab → Coming up next.
- **Per block**: Schedule tab → edit a block → override (including turning it
  off for that block only).

The settings show a preview: the card your channel's next program would get,
drawn exactly as it airs, over a still from what's on now, with your channel's
logo where its watermark sits — so you can see at a glance if the card would
cover it. It follows your changes before you save.

Cards appear over programs from both rotation and blocks, never over filler. A
station break between two programs doesn't hide the card: it names the
program after the break.

**Broadcast episodes.** A multi-segment episode (Dexter's three shorts, say)
gets one card, timed against the whole episode, not one per segment. The card
announcing it lists every segment, e.g. `S1 · E4–6` and "Dexter Dodgeball /
Dial M for Monkey - Rasslor / Dexter's Assistant", and the card at its end
names the program after it.

**Long titles** are cut at a word with an ellipsis rather than running across
the screen, and a leading episode code the filename left on an episode title
("E03 - …") is dropped, since the card shows the code on its own.

**Timing.** *Before it ends* shows it once, the lead time before the program
ends (default 5 minutes, 12 seconds on screen); *Middle* once at the halfway
point; *Both* does both. On a movie channel the 5-minute mark usually lands in
the end credits, which is where broadcasters put theirs too. **Slide in** is
how long the entrance (and exit) takes; 0 pops it on and off.

**Position.** Eight spots around the picture: the four corners, the middle of
the top and bottom edges, and the middle of the left and right sides. Pick one
clear of your logo — if the watermark sits bottom-left, put the card
bottom-right. It slides in from its nearest edge (from the side, or up from
the bottom / down from the top for the middle positions). The card sits on the
picture itself, so on a 4:3 show pillarboxed into a 16:9 channel it stays on
the image, not out on the black bars. Three sizes.

**Saving applies it to what's on air.** The card and the logo are burned in
when a program starts, so on save the channel re-encodes the current program
from where it is — a viewer skips a couple of seconds, the same as at any
program change. Other edits (name, group, schedule) never interrupt the stream.

### "Now playing" on music videos

A music video gets the same card for its first dozen seconds, headed **NOW
PLAYING**: the song, the artist and album, the year, and the album art when
the library has some. It uses the channel's card style, position and size.
