// The streaming core: one single-stage HLS segmenter per channel (the ErsatzTV
// model). A per-channel producer walks the deterministic playout timeline and
// runs ONE ffmpeg per item that encodes straight to on-disk HLS segments; this
// module owns the channel's master playlist, stitching each item's child
// segments into one live playlist with an EXT-X-DISCONTINUITY at every program
// boundary. Players reset their decoder on the discontinuity, so the seam
// hazards of the old three-stage concat pipeline it replaced (double-meter
// freeze, wall-clock replay) cannot happen here.
//
// No second ffmpeg, no HTTP loopback for media, no self-referential concat. The
// MPEG-TS / HDHomeRun path is a thin `-c copy` wrapper that reads this
// playlist, so every output shares the one encode stage.
//
// This is the channel's only streaming pipeline; the shared low-level helpers it
// leans on live in pipe.ts.

import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Request, Response } from 'express'
import { prisma } from '../db.js'
import { hlsDir, logosDir } from '../paths.js'
import { log } from '../logs.js'
import { markEvent } from '../metrics.js'
import { topUpPlayout } from '../playout.js'
import { clientIp, clientName, closeSession, openSession, type Session } from '../sessions.js'
import { ensureChannelReady, pipeSegment } from './pipe.js'
import { resolveProfile } from './profile.js'
import { loadWatermark, parseWatermark, type WatermarkConfig } from './overlays.js'
import { detectReadrateBurst, resolveEncoder } from './capabilities.js'
import { blackArgs, type FfmpegOutput } from './filters.js'
import { loadDefaultFiller } from './filler.js'
import { buildItemArgs, type BuildItemParams, type ChannelForBuild, type PlayoutItemForBuild } from './itemBuild.js'

// ready = playlist has segments; starting = warming up; unavailable = no channel/schedule.
export type HlsStatus = 'ready' | 'starting' | 'unavailable'

const SEGMENT_SEC = 4
// ~2.7 min of live window. Deep enough that a raw-HLS client (e.g. Jellyfin's
// tuner ffmpeg) that stalls briefly can still fetch where it left off rather
// than 404ing off the back of the window and wedging permanently — unlike the
// mpegts wrapper, it has no jump-to-live of its own. The wrapper rides only ~3
// segments back regardless of how deep this is (see -live_start_index below).
const WINDOW_SEGMENTS = 40
const READY_MIN_SEGS = 2 // serve the playlist once it holds this many segments
const READY_TIMEOUT_MS = 12_000 // report "starting" if not ready within this
const POLL_MS = 300 // how often to sweep an item's child playlist for finished segments
const IDLE_GRACE_MS = 30_000 // stop the producer this long after the last request
const VIEWER_WINDOW_MS = 20_000 // an IP seen within this window counts as watching
// An item that encodes this much less than its slot and exits cleanly hit the
// end of its file — the file is shorter than the slot. Hold the remainder
// rather than re-attempting an instant-EOF program.
const EARLY_EXIT_MARGIN_SEC = 5
const HOLD_CHUNK_SEC = 30 // fill dead air / short-file remainder in chunks this big

// The producer runs a few seconds ahead of the schedule. It keeps its own
// place on the timeline (the cursor) instead of reading the wall clock, meters
// every encode at real time, and starts each one with a read burst sized to top
// that lead back up. The lead is the buffer a player lives on while the next
// item's encoder spins up, and it's what makes tuning in fast: a cold channel
// bursts its first segments instead of encoding them in real time.
const LEAD_SEC = 8
// A burst never runs further ahead than this (a cold start or a recovery).
const MAX_BURST_SEC = 14
// Fallen further behind the schedule than this — an encoder slower than real
// time, a long stall — jump to the clock rather than air an ever-later
// schedule. Without burst support nothing can win the lead back, so the
// producer never lags at all (see maxLagMs).
const MAX_LAG_SEC = 6
// A live per-item encoder produces a segment every SEGMENT_SEC. One that hangs —
// no segment yet never exits (a wedged nvdec, a pathological file) — would stall
// the producer loop forever, freezing every viewer with no way back. Past this
// long with no new segment while the process is still alive, it's wedged, not
// slow: force-kill it so the timeline can advance. Well above the ~one segment of
// wall time the first output legitimately takes to finalize.
const PRODUCER_STALL_SEC = 15

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// One segment in the master playlist. `seq` is the global monotonic index and
// the on-disk name (seg_{seq}.ts); `disc` marks an item boundary the player
// resets on; `pdt` is the scheduled program-date-time on the first segment of
// each run (for guide alignment).
type MasterSeg = { seq: number; durSec: number; disc: boolean; pdt?: string }

// Bookkeeping for one item's ffmpeg run and its child playlist. `startMs` is
// where the run's first frame sits on the schedule; `encodedSec` is how much
// of it has landed in the master playlist.
type Run = { dir: string; playlist: string; ingested: number; firstOfRun: boolean; startMs: number; encodedSec: number }

// How one encode ended. `restyled` = we killed it to re-encode with a new look;
// `stalled` = the watchdog killed it for producing nothing.
type EncodeResult = { code: number | null; stalled: boolean; restyled: boolean; encodedSec: number }

// What an item that failed to play has tried so far. A GPU failure earns one
// retry on the CPU; after that (or once a file turns out shorter than its slot)
// the rest of the slot is held rather than re-attempted.
type Attempt = { stopMs: number; cpu: boolean; hold?: string }

// Everything the per-item build needs about the channel, loaded once per item.
type ItemContext = Omit<
  BuildItemParams,
  'item' | 'next' | 'nextProgram' | 'prevKind' | 'offset' | 'segDur' | 'output' | 'readrate' | 'tag'
>

/** A filler slot standing in for the station ident while a slot is held. */
function identItem(channelId: number, startMs: number, stopMs: number): PlayoutItemForBuild {
  return {
    id: -1,
    channelId,
    mediaItemId: null,
    kind: 'filler',
    title: 'Station ident',
    startTime: new Date(startMs),
    stopTime: new Date(stopMs),
    groupKey: null,
    mediaItem: null,
  }
}

class ChannelSegmenter {
  readonly n: number
  readonly dir: string
  readonly workDir: string
  proc: ChildProcess | null = null
  running = false
  lastAccess = Date.now()
  viewers = new Map<string, number>() // ip -> last-seen ms
  session: Session | null = null

  private segs: MasterSeg[] = []
  private nextSeq = 0
  private discontSeq = 0 // count of discontinuities evicted from the front
  private emittedAny = false
  private runSeq = 0
  private loop: Promise<void> | null = null
  private restyled = false // the running encoder was killed by restyle()
  // Where the next frame sits on the schedule (epoch ms): the end of everything
  // encoded so far. Runs ~LEAD_SEC ahead of the wall clock.
  private cursor = 0
  private attempts = new Map<number, Attempt>() // playout item id -> what it has tried

  constructor(n: number) {
    this.n = n
    this.dir = path.join(hlsDir(), String(n))
    this.workDir = path.join(this.dir, 'work')
  }

  get tag(): string | undefined {
    return this.session?.tag
  }

  /** Spin up the producer and wait (briefly) for the playlist to be servable. */
  async start(): Promise<HlsStatus> {
    if (!(await ensureChannelReady(this.n))) return 'unavailable'
    fs.rmSync(this.dir, { recursive: true, force: true })
    fs.mkdirSync(this.workDir, { recursive: true })
    this.session = openSession(this.n, 'hls')
    this.running = true
    this.cursor = Date.now() // tune in at the live point; the first burst builds the lead
    this.loop = this.runLoop().catch((e) =>
      log('error', 'stream', `Channel ${this.n} segmenter loop crashed`, String(e?.stack || e), this.tag),
    )
    const end = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < end) {
      if (!this.running) return 'unavailable'
      if (this.segs.length >= READY_MIN_SEGS) {
        log('info', 'stream', `▶ Channel ${this.n} segmenter started (single-stage, shared across viewers)`, undefined, this.tag)
        return 'ready'
      }
      await sleep(150)
    }
    return 'starting'
  }

  stop(): void {
    this.running = false
    this.proc?.kill('SIGKILL')
    this.proc = null
    if (this.session) closeSession(this.session.id)
    fs.rm(this.dir, { recursive: true, force: true }, () => {})
  }

  ready(): boolean {
    return this.segs.length >= READY_MIN_SEGS
  }

  /**
   * Re-encode what's on air with the channel's current look. An item bakes its
   * overlays (coming-up caption, logo) into the encode when it starts, so an
   * edit would otherwise wait for the next program — up to a whole movie, which
   * reads as "the setting does nothing". Killing the encoder hands control back
   * to the producer loop, which reloads the channel and resumes the same item
   * from the end of its last finished segment, and the player resets at a
   * discontinuity as at any item boundary. The new look reaches the screen once
   * the few seconds already buffered ahead have played.
   */
  restyle(): boolean {
    if (!this.running || !this.proc) return false
    this.restyled = true
    this.proc.kill('SIGKILL')
    return true
  }

  playlistFile(): string {
    return path.join(this.dir, 'index.m3u8')
  }

  // ── The producer loop ──────────────────────────────────────────────────────
  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.produceNext()
      } catch (e) {
        log('warn', 'stream', `Channel ${this.n} segmenter iteration failed — retrying`, String((e as Error)?.stack || e), this.tag)
        await sleep(500)
      }
    }
  }

  private async produceNext(): Promise<void> {
    // Behind the schedule by more than a hiccup: jump to the clock.
    const now = Date.now()
    const lagMs = now - this.cursor
    if (lagMs > (await this.maxLagMs())) {
      if (this.emittedAny && lagMs > 1000) {
        log('info', 'stream', `Ch ${this.n}: ${(lagMs / 1000).toFixed(1)}s behind the schedule — skipping ahead to catch up`, undefined, this.tag)
      }
      this.cursor = now
    }
    // Comfortably ahead already (nothing unmetered should get here, but never
    // race the clock): wait for it rather than encode further ahead.
    const aheadMs = this.cursor - now - (LEAD_SEC + 2) * 1000
    if (aheadMs > 0) {
      await sleep(Math.min(aheadMs, 1000))
      return
    }
    const at = this.cursor
    for (const [id, a] of this.attempts) if (a.stopMs <= at) this.attempts.delete(id)

    // Load channel + config fresh each item so schedule/logo/watermark edits go
    // live from the next item on.
    const channel = await prisma.channel.findFirst({
      where: { number: this.n },
      include: {
        timeBlocks: { include: { collection: true, fillerAssignments: { include: { filler: true }, orderBy: { order: 'asc' } } } },
        fillerAssignments: { include: { filler: true }, orderBy: { order: 'asc' } },
        rotationItems: true,
        profile: true,
      },
    })
    if (!channel) {
      this.running = false
      return
    }
    // Keep the timeline built ~ahead; nothing scheduled ends the producer.
    if (!(await this.ensurePlayout(channel))) {
      this.running = false
      return
    }

    const profile = resolveProfile(channel.profile)
    const defaultWm = await loadWatermark()
    const logos = await prisma.logo.findMany()
    const ctx: ItemContext = {
      channelNumber: this.n,
      channel: channel as unknown as ChannelForBuild,
      profile,
      enc: await resolveEncoder(profile.hwaccel),
      defaultWm,
      logoPath: new Map<number, string>(logos.map((l) => [l.id, path.join(logosDir(), l.filename)])),
      logoWm: new Map<number, WatermarkConfig>(logos.map((l) => [l.id, parseWatermark(l.watermark, defaultWm)])),
      defaultFiller: await loadDefaultFiller(),
    }

    // Enough look-ahead to see past a station break to the program after it.
    const items = (await prisma.playoutItem.findMany({
      where: { channelId: channel.id, stopTime: { gt: new Date(at) } },
      orderBy: { startTime: 'asc' },
      take: 4,
      include: { mediaItem: true },
    })) as PlayoutItemForBuild[]

    if (items.length === 0) {
      // Playout exhausted (should be rare — we extend above). Keep the session
      // alive with a short hold; the next iteration rebuilds.
      await this.hold(ctx, at + 2000, 'playout exhausted')
      return
    }

    const item = items[0]
    const startMs = item.startTime.getTime()
    const stopMs = item.stopTime.getTime()
    // Not on air yet: dead air until the next scheduled item (blocks-only gap).
    if (startMs > at) {
      if (startMs - at < 500) this.cursor = startMs
      else await this.hold(ctx, Math.min(startMs, at + HOLD_CHUNK_SEC * 1000), 'dead air until the next program')
      return
    }
    // A sliver too short to be worth an encode: step over it.
    if (stopMs - at < 500) {
      this.cursor = stopMs
      return
    }
    const attempt = this.attempts.get(item.id)
    if (attempt?.hold) {
      await this.hold(ctx, Math.min(stopMs, at + HOLD_CHUNK_SEC * 1000), attempt.hold, item.kind === 'filler', attempt.cpu)
      return
    }

    const next = items[1]
    const nextProgram = items.slice(1).find((it) => it.kind === 'program' && it.mediaItem)
    const prevRow = await prisma.playoutItem.findFirst({
      where: { channelId: channel.id, stopTime: { lte: new Date(at) } },
      orderBy: { stopTime: 'desc' },
      select: { kind: true },
    })
    const offset = Math.max(0, (at - startMs) / 1000)
    const segDur = (stopMs - at) / 1000
    // After a GPU failure this item gets one go on the CPU: CPU encode, which
    // also turns off GPU decode.
    const enc = attempt?.cpu ? 'libx264' : ctx.enc

    const built = await buildItemArgs({
      ...ctx,
      enc,
      item,
      next,
      nextProgram,
      prevKind: prevRow?.kind,
      offset,
      segDur,
      output: this.hlsOutput(),
      readrate: await this.readrate(),
      tag: this.tag,
    })

    if (built.kind === 'black') {
      this.attempts.set(item.id, { stopMs, cpu: attempt?.cpu ?? false, hold: built.why })
      return
    }

    log(
      'info',
      'stream',
      `Ch ${this.n} ▶ ${built.label}${offset > 1 ? ` (resuming at ${Math.round(offset)}s)` : ''}`,
      `decode ${built.hwDecode ? 'GPU (nvdec)' : 'CPU'}, encode ${enc}, ${built.wmDesc}, lead ${((at - Date.now()) / 1000).toFixed(1)}s`,
      this.tag,
    )
    markEvent(this.n, item.kind === 'filler' ? 'filler' : item.mediaItem?.type === 'music' ? 'song' : 'program', built.label, enc)

    const res = await this.encodeToMaster(built.args, built.label, built.captionFiles, at)
    if (!this.running || res.restyled) return

    // It failed outright, or the watchdog found it wedged. Relaunching the same
    // command would fail the same way — the old loop did, many times a second,
    // for the whole slot. Give a GPU encode one retry on the CPU (a GPU out of
    // encode sessions, a file its decoder chokes on), then hold the rest of
    // the slot with the station ident.
    if (res.stalled || res.code !== 0) {
      const why = res.stalled ? 'stalled' : `exited ${res.code ?? 'before starting'}`
      if (!attempt?.cpu && (enc !== 'libx264' || built.hwDecode)) {
        this.attempts.set(item.id, { stopMs, cpu: true })
        log('warn', 'stream', `Ch ${this.n}: ${built.label} ${why} on the GPU — retrying it on the CPU`, undefined, this.tag)
      } else {
        this.attempts.set(item.id, { stopMs, cpu: true, hold: `${built.label} could not be played` })
        log('warn', 'stream', `Ch ${this.n}: ${built.label} ${why} — holding the rest of its slot with the station ident`, undefined, this.tag)
      }
      return
    }

    // It exited cleanly well short of its slot (or with nothing at all): the
    // file is shorter than the slot. Hold the remainder so the next program
    // still starts on time, instead of re-attempting an instant-EOF program.
    if (res.encodedSec < 0.5 || res.encodedSec < segDur - EARLY_EXIT_MARGIN_SEC) {
      const short = Math.round(segDur - res.encodedSec)
      this.attempts.set(item.id, { stopMs, cpu: attempt?.cpu ?? false, hold: `${built.label} ended ${short}s early` })
      if (short > 1) log('info', 'stream', `Ch ${this.n}: ${built.label} ended ${short}s before its slot — holding to stay on schedule`, undefined, this.tag)
    }
  }

  /**
   * Fill the schedule from the cursor toward `untilMs` with what the channel
   * airs in a break — its station ident — falling back to black on the CPU when
   * that can't be built or played. One chunk per call (HOLD_CHUNK_SEC at most);
   * the loop comes back for the rest, so schedule edits land between chunks.
   * `skipIdent` is for a filler slot that failed: its ident would fail too.
   */
  private async hold(ctx: ItemContext, untilMs: number, why: string, skipIdent = false, cpu = false): Promise<void> {
    const at = this.cursor
    const sec = Math.min((untilMs - at) / 1000, HOLD_CHUNK_SEC)
    if (sec < 0.5) {
      this.cursor = Math.max(at, untilMs)
      return
    }
    if (!skipIdent) {
      const ident = await buildItemArgs({
        ...ctx,
        enc: cpu ? 'libx264' : ctx.enc,
        item: identItem(ctx.channel.id, at, at + sec * 1000),
        next: undefined,
        nextProgram: undefined,
        prevKind: undefined,
        offset: 0,
        segDur: sec,
        output: this.hlsOutput(),
        readrate: await this.readrate(),
        tag: this.tag,
      })
      if (ident.kind === 'encode') {
        log('debug', 'stream', `Ch ${this.n}: station ident for ${sec.toFixed(0)}s (${why})`, ident.label, this.tag)
        const res = await this.encodeToMaster(ident.args, `station ident (${why})`, ident.captionFiles, at)
        if (res.encodedSec >= 0.5 || res.restyled || !this.running) return
      }
    }
    const res = await this.encodeToMaster(
      blackArgs(ctx.profile, 'libx264', sec, this.hlsOutput(), await this.readrate()),
      `black (${why})`,
      [],
      at,
    )
    if (res.encodedSec < 0.5 && !res.restyled && this.running) {
      // Not even black could be encoded (ffmpeg itself is failing). Step the
      // schedule past this chunk and let the clock catch up rather than spin.
      this.cursor = at + sec * 1000
      await sleep(1000)
    }
  }

  /** The read meter for the next encode: real time, plus a burst that tops the lead back up to LEAD_SEC. */
  private async readrate(): Promise<string[]> {
    if (!(await detectReadrateBurst())) return ['-readrate', '1.0']
    // Always explicit, zero included: left out, ffmpeg's own 0.5s default
    // applies, and the lead creeps up by that much a program.
    const burst = Math.max(0, Math.min(MAX_BURST_SEC, LEAD_SEC - (this.cursor - Date.now()) / 1000))
    return ['-readrate', '1.0', '-readrate_initial_burst', burst.toFixed(2)]
  }

  private async maxLagMs(): Promise<number> {
    return (await detectReadrateBurst()) ? MAX_LAG_SEC * 1000 : 0
  }

  /** Build the playout further ahead if it's running low. False = nothing scheduled. */
  private async ensurePlayout(channel: { id: number; playoutCursor: Date | null; rotationItems: unknown[] }): Promise<boolean> {
    const res = await topUpPlayout(channel).catch((e) => {
      log('error', 'playout', `Channel ${this.n}: playout build failed`, String((e as Error)?.stack || e), this.tag)
      // The build failed, not the channel — play whatever is already scheduled.
      return { scheduled: true, built: 0 }
    })
    return res.scheduled
  }

  private hlsOutput(): FfmpegOutput {
    const seq = ++this.runSeq
    return {
      kind: 'hls',
      playlist: path.join(this.workDir, `i${seq}.m3u8`),
      segmentFilename: path.join(this.workDir, `i${seq}_%05d.ts`),
      hlsTimeSec: SEGMENT_SEC,
    }
  }

  // ── Run one ffmpeg to disk and ingest its segments ─────────────────────────
  // Resolves once the process exits, with the cursor moved past everything it
  // finished. `atMs` is where its first frame sits on the schedule. `stalled`
  // means our watchdog force-killed it for producing no segment past the hard
  // deadline.
  private async encodeToMaster(args: string[], label: string, captionFiles: string[], atMs: number): Promise<EncodeResult> {
    // Recover the child playlist path from the args (hlsOutput just set it as
    // the last positional argument).
    const playlist = args[args.length - 1]
    const run: Run = { dir: this.workDir, playlist, ingested: 0, firstOfRun: true, startMs: atMs, encodedSec: 0 }

    const proc = spawn('ffmpeg', args)
    this.proc = proc
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d).slice(-2000)))

    const poll = setInterval(() => this.ingest(run), POLL_MS)
    poll.unref?.()

    // Producer-side stall watchdog (see PRODUCER_STALL_SEC). A segment lands via
    // ingest → nextSeq advances; if that hasn't moved for the deadline while the
    // process is still alive, the encoder is wedged, so kill it and let the loop
    // move on. Progress resets the clock, so a slow-but-producing encoder is safe.
    let lastSeq = this.nextSeq
    let lastProgressAt = Date.now()
    let stalled = false
    const watchdog = setInterval(() => {
      if (this.nextSeq !== lastSeq) {
        lastSeq = this.nextSeq
        lastProgressAt = Date.now()
        return
      }
      if (!stalled && Date.now() - lastProgressAt >= PRODUCER_STALL_SEC * 1000) {
        stalled = true
        log(
          'warn',
          'ffmpeg',
          `Channel ${this.n}: no segment from ${label} for ${PRODUCER_STALL_SEC}s — force-killing the encoder so the timeline can advance`,
          stderr || '(no stderr)',
          this.tag,
        )
        proc.kill('SIGKILL')
      }
    }, 1000)
    watchdog.unref?.()

    const code: number | null = await new Promise((resolve) => {
      proc.on('error', (e) => {
        log('error', 'ffmpeg', `Channel ${this.n}: failed to launch encoder for ${label}`, String(e), this.tag)
        resolve(null)
      })
      proc.on('close', (c) => resolve(c))
    })
    clearInterval(poll)
    clearInterval(watchdog)
    this.ingest(run) // final drain: pick up the last finalized segment
    if (this.proc === proc) this.proc = null
    this.cursor = atMs + run.encodedSec * 1000
    const restyled = this.restyled
    if (restyled) {
      this.restyled = false
      log('info', 'stream', `Ch ${this.n}: channel look changed — re-encoding ${label} from here`, undefined, this.tag)
    }

    // 255 / SIGKILL is our own reaper, the watchdog, or a restart; anything else
    // mid-life is a real fault worth surfacing (the loop keeps going regardless).
    // A watchdog kill is already logged above, so don't double-report it here.
    if (!stalled && code && code !== 0 && code !== 255) {
      log('warn', 'ffmpeg', `Channel ${this.n}: encoder exited ${code} on ${label}`, stderr || '(no stderr)', this.tag)
    }
    // ffmpeg has read the caption files at init; drop them and the child playlist.
    for (const f of captionFiles) fs.rmSync(f, { force: true })
    fs.rm(run.playlist, { force: true }, () => {})
    // A killed encoder (watchdog, restyle) leaves its unfinished segment behind;
    // everything it finished has been ingested (renamed away) by now.
    const prefix = path.basename(run.playlist, '.m3u8') + '_'
    try {
      for (const f of fs.readdirSync(run.dir)) if (f.startsWith(prefix)) fs.rm(path.join(run.dir, f), { force: true }, () => {})
    } catch {
      /* dir already gone (stopped) */
    }
    return { code, stalled, restyled, encodedSec: run.encodedSec }
  }

  // Move any newly-finalized child segments into the master playlist. A segment
  // is finalized once it appears in the child playlist (temp_file means the .ts
  // has been renamed into place by then), so we can safely rename it into our
  // global seg_{seq}.ts sequence and list it.
  private ingest(run: Run): void {
    let text: string
    try {
      text = fs.readFileSync(run.playlist, 'utf8')
    } catch {
      return // not created yet
    }
    const lines = text.split('\n')
    const entries: { file: string; dur: number }[] = []
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^#EXTINF:([\d.]+),/)
      if (m) {
        const file = (lines[i + 1] || '').trim()
        if (file && !file.startsWith('#')) entries.push({ file, dur: parseFloat(m[1]) })
      }
    }
    let added = false
    for (let j = run.ingested; j < entries.length; j++) {
      const src = path.join(run.dir, path.basename(entries[j].file))
      if (!fs.existsSync(src)) break // not finalized yet — catch it next sweep
      const seq = this.nextSeq
      const dest = path.join(this.dir, `seg_${seq}.ts`)
      try {
        fs.renameSync(src, dest)
      } catch {
        break // rename raced; retry next sweep
      }
      this.nextSeq++
      const disc = run.firstOfRun && this.emittedAny
      // Stamped with its place on the schedule, not when it happened to finish.
      const pdt = run.firstOfRun ? new Date(run.startMs).toISOString() : undefined
      run.firstOfRun = false
      this.emittedAny = true
      this.segs.push({ seq, durSec: entries[j].dur, disc, pdt })
      run.ingested++
      run.encodedSec += entries[j].dur
      this.evict()
      added = true
    }
    if (added) this.writePlaylist()
  }

  private evict(): void {
    while (this.segs.length > WINDOW_SEGMENTS) {
      const old = this.segs.shift()!
      if (old.disc) this.discontSeq++
      fs.rm(path.join(this.dir, `seg_${old.seq}.ts`), { force: true }, () => {})
    }
  }

  private writePlaylist(): void {
    if (this.segs.length === 0) return
    const target = Math.max(SEGMENT_SEC, ...this.segs.map((s) => Math.ceil(s.durSec)))
    const out: string[] = [
      '#EXTM3U',
      '#EXT-X-VERSION:6',
      `#EXT-X-TARGETDURATION:${target}`,
      `#EXT-X-MEDIA-SEQUENCE:${this.segs[0].seq}`,
      `#EXT-X-DISCONTINUITY-SEQUENCE:${this.discontSeq}`,
      '#EXT-X-INDEPENDENT-SEGMENTS',
    ]
    for (const s of this.segs) {
      if (s.disc) out.push('#EXT-X-DISCONTINUITY')
      if (s.pdt) out.push(`#EXT-X-PROGRAM-DATE-TIME:${s.pdt}`)
      out.push(`#EXTINF:${s.durSec.toFixed(3)},`, `seg_${s.seq}.ts`)
    }
    const file = this.playlistFile()
    const tmp = file + '.tmp'
    try {
      fs.writeFileSync(tmp, out.join('\n') + '\n')
      fs.renameSync(tmp, file) // atomic swap so a reader never sees a partial playlist
    } catch {
      /* best-effort */
    }
  }
}

// ── Registry + lifecycle ──────────────────────────────────────────────────────

const channels = new Map<number, ChannelSegmenter>()

function noteViewer(seg: ChannelSegmenter, ip?: string, client?: string): void {
  if (!ip) return
  if (!seg.viewers.has(ip)) {
    log('info', 'stream', `Channel ${seg.n}: ${client || 'a client'} at ${ip} joined the stream`, undefined, seg.tag)
  }
  seg.viewers.set(ip, Date.now())
}

/** Ensure the channel's segmenter is running; report readiness for the route. */
export async function ensureSegmenter(n: number, ip?: string, client?: string): Promise<HlsStatus> {
  const existing = channels.get(n)
  if (existing) {
    existing.lastAccess = Date.now()
    noteViewer(existing, ip, client)
    if (existing.running) return existing.ready() ? 'ready' : 'starting'
    channels.delete(n) // died — fall through to a fresh start
  }
  const seg = new ChannelSegmenter(n)
  seg.lastAccess = Date.now()
  channels.set(n, seg)
  noteViewer(seg, ip, client)
  const status = await seg.start()
  if (status === 'unavailable') channels.delete(n)
  return status
}

/** Re-encode a channel's on-air item with its current look, if it's streaming. */
export function restyleSegmenter(n: number): boolean {
  return channels.get(n)?.restyle() ?? false
}

/** Register a segment/playlist fetch so the reaper keeps the producer alive. */
export function touchSegmenter(n: number, ip?: string, client?: string): void {
  const seg = channels.get(n)
  if (!seg) return
  seg.lastAccess = Date.now()
  noteViewer(seg, ip, client)
}

export function segmenterPlaylistFile(n: number): string {
  return path.join(hlsDir(), String(n), 'index.m3u8')
}

/** Resolve a segment name to its path, guarding against traversal. */
export function segmenterSegmentFile(n: number, name: string): string | null {
  if (!/^seg_\d+\.ts$/.test(name)) return null
  return path.join(hlsDir(), String(n), name)
}

/** Distinct IPs seen within the recent window. */
export function segmenterViewers(n: number): number {
  const seg = channels.get(n)
  if (!seg) return 0
  const cutoff = Date.now() - VIEWER_WINDOW_MS
  let live = 0
  for (const [ip, seen] of seg.viewers) {
    if (seen >= cutoff) live++
    else seg.viewers.delete(ip)
  }
  return live
}

/** Wipe stale segmenter output from a previous run (called at boot). */
export function resetSegments(): void {
  try {
    fs.rmSync(hlsDir(), { recursive: true, force: true })
    fs.mkdirSync(hlsDir(), { recursive: true })
  } catch {
    /* best-effort */
  }
}

// Reap idle producers. Unref'd so it never keeps the process alive on its own.
const reaper = setInterval(() => {
  const now = Date.now()
  for (const [n, seg] of channels) {
    if (now - seg.lastAccess > IDLE_GRACE_MS) {
      seg.stop()
      channels.delete(n)
      log('info', 'stream', `⏹ Channel ${n} segmenter stopped (idle)`, undefined, seg.tag)
    }
  }
}, 10_000)
reaper.unref?.()

// ── MPEG-TS / HDHomeRun wrapper ────────────────────────────────────────────────
// A thin `-c copy` remux of the channel's HLS playlist to a per-client MPEG-TS
// pipe. Segment availability paces it, so there's no second real-time meter —
// this is ErsatzTV's "MPEG-TS is a light wrapper over the HLS Segmenter".

export async function streamMpegtsViaSegmenter(n: number, res: Response, req?: Request): Promise<void> {
  const ip = clientIp(req)
  const client = clientName(req)
  const status = await ensureSegmenter(n, ip, client)
  if (status === 'unavailable') {
    res.status(409).end()
    return
  }
  // Wait briefly for the first segments so the copy has input to follow.
  const waitReady = async (): Promise<boolean> => {
    const seg = channels.get(n)
    const until = Date.now() + READY_TIMEOUT_MS
    while (seg && !seg.ready() && Date.now() < until) await sleep(200)
    return !!seg?.ready()
  }
  await waitReady()

  const session = openSession(n, 'mpegts', req)
  const tag = session.tag
  log('info', 'stream', `▶ Channel ${n} MPEG-TS wrapper connected`, `${client} at ${ip}`, tag)

  res.on('error', () => {})
  res.socket?.setNoDelay(true)
  res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache, no-store', Connection: 'close' })

  // This viewer holds the shared producer open for its whole session, but its
  // ffmpeg copy runs for minutes at a stretch — far longer than the reaper's
  // idle grace — so touching once per spawn isn't enough: lastAccess goes stale
  // mid-stream and the reaper deletes the playlist out from under this very
  // stream (ffmpeg then 254s on the vanished index.m3u8). Beat well inside the
  // grace period for as long as we're connected.
  const heartbeat = setInterval(() => touchSegmenter(n, ip, client), IDLE_GRACE_MS / 3)
  heartbeat.unref?.()

  const playlist = segmenterPlaylistFile(n)
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    // Follow the live playlist from a few segments back so the client starts
    // with a buffer; ffmpeg waits on new segments, which paces the copy.
    '-live_start_index', '-3',
    '-i', playlist,
    '-c', 'copy',
    '-f', 'mpegts', '-muxpreload', '0', '-muxdelay', '0', 'pipe:1',
  ]

  let reason = 'client disconnected'
  let strikes = 0
  while (!res.writableEnded && !res.destroyed) {
    // Revive the producer if it died/was reaped, not merely touch it — a bare
    // touch no-ops on a dead segmenter, so a restart would loop forever against
    // a playlist that no longer exists. Re-ensure, then wait for its first
    // segments before pointing ffmpeg at the file again.
    if ((await ensureSegmenter(n, ip, client)) === 'unavailable') {
      reason = 'channel became unavailable'
      break
    }
    await waitReady()
    const startedAt = Date.now()
    const proc = spawn('ffmpeg', args)
    const kill = () => proc.kill('SIGKILL')
    res.on('close', kill)
    const result = await pipeSegment(proc, res, `Ch ${n} segmenter→player`, tag)
    res.off('close', kill)
    if (res.destroyed || res.writableEnded) break
    if (result.spawnError) {
      reason = 'failed to launch ffmpeg'
      break
    }
    strikes = Date.now() - startedAt > 60_000 ? 1 : strikes + 1
    if (strikes >= 3) {
      reason = `wrapper exited ${result.code} repeatedly`
      log('error', 'ffmpeg', `Channel ${n}: MPEG-TS wrapper kept dying (exit ${result.code}) — giving up`, result.stderr || '(no stderr)', tag)
      break
    }
    log('warn', 'ffmpeg', `Channel ${n}: MPEG-TS wrapper exited ${result.code ?? 'n/a'} — restarting`, result.stderr || '(no stderr)', tag)
  }

  clearInterval(heartbeat)
  closeSession(session.id)
  log('info', 'stream', `⏹ Channel ${n} MPEG-TS wrapper ended — ${reason}`, undefined, tag)
  if (!res.writableEnded) res.end()
}
