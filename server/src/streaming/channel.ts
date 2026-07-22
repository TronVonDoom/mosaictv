// Serving a channel: the long-lived outer ffmpeg that concatenates programs
// into one continuous MPEG-TS, and the per-item endpoint it fetches. This is
// the layer that talks to Express and the database; the command construction it
// uses lives in filters.ts.

import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Request, Response } from 'express'
import { prisma } from '../db.js'
import { buildPlayout, prunePlayout } from '../playout.js'
import { dataDir, logosDir } from '../paths.js'
import { programLabel } from '../labels.js'
import { log } from '../logs.js'
import { markEvent } from '../metrics.js'
import { clientIp, clientName, closeSession, openSession, sessionTag } from '../sessions.js'
import { hasSubtitleStream, probeSar } from '../ffprobe.js'
import { detectTextOverlay, nvdecIfReady, readrateBurstArgs, resolveEncoder } from './capabilities.js'
import { resolveProfile, type StreamProfile } from './profile.js'
import { loadWatermark, parseComingUp, parseWatermark, type WatermarkConfig } from './overlays.js'
import {
  blackArgs,
  comingUpFilter,
  comingUpWindows,
  ffmpegArgs,
  renderComingUpText,
  renderSongText,
  songChyronFilter,
  type Segment,
} from './filters.js'
import { activeBlockAt, activeLogo, localLogo } from './logo.js'
import { FILLER_H, FILLER_W, ensureAnimatedFiller, ensureFrostedFiller, resolveFillerClip } from './filler.js'

// How far ahead of real time a viewer session is allowed to run: the outer
// ffmpeg bursts this much at connect so the player has a buffer cushion
// (network jitter eats the cushion, not the picture), and catches back up to
// it after per-item startup stalls.
const READ_BURST_SEC = 4
// Because of that burst, item boundaries are fetched up to READ_BURST_SEC
// early — the fetch lands in the tail of the item the viewer has already
// watched. A pick within this of an item's end serves the NEXT item instead of
// replaying the tail. Must comfortably exceed READ_BURST_SEC.
const TAIL_SKIP_SEC = READ_BURST_SEC + 2

type SegmentResult = { code: number | null; stderr: string; spawnError?: Error; bytes: number; firstByteMs: number }

// A mid-segment freeze is invisible in the logs otherwise: nothing errors,
// nothing exits, bytes just stop moving and the whole chain (encoder → concat
// → player) sits idle, which is why container load falls away with nothing to
// show for it. So watch each hop — but only the half of it that can actually
// be wrong.
//
// The encoder runs flat out while the outer concat meters at -readrate 1.0, so
// it fills the pipe, blocks, waits for the meter to drain a few seconds, then
// bursts and blocks again. Being blocked is this design working: a healthy
// stream sits in backpressure roughly 5-6s at a time, indefinitely. Only a
// backpressure spell far longer than that means the consumer really did stop.
// A quiet encoder with a *drainable* pipe, though, is always a fault.
const STARVED_SEC = 5
const BACKPRESSURE_SEC = 30

/**
 * Pipe a child's stdout to the response with backpressure; resolve on exit.
 * Captures a tail of stderr, the exit code, bytes written, and how long until
 * the first byte arrived (a big first-byte delay is a stall the viewer sees).
 *
 * `tag` names this hop in stall warnings — omit it for short throwaway pipes
 * (black filler) that aren't worth watching. `session` attributes those
 * warnings to the viewer whose stream froze.
 */
function pipeSegment(proc: ChildProcess, res: Response, tag?: string, session?: string): Promise<SegmentResult> {
  return new Promise((resolve) => {
    let stderr = ''
    let spawnError: Error | undefined
    let bytes = 0
    let firstByteMs = -1
    const t0 = Date.now()
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
      if (stderr.length > 6000) stderr = stderr.slice(-6000) // keep the tail
    })
    // Which side of this hop is holding things up. `blocked` means WE couldn't
    // write, so the consumer is pacing us; otherwise the child simply produced
    // nothing. That distinction sets how long the quiet is allowed to last.
    let lastByteAt = Date.now()
    let blocked = false
    let stalled = false
    const watchdog = tag
      ? setInterval(() => {
          const idleMs = Date.now() - lastByteAt
          if (idleMs < (blocked ? BACKPRESSURE_SEC : STARVED_SEC) * 1000) {
            if (stalled) {
              stalled = false
              log('info', 'stream', `${tag}: recovered after ${(idleMs / 1000).toFixed(0)}s of no data`, undefined, session)
            }
            return
          }
          if (stalled) return // already reported; wait for recovery or exit
          stalled = true
          log(
            'warn',
            'stream',
            `${tag}: no data for ${(idleMs / 1000).toFixed(0)}s — stream is frozen here`,
            blocked
              ? 'still blocked writing downstream — the consumer (player/concat) has stopped reading for far longer than pacing explains'
              : 'ffmpeg produced nothing — the producer stalled, downstream is still accepting data',
            session,
          )
        }, 1000)
      : undefined
    watchdog?.unref()
    const onData = (chunk: Buffer) => {
      if (firstByteMs < 0) firstByteMs = Date.now() - t0
      bytes += chunk.length
      lastByteAt = Date.now()
      if (!res.write(chunk)) {
        blocked = true
        proc.stdout?.pause()
      }
    }
    const onDrain = () => {
      blocked = false
      proc.stdout?.resume()
    }
    proc.stdout?.on('data', onData)
    res.on('drain', onDrain)
    let settled = false
    const done = (code: number | null) => {
      if (settled) return
      settled = true
      if (watchdog) clearInterval(watchdog)
      res.off('drain', onDrain)
      resolve({ code, stderr: stderr.trim(), spawnError, bytes, firstByteMs })
    }
    proc.on('close', (code) => done(code))
    proc.on('error', (err) => {
      spawnError = err
      done(null)
    })
  })
}

function clientInfo(req?: Request): string {
  if (!req) return 'unknown client'
  const ua = (req.headers['user-agent'] as string) || 'unknown'
  return `${clientName(req)} at ${clientIp(req)} — ${ua}`
}

// Count of live viewers per channel number, for logging concurrency.
const viewers = new Map<number, number>()

/** Live viewer count for a channel number (0 for drafts/unknown). */
export function viewerCount(channelNumber: number | null): number {
  return channelNumber != null ? viewers.get(channelNumber) ?? 0 : 0
}

// The last program (per channel number) whose encoder ran to a clean finish.
// The item picker is stateless and re-derives "what's on air now" from the wall
// clock on every concat reopen. That self-syncs a viewer to the schedule, but
// it has one failure mode: if a per-item encoder briefly outruns the real-time
// meter and finishes its program before the slot's wall-clock end, the very
// next reopen lands back inside the SAME slot and re-serves the program's tail —
// the "episode played twice" bug. Recording the finish lets the picker spot that
// loop-back and hold the slot instead of replaying. Keyed by channel; the entry
// is only meaningful until the slot's stopTime, after which the picker naturally
// advances to the next item.
const lastFinishedItem = new Map<number, { itemId: number; stopTimeMs: number }>()

/** Stream black for `durSec` so the concat session survives a gap. */
async function streamBlack(res: Response, p: StreamProfile, enc: string, durSec: number, why: string, channelNumber: number, session?: string): Promise<void> {
  log('warn', 'stream', `Channel ${channelNumber}: filling ${durSec.toFixed(1)}s with black — ${why}`, undefined, session)
  if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache, no-store' })
  const proc = spawn('ffmpeg', blackArgs(p, enc, durSec))
  res.on('close', () => proc.kill('SIGKILL'))
  await pipeSegment(proc, res)
  if (!res.writableEnded) res.end()
}

/**
 * Hold the concat session for `durSec` with the channel's frosted station ident
 * (built from the active logo), looped — a branded stand-in for a slot that has
 * to be filled with no program to play (the replay guard). `wm` should be a
 * none-mode config: the ident already carries the logo, so no overlay is added.
 * Falls back to plain black if the ident can't be built.
 */
async function streamHold(res: Response, p: StreamProfile, enc: string, wm: WatermarkConfig, logo: string | undefined, durSec: number, why: string, channelNumber: number, session?: string): Promise<void> {
  const clip =
    (logo ? await ensureFrostedFiller(logo).catch(() => undefined) : undefined) ??
    (await ensureAnimatedFiller().catch(() => undefined))
  if (!clip || durSec < 0.5) {
    await streamBlack(res, p, enc, durSec, why, channelNumber, session)
    return
  }
  log('warn', 'stream', `Channel ${channelNumber}: holding ${durSec.toFixed(1)}s with station ident — ${why}`, undefined, session)
  // Only our own generated H.264 idents are safe to hand the GPU decoder.
  const hwDecode = enc === 'h264_nvenc' && path.basename(clip).startsWith('filler-') ? await nvdecIfReady('h264') : false
  const seg: Segment = {
    filePath: clip, offsetSec: 0, loop: true, durationSec: durSec, hasAudio: true,
    logo, wmEpochSec: Date.now() / 1000, mediaWidth: FILLER_W, mediaHeight: FILLER_H,
    isFiller: true, fadeInSec: 0, fadeOutSec: 0, hwDecode,
  }
  if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache, no-store' })
  const proc = spawn('ffmpeg', ffmpegArgs(seg, enc, wm, p))
  res.on('close', () => proc.kill('SIGKILL'))
  await pipeSegment(proc, res, `Ch ${channelNumber} hold`, session)
  if (!res.writableEnded) res.end()
}

/** Base URL for the internal per-item endpoints the concat demuxer fetches. */
function internalBase(): string {
  return `http://127.0.0.1:${Number(process.env.PORT ?? 8688)}`
}

/**
 * The internal concat playlist URL a channel's outer ffmpeg reads (shared by the
 * per-client MPEG-TS path and the shared-HLS path).
 *
 * `sessionId` rides along so the per-item fetches ffmpeg makes back into us can
 * be attributed to the viewer they're feeding — otherwise every item looks like
 * an anonymous loopback request and two concurrent viewers are indistinguishable.
 */
export function internalConcatUrl(channelNumber: number, sessionId?: number): string {
  const q = sessionId != null ? `?s=${sessionId}` : ''
  return `${internalBase()}/internal/concat/${channelNumber}${q}`
}

/**
 * The playlist the outer ffmpeg's concat demuxer reads. Two identical entries is
 * all it needs: `-stream_loop -1` cycles the list forever, and each pass re-opens
 * the URL, which hands back whatever should be on air at that moment. (Same trick
 * ErsatzTV uses.)
 */
export function concatPlaylist(channelNumber: number, sessionId?: number): string {
  const url = `${internalBase()}/internal/stream/${channelNumber}${sessionId != null ? `?s=${sessionId}` : ''}`
  return `ffconcat version 1.0\nfile ${url}\nfile ${url}\n`
}

/** Build the playout if it's empty or nearly exhausted. False = nothing scheduled. */
async function ensurePlayout(
  channel: { id: number; playoutCursor: Date | null; rotationItems: unknown[] },
  channelNumber: number,
  session?: string,
): Promise<boolean> {
  const now = Date.now()
  if (channel.playoutCursor && channel.playoutCursor.getTime() >= now + 30 * 60 * 1000) return true

  const blocks = await prisma.timeBlock.count({ where: { channelId: channel.id } })
  if (channel.rotationItems.length === 0 && blocks === 0) {
    log('warn', 'stream', `Channel ${channelNumber} has nothing scheduled — no rotation or time blocks`, undefined, session)
    return false
  }
  await prunePlayout(channel.id).catch((e) =>
    log('warn', 'playout', `Prune failed for channel ${channelNumber}`, String(e), session),
  )
  const built = await buildPlayout(channel.id, new Date(now + 4 * 3600 * 1000)).catch((e) => {
    log('error', 'playout', `Playout build failed for channel ${channelNumber}`, String(e?.stack || e), session)
    return -1
  })
  if (built >= 0) log('debug', 'playout', `Channel ${channelNumber}: built ${built} playout item(s) on connect`, undefined, session)
  return true
}

/**
 * Find the channel and make sure its playout is built far enough ahead to
 * stream. Returns false if the channel is missing or has nothing scheduled.
 * Used by the shared-HLS manager, which drives its own long-lived ffmpeg.
 */
export async function ensureChannelReady(channelNumber: number): Promise<boolean> {
  const channel = await prisma.channel.findFirst({
    where: { number: channelNumber },
    include: { rotationItems: true },
  })
  if (!channel) return false
  return ensurePlayout(channel, channelNumber)
}

/**
 * The public stream: one long-lived ffmpeg that concatenates the per-item streams
 * and remuxes them to the client.
 *
 * The point of the indirection is that ffmpeg — not us — owns timestamp
 * continuity across programs. We used to spawn an encoder per item and splice
 * their timestamps by hand with -output_ts_offset plus a fixed 40ms guard, which
 * could not survive B-frame reorder delay (measured at 200ms) and put DTS
 * backwards at every seam; players dropped video there and never recovered.
 * The concat demuxer just does this correctly.
 *
 * `-c copy` here: the inner streams are already normalised to the channel's
 * format, so the wrapper never re-encodes and costs no extra encoder session.
 */
export async function streamChannel(channelNumber: number, res: Response, req?: Request): Promise<void> {
  const channel = await prisma.channel.findFirst({
    where: { number: channelNumber },
    include: { rotationItems: true, profile: true },
  })
  if (!channel) {
    log('warn', 'stream', `Rejected stream: channel ${channelNumber} not found (${clientInfo(req)})`)
    res.status(404).end()
    return
  }

  const built = await ensurePlayout(channel, channelNumber)
  if (!built) {
    res.status(409).end() // nothing scheduled
    return
  }

  // Identify this viewer for the rest of the session: every line it produces —
  // including the per-item ones ffmpeg fetches back over loopback — is tagged
  // with it, so two people watching at once stay tellable apart in the log.
  const session = openSession(channelNumber, 'mpegts', req)
  const tag = session.tag

  const nViewers = (viewers.get(channelNumber) ?? 0) + 1
  viewers.set(channelNumber, nViewers)
  log(
    'info',
    'stream',
    `▶ Channel ${channelNumber} (${channel.name}) connected — ${nViewers} viewer(s) now watching this channel`,
    clientInfo(req),
    tag,
  )

  // Send the first few seconds unmetered so the player starts with a buffer
  // cushion, and re-earn that cushion (at 1.5x) after per-item startup stalls.
  // Only whichever of these options the running ffmpeg knows — on 5.1 they'd
  // abort the process, and not every 7.x build ships the catch-up rate. The
  // item picker compensates for boundaries arriving early (and is harmless when
  // they don't) — see TAIL_SKIP_SEC in streamChannelItem.
  const burst = await readrateBurstArgs(READ_BURST_SEC)
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 'concat',
    '-safe', '0',
    '-protocol_whitelist', 'file,http,tcp',
    '-probesize', '32',
    // Meter the output at real time here, in the one process that lives for the
    // whole session — the per-item encoders then run flat out until backpressure
    // stops them, which keeps a little of the next program ready to go.
    '-readrate', '1.0',
    ...burst,
    '-stream_loop', '-1',
    '-i', internalConcatUrl(channelNumber, session.id),
    '-c', 'copy',
    '-f', 'mpegts', '-muxpreload', '0', '-muxdelay', '0', 'pipe:1',
  ]
  log('debug', 'ffmpeg', `Ch ${channelNumber} concat command`, 'ffmpeg ' + args.join(' '), tag)

  res.on('error', () => {}) // a torn-down client socket must not throw
  res.socket?.setNoDelay(true) // TS chunks go out as they're written, not Nagle-batched
  res.writeHead(200, {
    'Content-Type': 'video/mp2t',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'close',
  })

  // If the concat process dies while the viewer is still connected (a broken
  // playlist entry, an ffmpeg fault…), restart it in the same response rather
  // than dropping the viewer: TS players ride out the timestamp discontinuity,
  // but a dead connection is an endless spinner. Three quick deaths in a row
  // means something systemic — give up and let the client's own retry take over.
  let reason = 'client disconnected'
  let strikes = 0
  while (!res.writableEnded && !res.destroyed) {
    const startedAt = Date.now()
    const proc = spawn('ffmpeg', args)
    const kill = () => proc.kill('SIGKILL')
    res.on('close', kill)
    const result = await pipeSegment(proc, res, `Ch ${channelNumber} concat→player`, tag)
    res.off('close', kill)
    if (res.destroyed || res.writableEnded) break // viewer left — the normal way out
    if (result.spawnError) {
      reason = 'failed to launch ffmpeg'
      log('error', 'ffmpeg', `Channel ${channelNumber}: could not launch the concat process`, String(result.spawnError), tag)
      break
    }
    strikes = Date.now() - startedAt > 60_000 ? 1 : strikes + 1
    if (strikes >= 3) {
      reason = `ffmpeg exited ${result.code} repeatedly`
      log('error', 'ffmpeg', `Channel ${channelNumber}: concat process kept dying (exit ${result.code}) — giving up`, result.stderr || '(no stderr)', tag)
      break
    }
    log('warn', 'ffmpeg', `Channel ${channelNumber}: concat process exited ${result.code ?? 'n/a'} mid-session — restarting`, result.stderr || '(no stderr)', tag)
  }

  const left = (viewers.get(channelNumber) ?? 1) - 1
  viewers.set(channelNumber, Math.max(0, left))
  const watchedS = Math.round((Date.now() - session.startedAt) / 1000)
  closeSession(session.id)
  log(
    'info',
    'stream',
    `⏹ Channel ${channelNumber} (${channel.name}) stream ended after ${watchedS}s — ${reason}; ${Math.max(0, left)} viewer(s) still watching`,
    undefined,
    tag,
  )
  if (!res.writableEnded) res.end()
}

/**
 * One program (or filler) — whatever is on air right now — encoded to the
 * channel's format and streamed until it ends. The concat demuxer opens this
 * once per item; because the item is chosen by wall clock, every viewer sees the
 * same thing and no per-client session state is needed.
 */
export async function streamChannelItem(channelNumber: number, res: Response, req?: Request): Promise<void> {
  // Nothing is written to the response until the encoder is spawned at the end
  // of this function, so every millisecond spent here is dead air the viewer
  // pays for out of their buffer. Time it, and say so when it gets dangerous.
  const openedAt = Date.now()
  // Which viewer this item is being fetched for: the outer ffmpeg carries the
  // session id on the URL we handed it (see concatPlaylist).
  const tag = sessionTag(req && req.query.s != null ? Number(req.query.s) : undefined)
  const channel = await prisma.channel.findFirst({
    where: { number: channelNumber },
    include: {
      timeBlocks: { include: { collection: true, fillerAssignments: { include: { filler: true }, orderBy: { order: 'asc' } } } },
      fillerAssignments: { include: { filler: true }, orderBy: { order: 'asc' } },
      rotationItems: true,
      profile: true,
    },
  })
  if (!channel) {
    res.status(404).end()
    return
  }
  if (!(await ensurePlayout(channel, channelNumber, tag))) {
    res.status(409).end()
    return
  }

  const profile = resolveProfile(channel.profile)
  const enc = await resolveEncoder(profile.hwaccel)
  const defaultWm = await loadWatermark()
  const logos = await prisma.logo.findMany()
  const logoPath = new Map<number, string>(logos.map((l) => [l.id, path.join(logosDir(), l.filename)]))
  // Each logo can carry its own watermark settings; legacy URL logos and the
  // bundled fallback icon use the global default.
  const logoWm = new Map<number, WatermarkConfig>(logos.map((l) => [l.id, parseWatermark(l.watermark, defaultWm)]))

  let current: ChildProcess | null = null
  res.on('error', () => {}) // a torn-down client socket must not throw
  res.on('close', () => current?.kill('SIGKILL'))

  // Whatever is on air right now, plus its neighbours (the watermark fades
  // across a filler boundary, so we need to know what sits either side).
  const now = new Date()
  const items = await prisma.playoutItem.findMany({
    where: { channelId: channel.id, stopTime: { gt: new Date(now.getTime() - 1000) } },
    orderBy: { startTime: 'asc' },
    take: 3,
    include: { mediaItem: true },
  })
  const prevRow = await prisma.playoutItem.findFirst({
    where: { channelId: channel.id, stopTime: { lte: now } },
    orderBy: { stopTime: 'desc' },
    select: { kind: true },
  })
  // The outer session reads READ_BURST_SEC ahead of the wall clock, so at a
  // boundary this endpoint is asked for the next item a few seconds early —
  // the pick lands in the tail of the item the viewer has already watched.
  // Serve the next item instead of replaying that tail.
  const tail = items[0]
  const inTail =
    !!tail &&
    !!items[1] &&
    now.getTime() > tail.startTime.getTime() + 1000 &&
    tail.stopTime.getTime() - now.getTime() < TAIL_SKIP_SEC * 1000
  const item = inTail ? items[1] : items[0]
  const next = inTail ? items[2] : items[1]
  const prevKind = inTail && tail ? tail.kind : prevRow?.kind
  if (!item) {
    await streamBlack(res, profile, enc, 2, 'nothing on air (playout exhausted)', channelNumber, tag)
    return
  }
  // Replay guard (see lastFinishedItem). If the program we just picked is the
  // one that most recently ran to a clean finish and its slot hasn't elapsed,
  // the encoder outran the wall clock and the concat has looped back onto the
  // same slot. Re-serving it would replay the program's tail; instead hold black
  // to the slot's end, capped so each reopen re-checks the clock — the schedule
  // stays put and the next program still starts on time. Also covers a file that
  // is simply shorter than its slot (finishes early at true EOF).
  const finished = lastFinishedItem.get(channelNumber)
  if (finished && finished.itemId === item.id && now.getTime() < finished.stopTimeMs) {
    const remainingSec = Math.min((finished.stopTimeMs - now.getTime()) / 1000, 30)
    const why = `${item.mediaItem?.title ?? 'program'} already finished this slot — holding to stay on schedule (encoder outran the clock)`
    const holdLogo = await localLogo(activeLogo(channel, channel.timeBlocks, logoPath, item.startTime).raw)
    await streamHold(res, profile, enc, { ...defaultWm, mode: 'none' as const }, holdLogo, remainingSec, why, channelNumber, tag)
    return
  }
  // Not on air yet (dead air between blocks on a blocks-only channel): hold
  // with black rather than airing the next program early. Capped so each
  // refetch re-evaluates against the clock.
  const leadGapSec = (item.startTime.getTime() - now.getTime()) / 1000
  if (leadGapSec > TAIL_SKIP_SEC) {
    await streamBlack(res, profile, enc, Math.min(leadGapSec, 30), 'dead air until the next scheduled item', channelNumber, tag)
    return
  }

  const active = activeLogo(channel, channel.timeBlocks, logoPath, item.startTime)
  const logo = await localLogo(active.raw)
  // Per-logo watermark settings, else the global default.
  const wm = active.id != null ? logoWm.get(active.id) ?? defaultWm : defaultWm
  // Start where the clock says we are: the concat demuxer opens this once
  // per item, so a mid-item open (a viewer tuning in) resumes correctly.
  const offset = Math.max(0, (now.getTime() - item.startTime.getTime()) / 1000)
  const midItem = offset > 1

  // The logo is hidden across filler unless asked otherwise, so ramp it
  // down into that boundary and back up out of it rather than popping.
  // Only meaningful on a program: filler itself either shows it or not.
  const thisIsFiller = item.kind === 'filler'
  const hiddenOnFiller = !wm.showOnFiller && wm.mode !== 'none'
  const edgeFade = hiddenOnFiller && !thisIsFiller ? Math.max(0, wm.fadeSeconds) : 0
  const fadeOutSec = edgeFade > 0 && next?.kind === 'filler' ? edgeFade : 0
  // Don't fade in when tuning in mid-program — there was no filler on screen.
  const fadeInSec = edgeFade > 0 && prevKind === 'filler' && !midItem ? edgeFade : 0
  const mi = item.mediaItem
  // Absolute wall-clock start of the frames we're about to emit — anchors
  // the intermittent watermark so it fires on schedule for every viewer.
  const wmEpochSec = item.startTime.getTime() / 1000 + offset
  // Cap every segment to its scheduled slot so output timestamps stay
  // exactly continuous (a program overrunning its probed duration is what
  // could otherwise push the next segment's PTS backwards → a freeze).
  // Measured from the item's own start when a tail-skip fetched it early.
  const segDur = (item.stopTime.getTime() - Math.max(now.getTime(), item.startTime.getTime())) / 1000
  let seg: Segment | null = null
  let label: string

  if (item.kind === 'filler' || !mi) {
    const genStart = Date.now()
    // Filler pool: the active block's assigned fillers → the channel's →
    // the built-in frosted/animated fallback.
    const poolBlock = activeBlockAt(channel.timeBlocks, item.startTime)
    const blockPool = poolBlock?.fillerAssignments.map((a) => a.filler) ?? []
    const channelPool = channel.fillerAssignments.map((a) => a.filler)
    const pool = blockPool.length > 0 ? blockPool : channelPool
    const src = blockPool.length > 0 ? ' [block]' : channelPool.length > 0 ? ' [channel]' : ''
    let clip: string | undefined
    let music: string | undefined
    if (pool.length > 0) {
      const f = pool[Math.floor(item.startTime.getTime() / 1000) % pool.length]
      const r = await resolveFillerClip(f, logo)
      clip = r.clip
      music = r.music
    } else {
      // No filler configured: default to the frosted-glass station ident
      // built from the channel/block logo. localLogo always resolves to at
      // least the bundled icon; fall back to the animated gradient only if
      // frosted generation fails or there's somehow no logo.
      clip =
        (logo ? await ensureFrostedFiller(logo).catch(() => undefined) : undefined) ??
        (await ensureAnimatedFiller())
    }
    const genMs = Date.now() - genStart
    if (genMs > 500) log('warn', 'system', `Channel ${channelNumber}: filler resolve blocked ${genMs}ms (should be pre-warmed)`, undefined, tag)
    // Generated filler is always our own H.264; custom clips are unknown,
    // so only offer those to the GPU when they're our generated files.
    const fillerHw =
      enc === 'h264_nvenc' && clip && path.basename(clip).startsWith('filler-')
        ? await nvdecIfReady('h264')
        : false
    if (clip && segDur > 0.3) {
      seg = { filePath: clip, offsetSec: 0, loop: true, durationSec: segDur, hasAudio: true, logo, wmEpochSec, mediaWidth: FILLER_W, mediaHeight: FILLER_H, musicPath: music, isFiller: true, fadeInSec: 0, fadeOutSec: 0, hwDecode: fillerHw }
    }
    label = `filler (${Math.round(segDur)}s)${music ? ' +music' : ''}${src}`
    if (!clip) log('error', 'stream', `Channel ${channelNumber}: no filler clip — a ${Math.round(segDur)}s gap will play black`, undefined, tag)
  } else if (fs.existsSync(mi.path) && offset >= (mi.durationSec ?? Infinity) - 0.2) {
    // The file is shorter than the slot it was given. Seeking past its end
    // would produce nothing, and concat would refetch this same item on a
    // tight loop until the slot expired.
    await streamBlack(res, profile, enc, Math.min(segDur, 10), `${mi.title} ran out ${offset.toFixed(1)}s in (file shorter than its slot)`, channelNumber, tag)
    return
  } else if (fs.existsSync(mi.path)) {
    // Only anamorphic sources need correcting, and only a constrained
    // watermark cares — skip the probe otherwise.
    const sar = wm.constrainToMedia && wm.mode !== 'none' && logo ? await probeSar(mi.path) : 1
    const dispW = Math.round((mi.width ?? FILLER_W) * sar)
    // Decode on the GPU when the probe says this codec is supported
    // there (per-chip: e.g. a GTX 970 does h264 but not hevc).
    const hwDecode = enc === 'h264_nvenc' && mi.videoCodec ? await nvdecIfReady(mi.videoCodec.toLowerCase()) : false
    const hasSubtitles = profile.burnSubtitles ? await hasSubtitleStream(mi.path) : false
    seg = { filePath: mi.path, offsetSec: offset, loop: false, durationSec: segDur, hasAudio: !!mi.audioCodec, logo, wmEpochSec, mediaWidth: dispW, mediaHeight: mi.height ?? FILLER_H, isFiller: false, fadeInSec, fadeOutSec, hwDecode, hasSubtitles }
    label = programLabel(mi, { withTitle: true })
  } else {
    log('warn', 'stream', `Channel ${channelNumber}: media file missing, skipping`, mi.path, tag)
    label = mi.title
  }

  if (!seg) {
    await streamBlack(res, profile, enc, Math.min(segDur, 10), `no playable segment for ${label}`, channelNumber, tag)
    return
  }

  // Coming-up-next caption: only over a program (never filler), only when
  // the next item is a real program with metadata. Config cascades from
  // the airing block's override to the channel default (null = off).
  // Text is written to a per-segment file (cleaned up below) so titles
  // with quotes/colons/% can't break the filtergraph.
  let textFilter: string | undefined
  let captionFile: string | undefined
  const songFiles: string[] = []
  if (!thisIsFiller && next?.kind === 'program' && next.mediaItem) {
    const cuBlock = activeBlockAt(channel.timeBlocks, item.startTime)
    const cuJson = cuBlock?.comingUp ?? channel.comingUp
    const cu = cuJson ? parseComingUp(cuJson) : null
    // Only probe for drawtext when a caption is actually configured.
    const support = cu?.enabled ? await detectTextOverlay() : null
    if (cu && support) {
      const text = renderComingUpText(cu.template, next.mediaItem)
      const itemDur = (item.stopTime.getTime() - item.startTime.getTime()) / 1000
      const windows = comingUpWindows(cu, segDur, itemDur, offset)
      if (text && windows.length > 0) {
        // Unique per request: several viewers can open the same channel's
        // item concurrently, each staging its own caption file.
        captionFile = path.join(dataDir(), `caption-${channelNumber}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
        try {
          fs.writeFileSync(captionFile, text)
          textFilter = comingUpFilter(cu, support.font, captionFile, windows, profile) ?? undefined
          if (textFilter) log('debug', 'stream', `Ch ${channelNumber} coming-up caption: "${text}"`, `${windows.length} window(s)`, tag)
        } catch (e) {
          log('warn', 'stream', `Channel ${channelNumber}: could not stage coming-up caption`, String(e), tag)
          captionFile = undefined
        }
      }
    }
  }
  // Song chyron: while a music video plays, show a lower-third with its
  // title/artist for the item's first ~12s (relative to item start, so a
  // mid-song tune-in past the intro shows little or none of it). Chained
  // after any coming-up caption.
  if (!thisIsFiller && mi?.type === 'music') {
    const support = await detectTextOverlay()
    const a = Math.max(0, 1 - offset)
    const b = 13 - offset
    if (support && mi.title && b - a > 0.5) {
      const { title, sub } = renderSongText(mi)
      const stage = (tag: string, text: string) => {
        const f = path.join(dataDir(), `caption-song-${tag}-${channelNumber}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
        fs.writeFileSync(f, text)
        songFiles.push(f)
        return f
      }
      try {
        const titleFile = stage('t', title)
        const subFile = sub ? stage('s', sub) : null
        const chyron = songChyronFilter(support.font, titleFile, subFile, a, b, profile)
        if (chyron) {
          textFilter = textFilter ? `${textFilter},${chyron}` : chyron
          log('debug', 'stream', `Ch ${channelNumber} song chyron: "${title}${sub ? ' — ' + sub : ''}"`, undefined, tag)
        }
      } catch (e) {
        log('warn', 'stream', `Channel ${channelNumber}: could not stage song chyron`, String(e), tag)
      }
    }
  }

  const args = ffmpegArgs(seg, enc, wm, profile, textFilter)
  let wmDesc: string
  if (wm.mode === 'none' || !logo) {
    wmDesc = 'no watermark'
  } else if (wm.mode === 'intermittent') {
    // Where we are in the show/hide cycle right now, so the log makes it
    // obvious when to expect the logo (and confirms it's scheduled).
    const P = Math.max(1, Math.round(wm.frequencyMinutes * 60))
    const phase = Math.round(wmEpochSec) % P
    const untilOn = phase < wm.durationSeconds ? 0 : P - phase
    wmDesc = `watermark intermittent/${wm.position}${wm.constrainToMedia ? '/media-fit' : ''} — ${wm.durationSeconds}s every ${wm.frequencyMinutes}min, ${untilOn === 0 ? 'visible now' : 'next in ' + untilOn + 's'}`
  } else {
    wmDesc = `watermark ${wm.mode}/${wm.position}${wm.constrainToMedia ? '/media-fit' : ''}`
  }
  const prepMs = Date.now() - openedAt
  // The connect-time cushion is READ_BURST_SEC; spending anywhere near it on
  // preparation means the player runs dry at the seam and freezes.
  if (prepMs > READ_BURST_SEC * 250) {
    log(
      'warn',
      'stream',
      `Channel ${channelNumber}: ${(prepMs / 1000).toFixed(1)}s of dead air preparing ${label} — the viewer's buffer drains while this runs`,
      'probes and playout work belong at startup, not at a program boundary',
      tag,
    )
  }
  const startDetail = `source ${seg.mediaWidth}x${seg.mediaHeight}, decode ${seg.hwDecode ? 'GPU (nvdec)' : 'CPU'}, prep ${prepMs}ms, logo ${active.id != null ? '#' + active.id : active.raw ? 'url' : 'none'}, ${wmDesc}`
  log(
    'info',
    'stream',
    `Ch ${channelNumber} ▶ ${label}${offset > 1 ? ` (resuming at ${Math.round(offset)}s)` : ''}`,
    startDetail,
    tag,
  )
  // Annotate the resource timeline, so a step change in CPU can be traced back
  // to the item that started at that moment.
  markEvent(
    channelNumber,
    thisIsFiller ? 'filler' : mi?.type === 'music' ? 'song' : 'program',
    label,
    `${enc}, ${startDetail}`,
  )
  log('debug', 'ffmpeg', `Ch ${channelNumber} ffmpeg command`, 'ffmpeg ' + args.join(' '), tag)
  res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache, no-store' })
  const segStart = Date.now()
  current = spawn('ffmpeg', args)
  const result = await pipeSegment(current, res, `Ch ${channelNumber} encoder→concat`, tag)
  current = null
  // ffmpeg has read the caption files at init; safe to drop them now.
  if (captionFile) fs.rmSync(captionFile, { force: true })
  for (const f of songFiles) fs.rmSync(f, { force: true })

  // Log the outcome of every segment (bytes, wall time, first-byte delay) — a
  // slow first byte or zero bytes is the stall a viewer sees as a freeze/black
  // screen.
  const wallMs = Date.now() - segStart
  const wallS = (wallMs / 1000).toFixed(1)
  const mb = (result.bytes / 1e6).toFixed(1)
  const detail = `${mb} MB in ${wallS}s (expected ~${Math.round(segDur)}s), first byte ${result.firstByteMs < 0 ? 'never' : result.firstByteMs + 'ms'}, exit ${result.code ?? 'n/a'}`
  if (result.spawnError) {
    log('error', 'ffmpeg', `Channel ${channelNumber}: failed to launch ffmpeg for ${path.basename(seg.filePath)}`, String(result.spawnError), tag)
  } else if (result.code && result.code !== 0) {
    log('error', 'ffmpeg', `Channel ${channelNumber}: ffmpeg exited ${result.code} on ${path.basename(seg.filePath)}`, `${detail}\n${result.stderr || '(no stderr)'}`, tag)
  } else if (result.bytes === 0) {
    log('error', 'ffmpeg', `Channel ${channelNumber}: ffmpeg produced NO output for ${path.basename(seg.filePath)} — viewers see a freeze/black`, `${detail}\n${result.stderr || '(no stderr)'}`, tag)
  } else if (result.firstByteMs > 2500) {
    log('warn', 'ffmpeg', `Channel ${channelNumber}: slow start (${result.firstByteMs}ms to first byte) on ${path.basename(seg.filePath)} — possible stall`, detail, tag)
  } else if (segDur > 5 && wallMs > (segDur + 3) * 1000 * 1.15) {
    // Took much longer than real time → the encoder can't sustain the
    // stream, so viewers' buffers underrun and it freezes/stutters.
    log('warn', 'ffmpeg', `Channel ${channelNumber}: encoder slower than real-time (${wallS}s for a ${Math.round(segDur)}s segment, ${enc}) — likely cause of freezing`, detail, tag)
  } else {
    log('debug', 'ffmpeg', `Channel ${channelNumber}: segment done — ${label}`, `${detail}${result.stderr ? '\n' + result.stderr : ''}`, tag)
  }
  // A real program that reached its own end (clean exit, some output) while the
  // consumer was still attached: record it so the replay guard can recognise the
  // concat looping back onto this slot. A client that walked away leaves res
  // destroyed / a non-zero code — that isn't the program finishing, so skip it.
  if (!res.destroyed && result.code === 0 && result.bytes > 0 && item.kind !== 'filler' && mi) {
    lastFinishedItem.set(channelNumber, { itemId: item.id, stopTimeMs: item.stopTime.getTime() })
  }
  // A segment that produced nothing would hand the concat demuxer an empty
  // entry, which it treats as fatal — the whole viewer session dies.
  // Substitute valid black TS so the session survives the slot.
  if (result.bytes === 0 && !res.writableEnded && !res.destroyed) {
    await streamBlack(res, profile, enc, Math.min(Math.max(segDur, 1), 8), `encoder produced no output for ${label}`, channelNumber, tag)
  }

  // Viewer accounting lives on the outer /iptv stream; this endpoint is just one
  // item of it. Ending here lets concat move straight on to the next item.
  if (!res.writableEnded) res.end()
}
