# Changelog

## 0.10.1 — Frosted glass that looks like glass (2026-09-23)

- **Frosted glass that looks like glass.** The frosted-glass filler was
  frosted so heavily that the logos behind it were just smudges. Now the frost is
  light enough to recognise them through, with a more heavily frosted band
  across the middle so your logo still reads cleanly in front. The glass has
  real texture: a slight ripple the logos slide through, a fine grain, a soft
  glow where bright colours scatter, reflections, and a glint of light that
  sweeps across every few seconds. The two panes meet at a seam with a
  shadowed groove and a lit edge, and the logos in front float on a soft
  shadow. Existing frosted fillers rebuild in the new look on their own.
- **Smoother, faster frosted fillers.** The scrolling logos now glide at an
  even pace. Before, the background ran at 25 frames a second inside a 30 fps
  clip, so every sixth frame repeated and the scroll stuttered slightly. A
  frosted filler also generates about a quarter faster, and a preview still
  renders in about a second.

## 0.10.0 — Room to work (2026-09-23)

Channels and the guide on one page, Studio and Settings rebuilt as workspaces,
faster artwork, and a layout that fits any screen.

- **Channels and the TV guide are one page.** Your channels sit four to a row
  at the top, with the full guide right beneath them — spans, zoom and "Now"
  included. The old TV Guide address and the dashboard's "Full guide" link land
  on it.
- **Collections as posters.** A channel's collections open as a list beside the
  selected one, whose members are a poster grid — a show, a season or a movie,
  each with its artwork, year and episode count — instead of a row of tags.
  Drag to reorder, hover to remove; name, order, logo and smart filter moved
  into a Settings dialog, and "What airs" previews the order. A season shows
  its own TMDB poster rather than the show's.
- **Library artwork loads fast.** Tiles and rails ask for a thumbnail sized to
  the tile instead of the full-size poster — a 4 MB local poster becomes a few
  KB — resized once and cached on disk, and TMDB art is fetched at the matching
  size. The random mosaics are unchanged; they just arrive quickly.
- **Studio is an editing suite.** Logos, Audio and Fillers share one layout: a
  section rail, a grid of cards, and an inspector beside it (a dialog on
  smaller screens). A logo's inspector previews its watermark live over a
  frame from your library, in 16:9 or 4:3. Audio tracks play in place and show
  which fillers use them, filler clips preview on hover, and uploads go
  through one drag-and-drop dialog.
- **Settings fill the screen.** The same section rail, with cards laid out
  side by side on a wide screen. Metadata can now fetch or fully re-match a
  library from the page (re-match was API-only), the default watermark has a
  live preview, encoding profiles are a list beside their editor, and
  Maintenance gains an About card with version, uptime and links to the docs.
- **Responsive from phone to 4K.** Every page was checked at phone, tablet,
  laptop, 1080p and 1440p widths: nothing runs off the side of a phone
  anymore, headers and toolbars wrap instead of squeezing, and big monitors
  use their width — wider pages, more cards per row — instead of a narrow
  column. The sidebar starts collapsed on smaller laptops.
- **Dialogs sit above everything.** A dialog opened from inside a page could
  slide under the sticky top bar, hiding its title and close button.

## 0.9.0 — A control room, not a config file (2026-09-22)

A redesign of the whole web app, and a few features that came with it.

- **A new look throughout.** Self-hosted Inter and JetBrains Mono (nothing
  fetched from a font CDN, so a LAN with no internet renders the same), a
  professional icon set, deeper graphite surfaces with a violet accent, and a
  red tally light for anything live. Every page, dialog and control picked it
  up from one set of shared components.
- **A dashboard that shows what's on.** Each live channel is a card over the
  current program's artwork — its TMDB backdrop, or its poster — with a
  progress bar, time left and what's next. Click the picture to watch.
- **A real TV guide.** New **TV Guide** page: every channel on one time axis,
  with the channel column and time ruler pinned, a red now-line through every
  row, 12/24/48-hour spans, three zoom levels, and a title that stays readable
  while a long program scrolls by. Click a program for its details. The
  dashboard and each channel's Guide tab use the same grid (the old strips each
  scrolled separately).
- **Connect a player**, in the top bar: the M3U, XMLTV and HDHomeRun addresses
  with copy buttons, and step-by-step setup for Jellyfin, Plex, Emby and VLC.
- **Search your library from anywhere.** The search box (Ctrl/⌘ K) now finds
  shows and movies as well as pages, channels and settings.
- **Channels as cards**, filterable by on-air and draft, with watch, schedule,
  guide and delete in each card's menu. New channels start in a dialog.
- **Library pages built for browsing.** Library cards are a mosaic of their own
  posters, with a "Recently added" or "Top rated" shelf beneath. Grids have
  search and sort (title, newest, recently added, rating) and load as you
  scroll. Shows open on a full-width backdrop with rating, genres and runtime;
  the detail dialog leads with the artwork.
- **Settings in a sidebar**, Studio's logos and fillers as proper cards, and a
  redesigned first-run checklist.
- **Styled confirmations** replace the browser's grey pop-ups, and deleting a
  logo now asks first.
- **Works on a phone**: the sidebar becomes a drawer and the guide narrows its
  channel column.
- **Artwork works offline.** Show posters and backdrops are served through
  MosaicTV's own TMDB cache instead of loading from image.tmdb.org in the
  browser.
- **A failing request can no longer restart the server.** An error thrown in
  any API handler used to go unhandled, and Node exits on that — dropping every
  stream. It's now logged and answered with a 500.

## 0.8.5 — "Coming up next" that shows up (2026-09-22)

- **"Coming up next" works for movies.** The default template,
  `Coming up next: %showtitle% — %episodetitle%`, fills both tokens from an
  episode — and a movie has neither, so before a movie the caption read a bare
  "Coming up next", naming nothing. `%showtitle%` now names the film for a
  movie (unless the template already does with `%movietitle%` or `%title%`),
  empty brackets like `(%year%)` drop out, and a caption whose tokens all come up
  empty is skipped rather than shown blank.
- **Caption and logo edits reach the screen immediately.** Both are burned in
  when a program starts, so a change used to wait for the next program — on a
  movie channel, up to two hours of "the setting does nothing". Saving now
  re-encodes what's on air from where it is. Only a change to the caption or
  logo does this; renaming a channel or editing its schedule doesn't touch the
  stream.
- **The caption looks past station breaks.** It only appeared when the very
  next item was a program, so with filler between programs it never showed. It
  now names the program after the break.
- **Save sits below the caption settings.** On a channel's General tab the Save
  button was above the "Coming up next" section, which scrolls it out of view
  as soon as you tick the box — easy to configure a caption and leave without
  saving. Save is now at the bottom of the form, with an *Unsaved changes*
  marker beside it.
- **A caption fade of 0 means no fade.** "0 = pop" was stored as the 0.5s
  default, since the check treated zero as missing.
- **Remakes get their own TMDB match.** The movie search filtered by TMDB's
  `year`, which matches any release that year — re-releases included — so the
  2010 *A Nightmare on Elm Street* and the 2019 *The Addams Family* took the
  originals' descriptions and posters. It now searches the film's first
  release year, falling back to the loose match. Titles already matched keep
  their old match until a forced re-fetch (`POST /api/metadata/<id>?force=1`);
  the Metadata button only fills in what's missing.

## 0.8.4 — Fix: 0.8.3 could not start on an existing install (2026-09-22)

- **Fixes a 0.8.3 upgrade that stopped the container from starting.** 0.8.3
  added `Logo.updatedAt` as a required column with no default. The entrypoint
  runs `prisma db push` before the server starts, and SQLite cannot add a NOT
  NULL column with no default to a table that already has rows — so on any
  install with logos, push aborted and MosaicTV never came up:

  > Added the required column `updatedAt` to the `Logo` table without a default
  > value. There are 8 rows in this table, it is not possible to execute this
  > step.

  The column now defaults to the current time, so it backfills. **Do not run
  `--force-reset`** as that message suggests — it drops the database. Pull
  0.8.4 and start normally; your data is untouched, existing logos simply get
  today's date as their last-changed time.
- A schema test now fails the build if an `@updatedAt` column is ever added
  without a default again.

A fresh install was unaffected, as were 0.8.2 and earlier.

## 0.8.3 — Pick your audio, swap your logos (2026-09-22)

- **Channels can prefer an audio language.** Files that carry several audio
  tracks used to air whichever one came first, which on a lot of anime rips is
  the original language or a dub you didn't want — a Cowboy Bebop episode here
  lists two Italian tracks before English. Settings → Streaming → **Audio
  language** sets the preference for the instance, and a channel's General tab
  can override it, so a subtitled anime channel can keep Japanese while
  everything else runs English. A file with no track in that language plays its
  first track rather than going silent. **The default is English**, which is a
  change for anyone whose files led with another language — choose *First
  track* to keep the old behaviour.
- **Replace a logo's image without recreating it.** Studio → Logos →
  **Replace** swaps the picture while keeping the logo's id, name and watermark
  settings — so every channel, block and collection already using it keeps
  using it, instead of needing to be repointed at a new upload. The old file is
  deleted, and the new one shows immediately rather than after the image cache
  expires.
- **Idle channels keep a full guide.** An hourly sweep now tops up every
  channel to the schedule horizon, not just the one being watched. Before this,
  a channel nobody tuned to ran off the end of what was last built and silently
  lost its listings — the XMLTV feed publishes only what exists. Nothing to
  configure; it uses the same horizon setting.

## 0.8.2 — A guide that stays ahead (2026-09-22)

- **Choose how far ahead channels build: 1 day, 2 days, 3 days or a week.**
  Settings → Streaming → **Schedule horizon**. A channel used to build only 4
  hours ahead while it streamed, which is all the guide a player could ever
  show — the XMLTV feed publishes what has been built and nothing more. The
  floor is now a full day, the default 2 days.
- **Channels top up at the halfway mark instead of the last minute.** The
  refill used to wait until under 30 minutes of timeline was left, so listings
  thinned to the next couple of programs before they filled again. A channel
  now rebuilds once less than half its horizon remains, and so never publishes
  less than half of it while anyone is watching.
- **The Build button says what it will build.** It follows the horizon ("Build
  2d") rather than always claiming 48 hours, and the same setting is the
  default for `POST /api/channels/:id/build` when no `?hours=` is given.

Note: a channel nobody is watching still keeps whatever was last built —
nothing rebuilds it on a timer yet. Press Build on its Guide tab, or watch it
for a moment, to bring it current.

## 0.8.1 — Rotations that keep every show (2026-09-22)

- **A rotation no longer thins out to whichever show has the most episodes.**
  "Round-robin across shows" dropped a show from the rotation the moment its
  last episode aired, handing its slot to the shows that still had episodes
  left. A block pairing a 19-episode show with a 200-episode one would start
  balanced and decay until the long show was playing alone. Every show now
  returns to its first episode and keeps its turn, so the split stays even for
  as long as the channel runs. Chronological, shuffle and shuffle-by-show are
  unchanged.
- **Release tags no longer leak into the guide.** Quality tags were only
  stripped from a title when the whole parenthetical was a single token, so
  "(HD)" came off but "(Bluray-1080p x265)", "(480p x265 EDGE2020)", "(MPEG2)"
  and "(XviD)" rode along into the channel guide. A parenthetical is now
  removed when everything inside it is release metadata — resolution, source,
  codec, audio, and a release group's tag next to them. Parentheticals that
  carry meaning are left alone: "(Unaired Pilot)", "(Colorized)", "(Director's
  Cut 1992)", the "(US)" in a show's name, and the "(1)"/"(2)" that number a
  two-parter.
- **A re-scan picks up parser fixes without re-probing your library.** An
  ordinary scan skipped unchanged files outright, so a better title only
  reached items you had re-added. A scan now also compares the name it parses
  against what is stored, and rewrites the row from the cached probe when they
  differ — no ffprobe pass, no forced re-scan. Scan your libraries once after
  updating to clean up the titles above.

## 0.8.0 — A bigger filler studio (2026-07-22)

- **Fillers render at 1080p by default, with a resolution choice per filler.**
  Generated idents were always built on a 720p canvas and then upscaled to
  whatever the channel outputs — soft on a Full-HD channel. Each filler now
  carries a resolution (720p · 1080p · 1440p, new default 1080p), so the source
  is as sharp as the channel it airs on. Playback still scales to the channel
  profile; a higher source only removes the upscale. Existing fillers move to
  1080p and rebuild themselves the next time they're warmed.
- **A second polished ident: Spotlight.** A calmer counterpart to the frosted
  glass look — the channel logo on a softly lit glass card with a gleam that
  sweeps across it, the MosaicTV wordmark resting below a hairline divider.
  Pick it under a filler's **Visual**, same as frosted.
- **A logo size control for the branded styles.** Frosted and Spotlight (and the
  retired logo styles) take a **Logo size** slider, 40–200%, so a small
  wordmark can be brought up or a busy logo eased back without editing artwork.
  It scales the channel logo only — the MosaicTV mark stays put.
- **Preview a still frame before committing to a full clip.** The filler form
  has a **Preview image** button that renders a single frame of exactly what
  would air — style, logo, size and resolution — in a second or two, so you can
  judge the look without waiting on (or generating) a whole clip. The frame is
  streamed straight to the browser and never written to your library.
- **Deleting or restyling a filler now clears the clips it left on disk.**
  Removing a filler from the Studio used to delete the preview asset but leave
  its cached renders (one per channel logo, duration and resolution) piling up
  in the data directory. Those are now swept when a filler is deleted or its
  look is changed, and orphaned still-preview frames are cleared at startup.

## 0.7.5 — Streams pace to real time (2026-07-22)

- **Programs no longer race ahead of the clock and leave the channel sitting on
  a station ident.** 0.7.4 stopped a program that finished early from replaying
  its own ending, but that treated the symptom: a program whose encoder ran
  faster than real time still burned through its entire slot in seconds, and the
  rest of the slot was filled with the looping ident — once, more than twenty
  minutes of it after a short game show, with the next block starting late. Each
  program (and the ident itself) is now paced to real time as it encodes, so it
  plays for its full slot and the 0.7.4 hold goes back to being the rare safety
  net it was meant to be. (The encoder used to be held back only by how fast the
  player pulled frames from it. On the shared HLS stream, which writes segments
  to disk, nothing pulled back — so a cheap-to-decode episode could encode more
  than 20x faster than real time and run its whole slot out in under a minute.
  Measured: a clip that encoded in ~5s unpaced now takes its full ~60s.)
- **Smoother playback across program boundaries — most visibly on stricter
  players like Chromecast.** The seams between programs were where the stream
  stalled; a Chromecast casting the Jellyfin live-TV tuner is the least forgiving
  of that and could fail to load a channel where a phone or browser rode through.
  Pacing the encoder removes those stalls at the seams. The picture itself was
  always fine — the breaks only ever happened at the transitions.

## 0.7.4 — No replayed episode endings (2026-07-22)

- **A program no longer re-airs its own ending when its encoder briefly outruns
  the clock.** Each program is encoded on demand and paced to real time by the
  channel's outer stream; if a program happened to finish a little ahead of its
  scheduled slot, the stream looped back onto that same slot and re-served the
  program's tail — so a viewer saw the show reach its credits, cut to black, then
  resume near the end and play through the credits a second time before the next
  program began. (Seen on a 10-bit HEVC Rugrats double-episode that ran ~5
  minutes ahead on the shared HLS stream; the source file was intact — the
  encoder had simply raced the meter.) The stream now remembers when a program
  runs to a clean finish and, if it's asked to air that same slot again before
  the wall clock has reached its end, holds the remainder instead of replaying —
  so the schedule stays put and the next program still starts on time. The same
  guard also covers a file that is genuinely shorter than the slot it was given.
- **A slot held that way plays the channel's station ident, not black** — the
  frosted-glass logo card, looped for the remainder of the slot, falling back to
  black only if the ident can't be built.

## 0.7.3 — Broadcast episodes (2026-07-22)

- **Segments that aired as one program can be grouped into a single broadcast
  episode.** Shorts-based cartoons — Dexter's Laboratory's three segments, 2
  Stupid Dogs — were scanned as separate files and played, shuffled and listed
  as separate programs. On a show's season you can now open **Group broadcast
  episodes** and fold the parts that aired together into one unit: they play
  back-to-back, count as a single program to block-packing, shuffle and the
  guide, and show as one entry. Grouping is metadata only — your files keep
  their real S/E numbering and nothing on disk is touched — and a **Suggest
  groupings** pass packs consecutive episodes toward an 11/22/30-minute slot to
  start from.
- **A broadcast episode can borrow a segment from another show.** Some blocks
  wove a short from a different series in — a Secret Squirrel short inside 2
  Stupid Dogs. **Add segment from another show** searches the whole library and
  drops the chosen short into the running order, where you reorder it against
  the rest. It then plays inside that broadcast episode wherever the host show
  airs.
- **You can see what's grouped without re-opening the editor.** A season's
  episode list now marks each grouped file — *Broadcast ep 3 · 1/2* — and a
  borrowed short renders inline, indented beneath the episode it followed, so
  the full running order reads at a glance instead of only inside the editor.
- **A show tells you when its episodes air inside other shows.** Viewing Secret
  Squirrel, a banner and a per-episode **Airs in 2 Stupid Dogs** badge now flag
  the shorts that only air woven into another series' broadcast — the reverse of
  the borrowing you set up on the host, so a borrowed short is visible from both
  sides.
- **A short borrowed into more than one show airs inside each.** Reusing the
  same segment across two hosts — Secret Squirrel in 2 Stupid Dogs *and* a
  custom block built around Dexter's Laboratory — now plays it in both, rather
  than the schedule silently dropping it from the second. An episode a broadcast
  episode has already claimed still won't also air loose on its own, so a
  grouped multi-part episode never re-airs as its separate parts; and a borrowed
  short now wins over its standalone copy deterministically instead of the
  outcome depending on rotation order.

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
