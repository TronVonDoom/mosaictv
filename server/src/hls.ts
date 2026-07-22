import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { hlsDir } from './paths.js'
import { log } from './logs.js'
import { closeSession, openSession, type Session } from './sessions.js'
import { internalConcatUrl, ensureChannelReady } from './streaming/channel.js'
import { readrateBurstArgs } from './streaming/capabilities.js'

// ── Shared HLS output ────────────────────────────────────────────────────────
// One long-lived ffmpeg per channel muxes the channel's normalized item stream
// (the same internal concat pipeline the MPEG-TS path uses) into rolling HLS
// segments on disk. Every viewer is served those files over HTTP — so N viewers
// cost ONE transcode, not N. The encoder starts on the first request and is
// reaped after a short idle grace period.

const SEGMENT_SEC = 4
const LIST_SIZE = 6 // ~24s window of segments kept in the playlist
const IDLE_GRACE_MS = 30_000 // stop the encoder this long after the last request
const READY_TIMEOUT_MS = 12_000 // wait this long for the first segment before saying "starting"
const VIEWER_WINDOW_MS = 20_000 // an IP seen within this window counts as watching

// ready     = playlist has segments, serve it
// starting  = encoder is spinning up (or generating first filler); retry shortly
// unavailable = channel missing or nothing scheduled
export type HlsStatus = 'ready' | 'starting' | 'unavailable'

type ChannelState = {
  proc: ChildProcess | null
  dir: string
  lastAccess: number
  starting: boolean
  startPromise: Promise<HlsStatus>
  viewers: Map<string, number> // ip -> last-seen ms
  // One session per channel here, not per viewer: this encoder is shared, so
  // its log lines belong to the channel rather than to any one player.
  session: Session | null
}

const channels = new Map<number, ChannelState>()

const channelDir = (n: number) => path.join(hlsDir(), String(n))
const playlistFileFor = (n: number) => path.join(channelDir(n), 'index.m3u8')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function playlistReady(file: string): boolean {
  try {
    return fs.readFileSync(file, 'utf8').includes('.ts')
  } catch {
    return false
  }
}

async function startEncoder(n: number, st: ChannelState): Promise<HlsStatus> {
  try {
    if (!(await ensureChannelReady(n))) {
      channels.delete(n) // don't cache an unschedulable channel
      return 'unavailable'
    }

    fs.rmSync(st.dir, { recursive: true, force: true })
    fs.mkdirSync(st.dir, { recursive: true })

    const session = openSession(n, 'hls')
    st.session = session
    const tag = session.tag

    const burst = await readrateBurstArgs(4)
    const args = [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-f', 'concat', '-safe', '0', '-protocol_whitelist', 'file,http,tcp',
      '-probesize', '32',
      // Meter at real time so segments are produced ~1s of media per 1s.
      '-readrate', '1.0', ...burst,
      '-stream_loop', '-1',
      '-i', internalConcatUrl(n, session.id),
      // Inner streams are already normalized to the channel format — remux only.
      '-c', 'copy',
      '-f', 'hls',
      '-hls_time', String(SEGMENT_SEC),
      '-hls_list_size', String(LIST_SIZE),
      '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments+program_date_time',
      '-hls_segment_type', 'mpegts',
      '-hls_allow_cache', '0',
      '-hls_segment_filename', path.join(st.dir, 'seg_%d.ts'),
      playlistFileFor(n),
    ]

    const proc = spawn('ffmpeg', args)
    st.proc = proc
    let stderr = ''
    proc.stderr?.on('data', (d) => (stderr = (stderr + d).slice(-2000)))
    proc.on('error', (e) => log('error', 'ffmpeg', `Channel ${n} HLS encoder failed to spawn`, String(e), tag))
    proc.on('exit', (code, sig) => {
      if (st.proc === proc) st.proc = null
      // 255 / SIGKILL is our own reaper; anything else mid-life is a real fault.
      if (code && code !== 255 && sig !== 'SIGKILL') {
        log('warn', 'ffmpeg', `Channel ${n} HLS encoder exited ${code} — will restart on next request`, stderr || '(no stderr)', tag)
      }
    })

    const end = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < end) {
      if (proc.exitCode !== null) return 'unavailable' // encoder died on startup
      if (playlistReady(playlistFileFor(n))) {
        log('info', 'stream', `▶ Channel ${n} HLS encoder started (shared across viewers)`, undefined, tag)
        return 'ready'
      }
      await sleep(200)
    }
    // Encoder is alive but slow to produce the first segment (e.g. a one-time
    // filler generation). Keep it running — the player will retry and succeed.
    return 'starting'
  } finally {
    st.starting = false
  }
}

/**
 * Note a viewer of the shared encoder. Viewers here are identified by IP rather
 * than by session — they all share one transcode — so the first sighting of an
 * IP is the closest thing to a "connected" event this path has.
 */
function noteViewer(n: number, st: ChannelState, ip: string, client?: string): void {
  if (!st.viewers.has(ip)) {
    log('info', 'stream', `Channel ${n}: ${client || 'a client'} at ${ip} joined the shared HLS stream`, undefined, st.session?.tag)
  }
  st.viewers.set(ip, Date.now())
}

/** Ensure the channel's shared HLS encoder is running; report readiness so the
 *  route can serve (ready), ask the player to retry (starting), or 409
 *  (unavailable = missing / nothing scheduled). */
export async function ensureHls(n: number, ip?: string, client?: string): Promise<HlsStatus> {
  const existing = channels.get(n)
  if (existing) {
    existing.lastAccess = Date.now()
    if (ip) noteViewer(n, existing, ip, client)
    if (existing.proc && existing.proc.exitCode === null) {
      // Running: re-check readiness live (don't return a stale start result).
      return playlistReady(playlistFileFor(n)) ? 'ready' : 'starting'
    }
    if (existing.starting) return existing.startPromise
    // Dead encoder (crashed) — fall through to restart, retiring its session so
    // the restarted encoder logs under a fresh one.
    if (existing.session) closeSession(existing.session.id)
  }
  const st: ChannelState = {
    proc: null,
    dir: channelDir(n),
    lastAccess: Date.now(),
    starting: true,
    startPromise: Promise.resolve('starting'),
    viewers: new Map(ip ? [[ip, Date.now()]] : []),
    session: null,
  }
  channels.set(n, st)
  st.startPromise = startEncoder(n, st)
  return st.startPromise
}

/** Register a segment/playlist fetch so the reaper keeps the encoder alive. */
export function touchHls(n: number, ip?: string, client?: string): void {
  const st = channels.get(n)
  if (!st) return
  st.lastAccess = Date.now()
  if (ip) noteViewer(n, st, ip, client)
}

export const hlsPlaylistFile = (n: number) => playlistFileFor(n)

/** Resolve a segment name to its on-disk path, or null if it's not a valid
 *  segment name (guards the file route against path traversal). */
export function hlsSegmentFile(n: number, name: string): string | null {
  if (!/^seg_\d+\.ts$/.test(name)) return null
  return path.join(channelDir(n), name)
}

/** Approximate viewer count: distinct IPs seen within the recent window. */
export function hlsViewers(n: number): number {
  const st = channels.get(n)
  if (!st) return 0
  const cutoff = Date.now() - VIEWER_WINDOW_MS
  let live = 0
  for (const [ip, seen] of st.viewers) {
    if (seen >= cutoff) live++
    else st.viewers.delete(ip)
  }
  return live
}

function stopChannel(n: number, st: ChannelState): void {
  st.proc?.kill('SIGKILL')
  fs.rm(st.dir, { recursive: true, force: true }, () => {})
  channels.delete(n)
  const tag = st.session?.tag
  if (st.session) closeSession(st.session.id)
  log('info', 'stream', `⏹ Channel ${n} HLS encoder stopped (idle)`, undefined, tag)
}

// Reap idle channels. Unref'd so it never keeps the process alive on its own.
const reaper = setInterval(() => {
  const now = Date.now()
  for (const [n, st] of channels) {
    if (now - st.lastAccess > IDLE_GRACE_MS) stopChannel(n, st)
  }
}, 10_000)
reaper.unref?.()

/** Wipe any stale HLS output from a previous run (called at boot). */
export function resetHls(): void {
  try {
    fs.rmSync(hlsDir(), { recursive: true, force: true })
    fs.mkdirSync(hlsDir(), { recursive: true })
  } catch {
    /* best-effort */
  }
}
