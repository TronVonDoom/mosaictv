import fs from 'node:fs'
import os from 'node:os'
import { log } from './logs.js'
import { activeSessions, sessionSummary } from './sessions.js'

// Resource sampling for diagnosing "what made the box fall over".
//
// The important design point: we sample *continuously* at a low rate and treat
// playout transitions as markers annotated onto that timeline. Sampling only
// when something changes would measure the ffmpeg spawn itself — the spike is
// the transition — and tell us nothing about whether load settled afterwards.
//
// Everything here is best-effort and must never throw: it's diagnostics, and a
// missing cgroup file is not a reason to take a channel down.

export type MetricSample = {
  ts: number // epoch ms
  cpuPct: number // percent of ONE core (so 250 = 2.5 cores busy); -1 if unknown
  memBytes: number // -1 if unknown
  memLimitBytes: number // -1 if unlimited/unknown
  ffmpegCount: number // -1 if unknown
}

export type MetricMarker = {
  id: number
  ts: number
  channel: number
  kind: 'program' | 'filler' | 'song'
  label: string
  detail?: string
}

// The sampler's own source, reported to the UI so a flat -1 graph is
// explainable rather than looking like a bug.
export type MetricSource = 'cgroup2' | 'cgroup1' | 'process' | 'none'

const SAMPLE_MS = 3000
const MAX_SAMPLES = 1200 // ~1 hour at 3s
const MAX_MARKERS = 300

// How often the load line is written to the log. The graph only lives in
// memory, so a downloaded log would otherwise say nothing about what the
// container was doing when a viewer complained — this is the part that
// survives a restart and travels with a bug report.
const HEARTBEAT_MS = 60_000
// While nothing is streaming there's nothing to diagnose, so idle heartbeats
// are thinned to one every this many beats rather than dropped entirely (a gap
// in the log shouldn't be ambiguous between "idle" and "server was down").
const IDLE_EVERY = 5

const samples: MetricSample[] = []
const markers: MetricMarker[] = []
let nextMarkerId = 1
let source: MetricSource = 'none'
const cores = os.cpus().length || 1

// --- cgroup readers ---------------------------------------------------------

function readNum(file: string): number | null {
  try {
    const n = Number(fs.readFileSync(file, 'utf8').trim())
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

// cgroup v2 cpu.stat is a key/value block; usage_usec is cumulative CPU time.
function readCgroup2Cpu(): number | null {
  try {
    const txt = fs.readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8')
    const m = /^usage_usec\s+(\d+)/m.exec(txt)
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

function detectSource(): MetricSource {
  if (readCgroup2Cpu() != null) return 'cgroup2'
  if (readNum('/sys/fs/cgroup/cpuacct/cpuacct.usage') != null) return 'cgroup1'
  return 'process' // dev on Windows/macOS, or an unusual cgroup layout
}

/** Cumulative CPU microseconds for whatever scope `source` covers. */
function cpuUsec(): number | null {
  if (source === 'cgroup2') return readCgroup2Cpu()
  if (source === 'cgroup1') {
    const ns = readNum('/sys/fs/cgroup/cpuacct/cpuacct.usage')
    return ns == null ? null : Math.round(ns / 1000)
  }
  if (source === 'process') {
    // Node's own process only — misses the ffmpeg children that are the whole
    // point, so it's a placeholder for dev, not a real measurement.
    const u = process.cpuUsage()
    return u.user + u.system
  }
  return null
}

function memBytes(): number {
  if (source === 'cgroup2') return readNum('/sys/fs/cgroup/memory.current') ?? -1
  if (source === 'cgroup1') return readNum('/sys/fs/cgroup/memory/memory.usage_in_bytes') ?? -1
  return process.memoryUsage().rss
}

function memLimitBytes(): number {
  if (source === 'cgroup2') {
    try {
      const raw = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim()
      if (raw === 'max') return -1
      const n = Number(raw)
      return Number.isFinite(n) ? n : -1
    } catch {
      return -1
    }
  }
  if (source === 'cgroup1') {
    const n = readNum('/sys/fs/cgroup/memory/memory.limit_in_bytes')
    // cgroup v1 reports "no limit" as a huge sentinel rather than a keyword.
    return n == null || n > Number.MAX_SAFE_INTEGER / 2 ? -1 : n
  }
  return os.totalmem()
}

// Count live ffmpeg processes by scanning /proc. One readdir plus a small read
// per numeric entry every few seconds is negligible next to transcoding.
function ffmpegCount(): number {
  try {
    let n = 0
    for (const pid of fs.readdirSync('/proc')) {
      if (pid.charCodeAt(0) < 48 || pid.charCodeAt(0) > 57) continue
      try {
        if (fs.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() === 'ffmpeg') n++
      } catch {
        /* process exited between readdir and read — normal */
      }
    }
    return n
  } catch {
    return -1
  }
}

// --- sampler ----------------------------------------------------------------

let lastUsec: number | null = null
let lastTs = 0

function sample(): void {
  try {
    const now = Date.now()
    const usec = cpuUsec()
    let cpuPct = -1
    if (usec != null && lastUsec != null && now > lastTs) {
      // Percent of one core: CPU-microseconds burned per wall-microsecond.
      cpuPct = ((usec - lastUsec) / ((now - lastTs) * 1000)) * 100
      // A counter reset (or clock skew) would otherwise post a wild spike.
      if (cpuPct < 0) cpuPct = -1
    }
    lastUsec = usec
    lastTs = now
    samples.push({
      ts: now,
      cpuPct: cpuPct < 0 ? -1 : Math.round(cpuPct * 10) / 10,
      memBytes: memBytes(),
      memLimitBytes: memLimitBytes(),
      ffmpegCount: ffmpegCount(),
    })
    if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES)
  } catch {
    /* diagnostics must never take the server down */
  }
}

// --- load heartbeat ---------------------------------------------------------

const gb = (bytes: number) => (bytes / 1e9).toFixed(2) + ' GB'

let beat = 0

/**
 * Write one line describing container load, periodically. Averaged over the
 * beat rather than instantaneous, so a single unlucky sample at a program
 * boundary doesn't read as sustained load — and paired with the peak, which is
 * what actually breaks a stream.
 */
function heartbeat(): void {
  try {
    const recent = samples.slice(-Math.max(1, Math.round(HEARTBEAT_MS / SAMPLE_MS)))
    const last = samples[samples.length - 1]
    if (!last) return
    const cpus = recent.map((s) => s.cpuPct).filter((v) => v >= 0)
    const avg = cpus.length ? cpus.reduce((a, b) => a + b, 0) / cpus.length : -1
    const peak = cpus.length ? Math.max(...cpus) : -1
    const ffmpeg = last.ffmpegCount
    const idle = ffmpeg <= 0 && activeSessions().length === 0
    if (idle && beat++ % IDLE_EVERY !== 0) return

    const capacity = cores * 100
    const cpuPart =
      avg < 0
        ? `CPU unknown (sampling via ${source})`
        : `CPU ${avg.toFixed(0)}% avg / ${peak.toFixed(0)}% peak of ${capacity}% (${cores} cores)`
    const memPart =
      last.memBytes < 0
        ? 'memory unknown'
        : `memory ${gb(last.memBytes)}${last.memLimitBytes > 0 ? ' of ' + gb(last.memLimitBytes) : ''}`
    const ffPart = ffmpeg < 0 ? 'ffmpeg count unknown' : `${ffmpeg} ffmpeg process(es)`

    // A healthy heartbeat is background noise — it belongs in the log for the
    // timeline it builds, not in anyone's face — so it goes in at debug. Load
    // that a viewer would actually feel is raised to info: near-saturated CPU
    // means the encoders can't keep real time, and a near-full memory limit
    // means the OOM killer is next. 'warn' stays reserved for real faults.
    const hot = avg >= 0 && avg > capacity * 0.9
    const tight = last.memLimitBytes > 0 && last.memBytes > last.memLimitBytes * 0.9
    const why = hot && tight ? ' — CPU and memory both near their limit' : hot ? ' — CPU near saturation, encoders may fall behind real time' : tight ? ' — close to the memory limit' : ''

    log(
      hot || tight ? 'info' : 'debug',
      'system',
      `Container load: ${cpuPart}, ${memPart}, ${ffPart}${why}`,
      sessionSummary(),
    )
  } catch {
    /* diagnostics must never take the server down */
  }
}

let timer: NodeJS.Timeout | null = null
let beatTimer: NodeJS.Timeout | null = null

/** Begin sampling. Safe to call twice; the second call is a no-op. */
export function startMetrics(): MetricSource {
  if (timer) return source
  source = detectSource()
  sample() // prime the CPU delta so the first real sample is usable
  timer = setInterval(sample, SAMPLE_MS)
  timer.unref() // never hold the process open for diagnostics
  beatTimer = setInterval(heartbeat, HEARTBEAT_MS)
  beatTimer.unref()
  return source
}

/**
 * Annotate the timeline with a playout transition. Called when a segment
 * starts, so a CPU step change can be attributed to the item that caused it.
 */
export function markEvent(channel: number, kind: MetricMarker['kind'], label: string, detail?: string): void {
  markers.push({ id: nextMarkerId++, ts: Date.now(), channel, kind, label, detail })
  if (markers.length > MAX_MARKERS) markers.splice(0, markers.length - MAX_MARKERS)
}

/** Samples and markers from the last `minutes` (default: everything held). */
export function getMetrics(minutes?: number): {
  source: MetricSource
  cores: number
  sampleMs: number
  samples: MetricSample[]
  markers: MetricMarker[]
} {
  const cutoff = minutes && minutes > 0 ? Date.now() - minutes * 60_000 : 0
  return {
    source,
    cores,
    sampleMs: SAMPLE_MS,
    samples: cutoff ? samples.filter((s) => s.ts >= cutoff) : samples.slice(),
    markers: cutoff ? markers.filter((m) => m.ts >= cutoff) : markers.slice(),
  }
}
