// Shared streaming primitives the single-stage segmenter builds on: the
// backpressure-aware pipe from an ffmpeg child's stdout to a client response
// (with a stall watchdog), and the playout-readiness check that makes sure a
// channel has enough timeline built to stream.

import type { ChildProcess } from 'node:child_process'
import type { Response } from 'express'
import { prisma } from '../db.js'
import { buildPlayout, prunePlayout } from '../playout.js'
import { log } from '../logs.js'

type SegmentResult = { code: number | null; stderr: string; spawnError?: Error; bytes: number; firstByteMs: number }

// A mid-segment freeze is invisible in the logs otherwise: nothing errors,
// nothing exits, bytes just stop moving and the whole chain sits idle. So watch
// each hop — but only the half of it that can actually be wrong.
//
// The encoder runs flat out while the consumer meters at real time, so it fills
// the pipe, blocks, waits for the meter to drain a few seconds, then bursts and
// blocks again. Being blocked is this design working: a healthy stream sits in
// backpressure roughly 5-6s at a time, indefinitely. Only a backpressure spell
// far longer than that means the consumer really did stop. A quiet producer with
// a *drainable* pipe, though, is always a fault.
const STARVED_SEC = 5
const BACKPRESSURE_SEC = 30
// Past this many seconds of a silent producer with a drainable pipe, the hop is
// wedged, not slow, and a hung ffmpeg never exits on its own. The watchdog
// force-kills it and lets the caller restart it, turning a silent multi-minute
// freeze into a ~20s blip. Only starvation is killed, never backpressure: a
// slow-but-live consumer is pacing us, not failing.
const STALL_KILL_SEC = 20

/**
 * Pipe a child's stdout to the response with backpressure; resolve on exit.
 * Captures a tail of stderr, the exit code, bytes written, and how long until
 * the first byte arrived (a big first-byte delay is a stall the viewer sees).
 *
 * `tag` names this hop in stall warnings — omit it for short throwaway pipes
 * that aren't worth watching. `session` attributes those warnings to the viewer
 * whose stream froze.
 */
export function pipeSegment(proc: ChildProcess, res: Response, tag?: string, session?: string): Promise<SegmentResult> {
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
    let killed = false
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
          // A silent producer that stays quiet past the hard deadline is wedged,
          // not slow, and will never exit on its own — kill it and let the caller
          // restart. Backpressure is exempt: a slow-but-live consumer is pacing us.
          if (!blocked && !killed && idleMs >= STALL_KILL_SEC * 1000) {
            killed = true
            log(
              'warn',
              'stream',
              `${tag}: frozen ${(idleMs / 1000).toFixed(0)}s — force-killing ffmpeg so it can restart`,
              'producer silent with a drainable pipe past the hard deadline — the hop is wedged, not pacing',
              session,
            )
            proc.kill('SIGKILL')
            return
          }
          if (stalled) return // already reported; wait for recovery or exit
          stalled = true
          log(
            'warn',
            'stream',
            `${tag}: no data for ${(idleMs / 1000).toFixed(0)}s — stream is frozen here`,
            blocked
              ? 'still blocked writing downstream — the consumer has stopped reading for far longer than pacing explains'
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
 */
export async function ensureChannelReady(channelNumber: number): Promise<boolean> {
  const channel = await prisma.channel.findFirst({
    where: { number: channelNumber },
    include: { rotationItems: true },
  })
  if (!channel) return false
  return ensurePlayout(channel, channelNumber)
}
