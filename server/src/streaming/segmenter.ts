// v2 streaming core: one single-stage HLS segmenter per channel (the ErsatzTV
// model). A per-channel producer walks the deterministic playout timeline and
// runs ONE ffmpeg per item that encodes straight to on-disk HLS segments; this
// module owns the channel's master playlist, stitching each item's child
// segments into one live playlist with an EXT-X-DISCONTINUITY at every program
// boundary. Players reset their decoder on the discontinuity, so the seam
// hazards that plague the v1 three-stage concat pipeline (double-meter freeze,
// wall-clock replay) cannot happen here.
//
// No second ffmpeg, no HTTP loopback for media, no self-referential concat. The
// MPEG-TS / HDHomeRun path is a thin `-c copy` wrapper that reads this
// playlist, so every output shares the one encode stage.
//
// Selected at boot by SEGMENTER=v2; the v1 path (channel.ts / hls.ts) stays put
// behind the flag until this is proven.

import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Request, Response } from 'express'
import { prisma } from '../db.js'
import { hlsDir, logosDir } from '../paths.js'
import { log } from '../logs.js'
import { markEvent } from '../metrics.js'
import { buildPlayout, prunePlayout } from '../playout.js'
import { clientIp, clientName, closeSession, openSession, type Session } from '../sessions.js'
import { ensureChannelReady, pipeSegment } from './channel.js'
import { resolveProfile } from './profile.js'
import { loadWatermark, parseWatermark, type WatermarkConfig } from './overlays.js'
import { resolveEncoder } from './capabilities.js'
import { blackArgs, type FfmpegOutput } from './filters.js'
import { buildItemArgs, type ChannelForBuild, type PlayoutItemForBuild } from './itemBuild.js'

export const SEGMENTER_V2 = process.env.SEGMENTER === 'v2'

// ready = playlist has segments; starting = warming up; unavailable = no channel/schedule.
export type HlsStatus = 'ready' | 'starting' | 'unavailable'

const SEGMENT_SEC = 4
const WINDOW_SEGMENTS = 12 // ~48s of playlist; a player rides ~3 segments back (~12s buffer)
const READY_MIN_SEGS = 2 // serve the playlist once it holds this many segments
const READY_TIMEOUT_MS = 12_000 // report "starting" if not ready within this
const POLL_MS = 300 // how often to sweep an item's child playlist for finished segments
const IDLE_GRACE_MS = 30_000 // stop the producer this long after the last request
const VIEWER_WINDOW_MS = 20_000 // an IP seen within this window counts as watching
// A per-item encoder capped to its slot with -readrate 1.0 exits ~at the slot
// end. If it exits much earlier than this margin, its file was shorter than the
// slot — hold the remainder rather than re-attempting an instant-EOF program.
const EARLY_EXIT_MARGIN_SEC = 5
const HOLD_CHUNK_SEC = 30 // fill dead air / short-file remainder in chunks this big
// Single real-time meter, no connect burst: the buffer here is structural (the
// player sits ~12s behind the live edge), so front-loading the encoder would
// only make each item finish early and desync from the schedule.
const READRATE = ['-readrate', '1.0']

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// One segment in the master playlist. `seq` is the global monotonic index and
// the on-disk name (seg_{seq}.ts); `disc` marks an item boundary the player
// resets on; `pdt` is the wall-clock program-date-time on the first segment of
// each item (for guide alignment).
type MasterSeg = { seq: number; durSec: number; disc: boolean; pdt?: string }

// Bookkeeping for one item's ffmpeg run and its child playlist.
type Run = { dir: string; playlist: string; ingested: number; firstOfRun: boolean }

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
    const now = Date.now()
    // Load channel + config fresh each item so schedule/logo/watermark edits go
    // live, exactly like v1's per-item endpoint.
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
    const enc = await resolveEncoder(profile.hwaccel)
    const defaultWm = await loadWatermark()
    const logos = await prisma.logo.findMany()
    const logoPath = new Map<number, string>(logos.map((l) => [l.id, path.join(logosDir(), l.filename)]))
    const logoWm = new Map<number, WatermarkConfig>(logos.map((l) => [l.id, parseWatermark(l.watermark, defaultWm)]))

    const items = (await prisma.playoutItem.findMany({
      where: { channelId: channel.id, stopTime: { gt: new Date(now) } },
      orderBy: { startTime: 'asc' },
      take: 3,
      include: { mediaItem: true },
    })) as PlayoutItemForBuild[]

    if (items.length === 0) {
      // Playout exhausted (should be rare — we extend above). Keep the session
      // alive with a short black fill; the next iteration rebuilds.
      await this.encodeToMaster(blackArgs(profile, enc, 2, this.hlsOutput()), 'black (playout exhausted)')
      return
    }

    const item = items[0]
    // Not on air yet: dead air until the next scheduled item (blocks-only gap).
    if (item.startTime.getTime() > now + 1000) {
      const gapSec = (item.startTime.getTime() - now) / 1000
      await this.encodeToMaster(blackArgs(profile, enc, Math.min(gapSec, HOLD_CHUNK_SEC), this.hlsOutput()), 'black (dead air until next item)')
      return
    }

    const next = items[1]
    const prevRow = await prisma.playoutItem.findFirst({
      where: { channelId: channel.id, stopTime: { lte: new Date(now) } },
      orderBy: { stopTime: 'desc' },
      select: { kind: true },
    })
    const offset = Math.max(0, (now - item.startTime.getTime()) / 1000)
    const segDur = (item.stopTime.getTime() - now) / 1000
    if (segDur < 1) {
      // Slot essentially over; let the wall clock advance to the next item.
      await sleep(Math.min(Math.max(segDur, 0) * 1000, 500))
      return
    }

    const built = await buildItemArgs({
      channelNumber: this.n,
      channel: channel as unknown as ChannelForBuild,
      profile,
      enc,
      defaultWm,
      logoPath,
      logoWm,
      item,
      next,
      prevKind: prevRow?.kind,
      offset,
      segDur,
      output: this.hlsOutput(),
      readrate: READRATE,
      tag: this.tag,
    })

    if (built.kind === 'black') {
      await this.encodeToMaster(blackArgs(profile, enc, Math.min(built.durSec, HOLD_CHUNK_SEC), this.hlsOutput()), `black (${built.why})`)
      return
    }

    log(
      'info',
      'stream',
      `Ch ${this.n} ▶ ${built.label}${offset > 1 ? ` (resuming at ${Math.round(offset)}s)` : ''}`,
      `decode ${built.hwDecode ? 'GPU (nvdec)' : 'CPU'}, ${built.wmDesc}`,
      this.tag,
    )
    markEvent(this.n, item.kind === 'filler' ? 'filler' : item.mediaItem?.type === 'music' ? 'song' : 'program', built.label, enc)

    const startedAt = Date.now()
    const res = await this.encodeToMaster(built.args, built.label, built.captionFiles)
    const ranSec = (Date.now() - startedAt) / 1000

    // A real program whose encoder exited well before its slot ended hit EOF —
    // its file is shorter than the slot. Hold the remainder with black so we
    // stay on schedule instead of re-attempting an instant-EOF program next
    // iteration (which would spin). Filler already loops to fill its slot.
    if (res.code === 0 && item.kind !== 'filler' && ranSec < segDur - EARLY_EXIT_MARGIN_SEC) {
      const remaining = (item.stopTime.getTime() - Date.now()) / 1000
      if (remaining > 1) {
        await this.encodeToMaster(
          blackArgs(profile, enc, Math.min(remaining, HOLD_CHUNK_SEC), this.hlsOutput()),
          `black (${built.label} ended ${Math.round(segDur - ranSec)}s early — holding to stay on schedule)`,
        )
      }
    }
  }

  /** Build the playout further ahead if it's running low. False = nothing scheduled. */
  private async ensurePlayout(channel: { id: number; playoutCursor: Date | null; rotationItems: unknown[] }): Promise<boolean> {
    const now = Date.now()
    if (channel.playoutCursor && channel.playoutCursor.getTime() >= now + 30 * 60 * 1000) return true
    const blocks = await prisma.timeBlock.count({ where: { channelId: channel.id } })
    if (channel.rotationItems.length === 0 && blocks === 0) return false
    await prunePlayout(channel.id).catch(() => {})
    await buildPlayout(channel.id, new Date(now + 4 * 3600 * 1000)).catch((e) =>
      log('error', 'playout', `Channel ${this.n}: playout build failed`, String(e?.stack || e), this.tag),
    )
    return true
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
  private async encodeToMaster(args: string[], label: string, captionFiles: string[] = []): Promise<{ code: number | null }> {
    // Recover the child playlist path from the args (hlsOutput just set it as
    // the last positional argument).
    const playlist = args[args.length - 1]
    const run: Run = { dir: this.workDir, playlist, ingested: 0, firstOfRun: true }

    const proc = spawn('ffmpeg', args)
    this.proc = proc
    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d).slice(-2000)))

    const poll = setInterval(() => this.ingest(run), POLL_MS)
    poll.unref?.()

    const code: number | null = await new Promise((resolve) => {
      proc.on('error', (e) => {
        log('error', 'ffmpeg', `Channel ${this.n}: failed to launch encoder for ${label}`, String(e), this.tag)
        resolve(null)
      })
      proc.on('close', (c) => resolve(c))
    })
    clearInterval(poll)
    this.ingest(run) // final drain: pick up the last finalized segment
    if (this.proc === proc) this.proc = null

    // 255 / SIGKILL is our own reaper or a restart; anything else mid-life is a
    // real fault worth surfacing (the loop keeps going regardless).
    if (code && code !== 0 && code !== 255) {
      log('warn', 'ffmpeg', `Channel ${this.n}: encoder exited ${code} on ${label}`, stderr || '(no stderr)', this.tag)
    }
    // ffmpeg has read the caption files at init; drop them and the child playlist.
    for (const f of captionFiles) fs.rmSync(f, { force: true })
    fs.rm(run.playlist, { force: true }, () => {})
    return { code }
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
      const pdt = run.firstOfRun ? new Date().toISOString() : undefined
      run.firstOfRun = false
      this.emittedAny = true
      this.segs.push({ seq, durSec: entries[j].dur, disc, pdt })
      run.ingested++
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
  const status = await ensureSegmenter(n, clientIp(req), clientName(req))
  if (status === 'unavailable') {
    res.status(409).end()
    return
  }
  // Wait briefly for the first segments so the copy has input to follow.
  const seg = channels.get(n)
  const until = Date.now() + READY_TIMEOUT_MS
  while (seg && !seg.ready() && Date.now() < until) await sleep(200)

  const session = openSession(n, 'mpegts', req)
  const tag = session.tag
  log('info', 'stream', `▶ Channel ${n} MPEG-TS wrapper connected`, `${clientName(req)} at ${clientIp(req)}`, tag)

  res.on('error', () => {})
  res.socket?.setNoDelay(true)
  res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache, no-store', Connection: 'close' })

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
    touchSegmenter(n, clientIp(req), clientName(req)) // keep the shared producer alive
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

  closeSession(session.id)
  log('info', 'stream', `⏹ Channel ${n} MPEG-TS wrapper ended — ${reason}`, undefined, tag)
  if (!res.writableEnded) res.end()
}
