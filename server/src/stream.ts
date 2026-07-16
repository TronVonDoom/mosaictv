import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Request, Response } from 'express'
import { prisma } from './db.js'
import { buildPlayout, prunePlayout } from './playout.js'
import { assetsDir, dataDir, logoCacheDir, logosDir } from './paths.js'
import { log } from './logs.js'

// Fixed canvas for generated filler clips (playback scales them to the channel's
// profile, so filler needn't match the channel resolution).
const W = 1280
const H = 720
const FPS = 30

// Resolved per-channel output settings the stream pipeline builds ffmpeg from.
export type ScalingMode = 'pad' | 'stretch' | 'crop'
export const SCALING_MODES: ScalingMode[] = ['pad', 'stretch', 'crop']

// Encoder speed presets, per encoder. "auto" keeps our own sensible default.
export const PRESETS: Record<string, string[]> = {
  libx264: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower'],
  h264_nvenc: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
}
const ALL_PRESETS = new Set(Object.values(PRESETS).flat())

export type StreamProfile = {
  width: number
  height: number
  fps: number
  quality: 'low' | 'medium' | 'high'
  hwaccel: 'auto' | 'nvidia' | 'cpu'
  audioBitrate: number // kbps
  preset: string // "auto" or an encoder-specific preset
  videoBitrateK: number // 0 = derive from quality
  videoBufferK: number // 0 = derive from bitrate
  scalingMode: ScalingMode
  deinterlace: boolean
  threads: number // 0 = ffmpeg default
  audioChannels: number
  normalizeLoudness: boolean
}
export const DEFAULT_PROFILE: StreamProfile = {
  width: 1280,
  height: 720,
  fps: 30,
  quality: 'medium',
  hwaccel: 'auto',
  audioBitrate: 192,
  preset: 'auto',
  videoBitrateK: 0,
  videoBufferK: 0,
  scalingMode: 'pad',
  deinterlace: true,
  threads: 0,
  audioChannels: 2,
  normalizeLoudness: false,
}

type ProfileRow = {
  width: number
  height: number
  fps: number
  quality: string
  hwaccel: string
  audioBitrate: number
  preset?: string | null
  videoBitrateK?: number | null
  videoBufferK?: number | null
  scalingMode?: string | null
  deinterlace?: boolean | null
  threads?: number | null
  audioChannels?: number | null
  normalizeLoudness?: boolean | null
} | null

/** Clamp a DB profile row (or null) into a valid StreamProfile. */
export function resolveProfile(p: ProfileRow): StreamProfile {
  if (!p) return DEFAULT_PROFILE
  const quality = ['low', 'medium', 'high'].includes(p.quality) ? (p.quality as StreamProfile['quality']) : 'medium'
  const hwaccel = ['auto', 'nvidia', 'cpu'].includes(p.hwaccel) ? (p.hwaccel as StreamProfile['hwaccel']) : 'auto'
  // Even dimensions (libx264/yuv420p require it); clamp to sane bounds.
  const even = (n: number, d: number) => {
    const v = Math.round(Number(n) || d)
    return Math.max(160, v - (v % 2))
  }
  const int = (v: unknown, def: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Math.round(Number(v) || def)))
  const preset = p.preset && ALL_PRESETS.has(p.preset) ? p.preset : 'auto'
  return {
    width: even(p.width, 1280),
    height: even(p.height, 720),
    fps: Math.max(1, Math.min(120, Math.round(Number(p.fps) || 30))),
    quality,
    hwaccel,
    audioBitrate: Math.max(32, Math.min(512, Math.round(Number(p.audioBitrate) || 192))),
    preset,
    videoBitrateK: int(p.videoBitrateK, 0, 0, 100_000),
    videoBufferK: int(p.videoBufferK, 0, 0, 200_000),
    scalingMode: SCALING_MODES.includes(p.scalingMode as ScalingMode) ? (p.scalingMode as ScalingMode) : 'pad',
    deinterlace: p.deinterlace ?? true,
    threads: int(p.threads, 0, 0, 64),
    // Stereo or 5.1; anything else risks clients that can't decode it.
    audioChannels: p.audioChannels === 6 ? 6 : 2,
    normalizeLoudness: !!p.normalizeLoudness,
  }
}

export type WatermarkConfig = {
  mode: 'permanent' | 'intermittent' | 'none'
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  widthPercent: number
  horizontalMarginPercent: number
  verticalMarginPercent: number
  opacityPercent: number
  frequencyMinutes: number
  durationSeconds: number
  // One fade length, used wherever the logo appears or disappears: the
  // intermittent cycle, and the hand-off to and from filler.
  fadeSeconds: number
  // Filler usually *is* the logo (logo wall, pulse, frosted), so a corner bug on
  // top is a second one. Off by default.
  showOnFiller: boolean
  // When true, size/position the logo relative to the actual media rectangle
  // (respecting the source aspect, e.g. 4:3 pillarboxed content) instead of the
  // full 1280x720 output canvas — so the watermark stays over the picture.
  constrainToMedia: boolean
}

export const DEFAULT_WATERMARK: WatermarkConfig = {
  mode: 'permanent',
  position: 'bottom-right',
  widthPercent: 10,
  horizontalMarginPercent: 4,
  verticalMarginPercent: 4,
  opacityPercent: 85,
  frequencyMinutes: 5,
  durationSeconds: 30,
  fadeSeconds: 1,
  showOnFiller: false,
  constrainToMedia: false,
}

/** Parse a stored WatermarkConfig JSON blob, filling gaps from `base`. */
export function parseWatermark(json: string | null | undefined, base: WatermarkConfig = DEFAULT_WATERMARK): WatermarkConfig {
  if (!json) return base
  try {
    return { ...base, ...(JSON.parse(json) as Partial<WatermarkConfig>) }
  } catch {
    return base
  }
}

/** Clamp an incoming (untrusted) watermark config to valid ranges/enums. */
export function sanitizeWatermark(input: unknown): WatermarkConfig {
  const wm = { ...DEFAULT_WATERMARK, ...((input as Partial<WatermarkConfig>) ?? {}) }
  const modes: WatermarkConfig['mode'][] = ['permanent', 'intermittent', 'none']
  const positions: WatermarkConfig['position'][] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  return {
    mode: modes.includes(wm.mode) ? wm.mode : 'permanent',
    position: positions.includes(wm.position) ? wm.position : 'bottom-right',
    widthPercent: Math.max(1, Math.min(50, Number(wm.widthPercent) || 10)),
    horizontalMarginPercent: Math.max(0, Math.min(45, Number(wm.horizontalMarginPercent) || 0)),
    verticalMarginPercent: Math.max(0, Math.min(45, Number(wm.verticalMarginPercent) || 0)),
    opacityPercent: Math.max(0, Math.min(100, Number(wm.opacityPercent) || 85)),
    frequencyMinutes: Math.max(1, Number(wm.frequencyMinutes) || 5),
    durationSeconds: Math.max(1, Number(wm.durationSeconds) || 30),
    fadeSeconds: Math.max(0, Number(wm.fadeSeconds) || 0),
    showOnFiller: !!wm.showOnFiller,
    constrainToMedia: !!wm.constrainToMedia,
  }
}

export async function loadWatermark(): Promise<WatermarkConfig> {
  const s = await prisma.setting.findUnique({ where: { key: 'watermark' } })
  return parseWatermark(s?.value)
}

let encoderCache: string | null = null

/** Detect once whether NVIDIA nvenc is available; fall back to libx264. */
function detectEncoder(): Promise<string> {
  if (encoderCache) return Promise.resolve(encoderCache)
  return new Promise((resolve) => {
    let out = ''
    const p = spawn('ffmpeg', ['-hide_banner', '-encoders'])
    p.stdout.on('data', (d) => (out += d))
    p.on('error', () => {
      log('warn', 'ffmpeg', 'Could not run ffmpeg to detect encoders; falling back to libx264')
      resolve((encoderCache = 'libx264'))
    })
    p.on('close', () => {
      const enc = out.includes('h264_nvenc') ? 'h264_nvenc' : 'libx264'
      log('info', 'ffmpeg', `Video encoder selected: ${enc}`)
      resolve((encoderCache = enc))
    })
  })
}

/** Pick the actual encoder given the profile's hardware-accel choice. */
async function resolveEncoder(hwaccel: StreamProfile['hwaccel']): Promise<string> {
  if (hwaccel === 'cpu') return 'libx264'
  const avail = await detectEncoder()
  if (hwaccel === 'nvidia') {
    if (avail !== 'h264_nvenc') log('warn', 'ffmpeg', 'Profile requests NVIDIA but nvenc is unavailable — using CPU (libx264)')
    return avail
  }
  return avail // auto
}

// Video quality → bitrate ladder (nvenc VBR) / CRF (libx264), scaled a bit by
// resolution so 1080p isn't starved at the same numbers as 720p.
const QUALITY = {
  low: { bitrate: 2.5, crf: '26' },
  medium: { bitrate: 5, crf: '23' },
  high: { bitrate: 8, crf: '20' },
} as const

function encoderArgs(enc: string, p: StreamProfile): string[] {
  const g = String(Math.max(2, p.fps * 2))
  const q = QUALITY[p.quality]
  const scale = (p.width * p.height) / (1280 * 720) // relative to 720p
  const mbps = (n: number) => `${(Math.max(0.5, n) * Math.max(1, Math.min(2.5, scale))).toFixed(1)}M`
  // An explicit bitrate wins over the quality ladder; buffer defaults to 2x it.
  const kbps = (n: number) => `${Math.max(1, Math.round(n))}k`
  const bv = p.videoBitrateK > 0 ? kbps(p.videoBitrateK) : mbps(q.bitrate)
  const maxrate = p.videoBitrateK > 0 ? kbps(p.videoBitrateK * 1.6) : mbps(q.bitrate * 1.6)
  const bufsize =
    p.videoBufferK > 0
      ? kbps(p.videoBufferK)
      : p.videoBitrateK > 0
        ? kbps(p.videoBitrateK * 2)
        : mbps(q.bitrate * 2)
  const preset = (fallback: string) => (p.preset !== 'auto' && PRESETS[enc]?.includes(p.preset) ? p.preset : fallback)

  // No B-frames. They make DTS run ahead of PTS by the reorder delay (measured
  // at 200ms on nvenc), and each segment is a separate encoder whose output we
  // splice with -output_ts_offset — so the next segment's first DTS lands
  // *before* the previous segment's last one, and players drop video at the
  // seam and never recover. Costs a little compression; buys a working splice.
  const noBFrames = ['-bf', '0']

  if (enc === 'h264_nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', preset('p4'), '-rc', 'vbr', '-b:v', bv, '-maxrate', maxrate, '-bufsize', bufsize, '-g', g, ...noBFrames, '-pix_fmt', 'yuv420p']
  }
  // libx264 uses CRF unless an explicit bitrate asks for rate control.
  const rate = p.videoBitrateK > 0 ? ['-b:v', bv, '-maxrate', maxrate] : ['-crf', q.crf, '-maxrate', maxrate]
  return ['-c:v', 'libx264', '-preset', preset('veryfast'), ...rate, '-bufsize', bufsize, '-g', g, ...noBFrames, '-pix_fmt', 'yuv420p']
}

type Segment = {
  filePath: string
  offsetSec: number // seek into the file (first item only)
  durationSec?: number // cap output length (filler loop); undefined = play to EOF
  loop: boolean // loop the input (filler)
  hasAudio: boolean
  logo?: string // logo file path or http url
  wmEpochSec: number // segment's absolute start time (s) — aligns intermittent watermark to wall clock
  mediaWidth: number // source pixel dims (for constrain-to-media watermark)
  mediaHeight: number
  musicPath?: string // looped ambient audio (filler only) — overrides clip audio
  isFiller: boolean
  // Ramp the watermark up/down across a boundary where it is about to appear or
  // disappear (i.e. next to filler that isn't showing it). 0 = no ramp.
  fadeInSec: number
  fadeOutSec: number
}

// Sample aspect ratio per file. The scanner records coded dimensions, but
// anamorphic sources (720x480 DVD rips at SAR 8:9) *display* at a different
// shape — and the stream de-anamorphizes with scale=iw*sar:ih, so the picture
// on the canvas is the SAR-corrected one. Using coded dims to place the
// watermark puts it on the pillarbars. Probed once per file, then cached.
const sarCache = new Map<string, number>()
function probeSar(filePath: string): Promise<number> {
  const hit = sarCache.get(filePath)
  if (hit !== undefined) return Promise.resolve(hit)
  return new Promise((resolve) => {
    const done = (v: number) => {
      sarCache.set(filePath, v)
      resolve(v)
    }
    let out = ''
    const p = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=sample_aspect_ratio',
      '-of', 'default=nw=1:nk=1',
      filePath,
    ])
    p.stdout.on('data', (d) => (out += d))
    p.on('error', () => done(1))
    p.on('close', () => {
      // "8:9" -> 0.888…; "N/A", "0:1" and anything odd mean square pixels.
      const m = out.trim().match(/^(\d+):(\d+)$/)
      const n = m ? Number(m[1]) : 0
      const d = m ? Number(m[2]) : 0
      done(n > 0 && d > 0 ? n / d : 1)
    })
  })
}

// The rectangle the picture occupies inside the WxH output canvas after
// aspect-preserving fit (pillar/letterbox). Used to constrain the watermark to
// the media. When not constraining, this is the whole canvas.
type Rect = { x0: number; y0: number; mw: number; mh: number }
function mediaRect(mediaW: number, mediaH: number, constrain: boolean, cw: number, ch: number): Rect {
  if (!constrain || !mediaW || !mediaH) return { x0: 0, y0: 0, mw: cw, mh: ch }
  const ar = mediaW / mediaH
  const canvasAR = cw / ch
  let mw: number
  let mh: number
  if (ar >= canvasAR) {
    mw = cw
    mh = Math.round(cw / ar)
  } else {
    mh = ch
    mw = Math.round(ch * ar)
  }
  return { x0: Math.round((cw - mw) / 2), y0: Math.round((ch - mh) / 2), mw, mh }
}

// Build the logo scale + opacity chain, overlay position, and (for intermittent
// mode) a timeline `enable` expression that shows the logo for `durationSeconds`
// every `frequencyMinutes`, aligned to wall-clock time so every viewer sees it
// at the same moment. `wmEpochSec` is the segment's absolute start time in
// seconds; `t` inside the expression is the segment-relative time.
/**
 * Whether the watermark needs a per-frame alpha ramp (vs a cheap static alpha):
 * either the intermittent cycle fades, or it has to ramp across a filler edge.
 */
function wantsFade(wm: WatermarkConfig, seg?: Pick<Segment, 'fadeInSec' | 'fadeOutSec'>): boolean {
  const cycleFades = wm.mode === 'intermittent' && Math.min(wm.fadeSeconds, wm.durationSeconds / 2) > 0
  const edgeFades = (seg?.fadeInSec ?? 0) > 0 || (seg?.fadeOutSec ?? 0) > 0
  return cycleFades || edgeFades
}

function watermarkGraph(
  wm: WatermarkConfig,
  logoIdx: number,
  wmEpochSec: number,
  rect: Rect,
  fps: number,
  fading: boolean,
  fadeInSec: number,
  fadeOutSec: number,
  totalFrames: number,
): { logoChain: string; overlayPos: string; overlayExtra: string } {
  const LW = Math.max(2, Math.round((rect.mw * wm.widthPercent) / 100))
  const MX = Math.round((rect.mw * wm.horizontalMarginPercent) / 100)
  const MY = Math.round((rect.mh * wm.verticalMarginPercent) / 100)
  const left = rect.x0 + MX
  const top = rect.y0 + MY
  const right = rect.x0 + rect.mw - MX // right edge of the logo box
  const bottom = rect.y0 + rect.mh - MY // bottom edge of the logo box
  const positions: Record<string, string> = {
    'top-left': `${left}:${top}`,
    'top-right': `${right}-w:${top}`,
    'bottom-left': `${left}:${bottom}-h`,
    'bottom-right': `${right}-w:${bottom}-h`,
  }
  const overlayPos = positions[wm.position] ?? positions['bottom-right']
  const opacity = Math.max(0, Math.min(1, wm.opacityPercent / 100))
  const BO = opacity.toFixed(3)
  const scale = `[${logoIdx}:v]scale=${LW}:-2`

  const P = Math.max(1, Math.round(wm.frequencyMinutes * 60)) // period, seconds
  const D = Math.max(1, Math.round(wm.durationSeconds)) // visible window, seconds

  if (!fading) {
    // Static alpha via colorchannelmixer — cheap and reliable. Intermittent
    // still gates on a wall-clock-aligned window; permanent just stays on.
    return {
      logoChain: `${scale},format=rgba,colorchannelmixer=aa=${BO}[lg]`,
      overlayPos,
      // Single-quoted so the commas aren't parsed as filtergraph separators.
      overlayExtra:
        wm.mode === 'intermittent' ? `:enable='lt(mod(t+${wmEpochSec.toFixed(1)},${P}),${D})'` : '',
    }
  }

  // Per-frame alpha, which `enable` (a hard on/off) can't express and
  // colorchannelmixer (one static value) can't either — so drive it with geq.
  //
  // Two constraints, both learned the hard way:
  //  - geq must get PLANAR rgba (gbrap); on packed rgba it silently corrupts.
  //  - geq's `T` is broken in ffmpeg 8.1, but frame number `N` works, so the
  //    envelope is expressed in frames. N counts from this segment's first
  //    frame, which is what the edge ramps below want anyway.
  const terms: string[] = []

  if (wm.mode === 'intermittent') {
    const fade = Math.max(0, Math.min(wm.fadeSeconds, D / 2)) // can't fade longer than half the window
    const PF = Math.max(1, Math.round(P * fps))
    const DF = Math.max(1, Math.round(D * fps))
    // Phase-shift by the segment's wall-clock start so the cycle stays
    // continuous across segments and every viewer sees it at the same moment.
    const PH = Math.round(wmEpochSec * fps) % PF
    const n = `mod(N+${PH},${PF})` // frames since the window opened
    if (fade > 0) {
      const FF = Math.max(1, Math.round(fade * fps))
      // Ramp up over FF, hold, ramp down to zero at DF, dark until the period wraps.
      terms.push(`clip(min(${n}/${FF},(${DF}-${n})/${FF}),0,1)`)
    } else {
      terms.push(`lt(${n},${DF})`) // hard on/off window
    }
  }

  // Edge ramps for a boundary with filler that isn't showing the logo.
  if (fadeInSec > 0) {
    terms.push(`clip(N/${Math.max(1, Math.round(fadeInSec * fps))},0,1)`)
  }
  if (fadeOutSec > 0 && totalFrames > 0) {
    terms.push(`clip((${totalFrames}-N)/${Math.max(1, Math.round(fadeOutSec * fps))},0,1)`)
  }

  // Scale the logo's OWN alpha — never replace it. A constant here would make
  // every pixel opaque, turning the transparent surround (which is transparent
  // *black*) into a solid box behind the logo.
  const env = terms.length ? terms.join('*') : '1'
  const alpha = `alpha(X,Y)*${opacity.toFixed(3)}*${env}`
  const logoChain = `${scale},format=gbrap,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'[lg]`
  return { logoChain, overlayPos, overlayExtra: '' }
}

function ffmpegArgs(seg: Segment, enc: string, wm: WatermarkConfig, p: StreamProfile): string[] {
  // Filler is usually built out of the logo already, so the bug goes on top of
  // it only if explicitly asked for.
  const useWatermark = wm.mode !== 'none' && !!seg.logo && (!seg.isFiller || wm.showOnFiller)
  // Fading loops the still logo into an endless stream, which only terminates
  // because `-t` caps the output — so require a known positive duration and
  // fall back to a hard cut otherwise rather than risk a stream that never ends.
  const fading = useWatermark && wantsFade(wm, seg) && (seg.durationSec ?? 0) > 0
  const a: string[] = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-fflags', '+genpts']
  if (seg.offsetSec > 0.1) a.push('-ss', seg.offsetSec.toFixed(3))
  if (seg.loop) a.push('-stream_loop', '-1')
  // Deliberately NOT -re: the outer concat process meters the session at real
  // time, and two pacers in series just starve each other. Unpaced, this races
  // ahead until the pipe backs up, which keeps a little of the item buffered
  // and ready the moment the previous one ends.
  a.push('-i', seg.filePath) // input 0 = main video

  let idx = 1
  let logoIdx = -1
  if (useWatermark) {
    logoIdx = idx++
    // A still logo decodes to a single frame, which overlay just repeats — fine
    // for a static alpha, but the fade envelope is driven by the logo's own
    // frame counter, so it needs a real stream ticking at the profile's rate.
    if (fading) a.push('-loop', '1', '-framerate', String(p.fps))
    a.push('-i', seg.logo as string)
  }
  // Audio source: ambient music (looped) overrides the clip's own audio; else
  // silence when the source has none.
  let audioIdx = -1 // -1 = use the main input's audio (0:a)
  if (seg.musicPath) {
    audioIdx = idx++
    a.push('-stream_loop', '-1', '-i', seg.musicPath)
  } else if (!seg.hasAudio) {
    audioIdx = idx++
    a.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
  }
  if (seg.durationSec) a.push('-t', seg.durationSec.toFixed(3))

  // Deinterlace before scaling, or the comb artifacts get resampled into the
  // output. `deint=interlaced` only touches frames actually flagged interlaced,
  // so progressive material passes through untouched — that's the "auto" part.
  const deint = p.deinterlace ? 'yadif=deint=interlaced,' : ''
  // De-anamorphize (scale=iw*sar:ih) so non-square-pixel sources (e.g. 720x480
  // DVD content) aren't horizontally stretched, then fit to the profile
  // resolution. Reset per-segment timestamps so concatenated segments stay in sync.
  const fit =
    p.scalingMode === 'stretch'
      ? `scale=${p.width}:${p.height}`
      : p.scalingMode === 'crop'
        ? `scale=${p.width}:${p.height}:force_original_aspect_ratio=increase,crop=${p.width}:${p.height}`
        : `scale=${p.width}:${p.height}:force_original_aspect_ratio=decrease,pad=${p.width}:${p.height}:(ow-iw)/2:(oh-ih)/2`
  const base = `[0:v]${deint}scale=iw*sar:ih,${fit},setsar=1,fps=${p.fps},format=yuv420p,setpts=PTS-STARTPTS`
  let vf: string
  if (useWatermark) {
    // Only "pad" leaves bars to stay clear of; stretch and crop fill the canvas.
    const constrain = wm.constrainToMedia && p.scalingMode === 'pad'
    const rect = mediaRect(seg.mediaWidth, seg.mediaHeight, constrain, p.width, p.height)
    const totalFrames = Math.round((seg.durationSec ?? 0) * p.fps)
    const wg = watermarkGraph(wm, logoIdx, seg.wmEpochSec, rect, p.fps, fading, seg.fadeInSec, seg.fadeOutSec, totalFrames)
    vf = `${base}[bg];${wg.logoChain};[bg][lg]overlay=${wg.overlayPos}${wg.overlayExtra}[v]`
  } else {
    vf = `${base}[v]`
  }
  const aIn = audioIdx >= 0 ? `${audioIdx}:a:0` : '0:a:0'
  const layout = p.audioChannels === 6 ? '5.1' : 'stereo'
  // Evens out the jump between a 1970s sitcom and a modern show. dynaudnorm,
  // not loudnorm: loudnorm looks 3s ahead, and since the muxer can't interleave
  // without audio, that became 3s of dead air at every single transition
  // (measured: 1.0s -> 3.0s to first byte). dynaudnorm adapts continuously and
  // costs nothing at startup — less exact than R128, but this is live TV.
  const loud = p.normalizeLoudness ? 'dynaudnorm=f=150:g=5,' : ''
  const af = `[${aIn}]asetpts=PTS-STARTPTS,${loud}aresample=48000,aformat=channel_layouts=${layout}[a]`

  a.push('-filter_complex', `${vf};${af}`, '-map', '[v]', '-map', '[a]')
  if (p.threads > 0) a.push('-threads', String(p.threads))
  a.push(...encoderArgs(enc, p))
  a.push('-c:a', 'aac', '-ar', '48000', '-ac', String(p.audioChannels), '-b:a', `${p.audioBitrate}k`)
  // Each item starts at timestamp 0 (setpts above) and is stitched to the
  // previous one by the outer concat process. We deliberately do NOT offset
  // timestamps here any more: doing it by hand is what put DTS backwards at
  // every seam.
  a.push('-mpegts_flags', '+resend_headers', '-f', 'mpegts', '-muxpreload', '0', '-muxdelay', '0', 'pipe:1')
  return a
}

// The block active at a given local time (first match wins). Generic so callers
// keep whatever relations they included (collection, fillers, …).
function activeBlockAt<T extends { days: string; startMinute: number; endMinute: number }>(blocks: T[], date: Date): T | null {
  const day = date.getDay()
  const prev = (day + 6) % 7
  const tod = date.getHours() * 60 + date.getMinutes()
  for (const b of blocks) {
    const days = b.days.split(',').map((s) => Number(s.trim()))
    if (b.endMinute > b.startMinute) {
      if (days.includes(day) && tod >= b.startMinute && tod < b.endMinute) return b
    } else {
      if (days.includes(day) && tod >= b.startMinute) return b
      if (days.includes(prev) && tod < b.endMinute) return b
    }
  }
  return null
}

// The logo active at a given time: block override → the block's collection logo
// → channel default. Returns the Logo row id (for its per-logo watermark) and the
// raw file path / URL to overlay.
function activeLogo(
  channel: { logoId: number | null; logoUrl: string | null },
  blocks: Array<{ days: string; startMinute: number; endMinute: number; logoId: number | null; logoUrl: string | null; collection: { logoId: number | null } }>,
  logoPath: Map<number, string>,
  at: Date,
): { id: number | null; raw: string | null } {
  const block = activeBlockAt(blocks, at)
  const id = block?.logoId ?? block?.collection.logoId ?? channel.logoId
  if (id != null && logoPath.has(id)) return { id, raw: logoPath.get(id) as string }
  return { id: null, raw: block?.logoUrl || channel.logoUrl || null }
}

// Resolve a logo (local path or http url) to a usable local file, downloading
// and caching http logos. Falls back to the bundled icon so a bad URL never
// breaks the stream.
const logoCache = new Map<string, string | undefined>()
async function localLogo(raw: string | null): Promise<string | undefined> {
  const fallback = path.join(process.cwd(), 'public', 'mesatztv-icon.png')
  const fb = fs.existsSync(fallback) ? fallback : undefined
  if (!raw) return fb
  if (logoCache.has(raw)) return logoCache.get(raw)

  let result: string | undefined
  if (/^https?:\/\//i.test(raw)) {
    try {
      const r = await fetch(raw)
      if (r.ok) {
        const file = path.join(logoCacheDir(), createHash('md5').update(raw).digest('hex') + '.png')
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()))
        result = file
      }
    } catch {
      /* ignore — fall back below */
    }
  } else if (fs.existsSync(raw)) {
    result = raw
  }
  result = result ?? fb
  logoCache.set(raw, result)
  return result
}

export type ProgressCb = (percent: number) => void

// Run a generation ffmpeg (output goes to a file, so stdout is free for the
// -progress feed). When onProgress+totalSec are given, report 0..99% from the
// output timestamp. NOTE: only for generation — never for the streaming pipe.
function runFfmpeg(args: string[], onProgress?: ProgressCb, totalSec?: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-progress', 'pipe:1', ...args])
    let err = ''
    p.stderr?.on('data', (d) => (err += d))
    if (onProgress && totalSec && totalSec > 0) {
      let buf = ''
      p.stdout?.on('data', (d) => {
        buf += d.toString()
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          // out_time_us and out_time_ms are both microseconds in ffmpeg's feed.
          const m = line.match(/^out_time_(?:us|ms)=(\d+)/)
          if (m) onProgress(Math.max(0, Math.min(99, Math.round((Number(m[1]) / 1e6 / totalSec) * 100))))
        }
      })
    } else {
      p.stdout?.on('data', () => {}) // drain
    }
    p.on('error', reject)
    p.on('close', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg exited ' + c + ': ' + err.slice(-500)))))
  })
}

const clampDur = (d: number) => Math.max(5, Math.min(600, Math.round(d) || 30))

// Audio input for a generated clip: a chosen track (looped) baked in, else a
// soft tone. `-shortest`/`-t` cap the output to the video length.
function audioInput(audioFile: string | undefined, dur: number, toneHz: number, vol: number): string[] {
  return audioFile
    ? ['-stream_loop', '-1', '-i', audioFile]
    : ['-f', 'lavfi', '-i', `sine=f=${toneHz}:d=${dur},volume=${vol}`]
}

// Preferred look: a drifting color gradient with a slow hue sway, animated
// grain and a vignette (visible motion to keep viewers hanging tight). Loops
// smoothly (hue uses a sine that returns to 0 at the end).
function fillerArgsAnimated(out: string, dur: number, audioFile?: string): string[] {
  return [
    '-y',
    '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:d=${dur}:speed=0.05:c0=0x0b1020:c1=0x3b1d60:c2=0x1e3a8a:c3=0x0e7490:nb_colors=4`,
    ...audioInput(audioFile, dur, 110, 0.05),
    '-filter_complex',
    `[0:v]hue=H='0.5*sin(2*PI*t/${dur})':s='1.05+0.05*sin(2*PI*t/${dur})',noise=alls=6:allf=t,vignette=PI/4.5,fps=${FPS},format=yuv420p[v]`,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-shortest', out,
  ]
}
// Proven fallback (the original) in case a filter isn't available on this build.
function fillerArgsBasic(out: string, dur: number, audioFile?: string): string[] {
  return [
    '-y',
    '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:d=${dur}:speed=0.02:c0=0x111827:c1=0x4c1d95:c2=0x1e3a8a:c3=0x0e7490:nb_colors=4`,
    ...audioInput(audioFile, dur, 98, 0.06),
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-shortest', out,
  ]
}

/** Generate a loopable ambient "please stand by" clip (animated, with a fallback). */
export async function generateFiller(out: string, dur = 30, audioFile?: string, onProgress?: ProgressCb): Promise<void> {
  const d = clampDur(dur)
  try {
    await runFfmpeg(fillerArgsAnimated(out, d, audioFile), onProgress, d)
  } catch (e) {
    log('warn', 'system', 'Animated filler failed, using basic gradient fallback', String(e))
    await runFfmpeg(fillerArgsBasic(out, d, audioFile), onProgress, d)
  }
}

// ---- Themed filler presets ------------------------------------------------

// Retro test bars: classic SMPTE color bars with soft analog grain + vignette
// (and the traditional test tone unless audio is chosen).
function fillerArgsRetro(out: string, dur: number, audioFile?: string): string[] {
  return [
    '-y',
    '-f', 'lavfi', '-i', `smptehdbars=s=${W}x${H}:d=${dur}`,
    ...audioInput(audioFile, dur, 440, 0.04),
    '-filter_complex',
    `[0:v]noise=alls=10:allf=t,vignette=PI/5,fps=${FPS},format=yuv420p[v]`,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-shortest', out,
  ]
}

// Vintage film: warm sepia drift with heavy grain and a strong vignette.
function fillerArgsVintage(out: string, dur: number, audioFile?: string): string[] {
  return [
    '-y',
    '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:d=${dur}:speed=0.03:c0=0x2b1a0c:c1=0x4a3018:c2=0x1c1108:c3=0x5a4526:nb_colors=4`,
    ...audioInput(audioFile, dur, 82, 0.05),
    '-filter_complex',
    `[0:v]hue=s=0.35,noise=alls=16:allf=t+u,vignette=PI/3.8,fps=${FPS},format=yuv420p[v]`,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-shortest', out,
  ]
}

// Logo wall: dim rows of the logo scrolling in alternating directions over a
// dark gradient, with a sharp logo centered in front. (Frosted's machinery,
// without the glass blur.)
function fillerArgsLogowall(out: string, logoFile: string, dur: number, audioFile?: string): string[] {
  const rowH = 90
  const cellW = 260
  const speed = 40
  const y = (r: number) => r * 180 + 45 // 4 rows across 720
  const leftX = `x='-mod(t*${speed},${cellW})'`
  const rightX = `x='mod(t*${speed},${cellW})-${cellW}'`
  const fc = [
    `[0:v]format=rgba[bg]`,
    `[1:v]split=2[wall][fgin]`,
    `[wall]scale=${cellW}:${rowH}:force_original_aspect_ratio=decrease,pad=${cellW}:${rowH}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,colorchannelmixer=aa=0.16,tile=8x1,split=4[t0][t1][t2][t3]`,
    `[bg][t0]overlay=${leftX}:y=${y(0)}[o0]`,
    `[o0][t1]overlay=${rightX}:y=${y(1)}[o1]`,
    `[o1][t2]overlay=${leftX}:y=${y(2)}[o2]`,
    `[o2][t3]overlay=${rightX}:y=${y(3)}[o3]`,
    `[fgin]scale=-1:200:force_original_aspect_ratio=decrease,format=rgba[fg]`,
    `[o3][fg]overlay=x=(W-w)/2:y=(H-h)/2,fps=${FPS},format=yuv420p[v]`,
  ].join(';')
  return [
    '-y',
    '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:d=${dur}:speed=0.02:c0=0x0a0f1e:c1=0x141b2e:c2=0x0c1526:c3=0x1a2338:nb_colors=4`,
    '-loop', '1', '-i', logoFile,
    ...audioInput(audioFile, dur, 104, 0.05),
    '-filter_complex', fc,
    '-map', '[v]', '-map', '2:a', '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', out,
  ]
}

// Logo pulse: the logo centered on a dark gradient whose brightness slowly
// breathes.
function fillerArgsPulse(out: string, logoFile: string, dur: number, audioFile?: string): string[] {
  const fc = [
    `[0:v]eq=brightness='0.07*sin(2*PI*t/6)':eval=frame,fps=${FPS}[bg]`,
    `[1:v]scale=-1:220:force_original_aspect_ratio=decrease,format=rgba[fg]`,
    `[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2,format=yuv420p[v]`,
  ].join(';')
  return [
    '-y',
    '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:d=${dur}:speed=0.03:c0=0x120a24:c1=0x1e1140:c2=0x0b1530:c3=0x241448:nb_colors=4`,
    '-loop', '1', '-i', logoFile,
    ...audioInput(audioFile, dur, 96, 0.05),
    '-filter_complex', fc,
    '-map', '[v]', '-map', '2:a', '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', out,
  ]
}

// Frosted-glass scene: rows of the channel + MeSatzTV logos scrolling opposite
// ways behind a blurred glass panel, with the channel logo sharp on the left and
// the MeSatzTV logo on the right in front. Composed per channel (needs its logo).
function frostedArgs(out: string, channelLogo: string, mzLogo: string, D: number, audioFile?: string): string[] {
  const rowH = 90
  const cellW = 260
  const nTile = 8 // strip wide enough to cover the screen + one cell while scrolling
  const speed = 55 // px/sec
  const nRows = 5
  const spacing = Math.floor(H / nRows)
  const y = (r: number) => r * spacing + Math.floor((spacing - rowH) / 2)
  const leftX = `x='-mod(t*${speed},${cellW})'`
  const rightX = `x='mod(t*${speed},${cellW})-${cellW}'`
  const cellChain = `scale=${cellW}:${rowH}:force_original_aspect_ratio=decrease,pad=${cellW}:${rowH}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,tile=${nTile}x1`
  const fc = [
    `[0:v]format=rgba[bg]`,
    `[1:v]split=2[chA][chFg]`,
    `[2:v]split=2[mzA][mzFg]`,
    `[chA]${cellChain},split=3[ch0][ch1][ch2]`,
    `[mzA]${cellChain},split=2[mz0][mz1]`,
    `[bg][ch0]overlay=${leftX}:y=${y(0)}[r0]`,
    `[r0][mz0]overlay=${rightX}:y=${y(1)}[r1]`,
    `[r1][ch1]overlay=${leftX}:y=${y(2)}[r2]`,
    `[r2][mz1]overlay=${rightX}:y=${y(3)}[r3]`,
    `[r3][ch2]overlay=${leftX}:y=${y(4)}[rows]`,
    // Frost: blur the scrolling layer and tint it like glass.
    `[rows]boxblur=14:2,drawbox=x=0:y=0:w=iw:h=ih:color=white@0.07:t=fill[frost]`,
    // Sharp foreground logos in front of the glass.
    `[chFg]scale=-1:180:force_original_aspect_ratio=decrease,format=rgba[chfg]`,
    `[mzFg]scale=-1:120:force_original_aspect_ratio=decrease,format=rgba[mzfg]`,
    `[frost][chfg]overlay=x=90:y=(H-h)/2[f1]`,
    `[f1][mzfg]overlay=x=W-w-90:y=(H-h)/2,format=yuv420p[v]`,
  ].join(';')
  return [
    '-y',
    '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:d=${D}:speed=0.04:c0=0x0b1020:c1=0x2a1150:c2=0x10233f:c3=0x0e2f3a:nb_colors=4`,
    '-loop', '1', '-i', channelLogo,
    '-loop', '1', '-i', mzLogo,
    ...audioInput(audioFile, D, 90, 0.04),
    '-filter_complex', fc,
    '-map', '[v]', '-map', '3:a', '-t', String(D),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', out,
  ]
}

export function generateFrostedFiller(out: string, channelLogo: string, mzLogo: string, dur = 30, audioFile?: string, onProgress?: ProgressCb): Promise<void> {
  const d = clampDur(dur)
  return runFfmpeg(frostedArgs(out, channelLogo, mzLogo, d, audioFile), onProgress, d)
}

function mesatztvLogoFile(): string {
  const wide = path.join(process.cwd(), 'public', 'logo-wide.png')
  return fs.existsSync(wide) ? wide : path.join(process.cwd(), 'public', 'mesatztv-icon.png')
}

// Bump these when the generators change so persisted clips regenerate.
const FILLER_VERSION = 4
const FROSTED_VERSION = 3

// ffprobe a media file's duration in seconds (0 on failure).
function probeDuration(file: string): Promise<number> {
  return new Promise((resolve) => {
    let out = ''
    const p = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])
    p.stdout?.on('data', (d) => (out += d))
    p.on('error', () => resolve(0))
    p.on('close', () => resolve(parseFloat(out.trim()) || 0))
  })
}

// Resolve an Asset id to its on-disk file (or undefined).
async function assetFilePath(id: number | null | undefined): Promise<string | undefined> {
  if (id == null) return undefined
  const a = await prisma.asset.findUnique({ where: { id } })
  if (!a) return undefined
  const f = path.join(assetsDir(), a.filename)
  return fs.existsSync(f) ? f : undefined
}

// Cache-busting fingerprint for a file (path + mtime).
function fileKey(f?: string): string {
  if (!f) return ''
  try {
    return `${f}:${Math.round(fs.statSync(f).mtimeMs)}`
  } catch {
    return f
  }
}

// Generate `out` via `gen(tmp)`, writing to a unique temp file and atomically
// renaming to `out` only on success — so `out` never exists half-written (a
// concurrent build would otherwise be picked up as a truncated clip).
async function generateToCache(out: string, gen: (tmp: string) => Promise<void>): Promise<string | undefined> {
  if (fs.existsSync(out)) return out
  const tmp = `${out}.${process.pid}.${Date.now()}.tmp.mp4`
  try {
    await gen(tmp)
    if (fs.existsSync(tmp)) fs.renameSync(tmp, out)
  } catch (e) {
    log('warn', 'system', 'Filler generation failed', String(e))
  } finally {
    fs.rmSync(tmp, { force: true }) // no-op once renamed
  }
  return fs.existsSync(out) ? out : undefined
}

// Animated filler for a given loop length + optional baked-in audio (persisted).
async function ensureAnimatedFiller(dur = 30, audioFile?: string, onProgress?: ProgressCb): Promise<string | undefined> {
  const d = clampDur(dur)
  const suffix = audioFile ? createHash('md5').update(`${d}:${fileKey(audioFile)}`).digest('hex') : `d${d}`
  const out = path.join(dataDir(), `filler-anim-v${FILLER_VERSION}-${suffix}.mp4`)
  if (fs.existsSync(out)) return out
  log('info', 'system', `Generating animated filler (${d}s${audioFile ? ' + audio' : ''})…`)
  return generateToCache(out, (tmp) => generateFiller(tmp, d, audioFile, onProgress))
}

// Frosted-glass filler, cached by logo + duration + baked audio.
async function ensureFrostedFiller(logoFile: string, dur = 30, audioFile?: string, onProgress?: ProgressCb): Promise<string | undefined> {
  const d = clampDur(dur)
  const key = createHash('md5').update(`${fileKey(logoFile)}:${d}:${fileKey(audioFile)}:v${FROSTED_VERSION}`).digest('hex')
  const out = path.join(dataDir(), `filler-frosted-${key}.mp4`)
  if (fs.existsSync(out)) return out
  log('info', 'system', `Generating frosted-glass filler for logo ${path.basename(logoFile)} (${d}s${audioFile ? ' + audio' : ''})…`)
  const clip = await generateToCache(out, (tmp) => generateFrostedFiller(tmp, logoFile, mesatztvLogoFile(), d, audioFile, onProgress))
  if (!clip) log('warn', 'system', 'Frosted filler generation failed — falling back to animated')
  return clip
}

const THEME_VERSION = 1
// Themed presets besides animated/frosted. "logowall"/"pulse" brand with the
// active logo; "retro"/"vintage" are logo-free (the live watermark still
// overlays during playback).
async function ensureThemedFiller(
  style: string,
  logoFile: string | undefined,
  dur = 30,
  audioFile?: string,
  onProgress?: ProgressCb,
): Promise<string | undefined> {
  const d = clampDur(dur)
  const key = createHash('md5')
    .update(`${style}:${logoFile ? fileKey(logoFile) : ''}:${d}:${fileKey(audioFile)}:v${THEME_VERSION}`)
    .digest('hex')
  const out = path.join(dataDir(), `filler-${style}-${key}.mp4`)
  if (fs.existsSync(out)) return out
  log('info', 'system', `Generating ${style} filler (${d}s${audioFile ? ' + audio' : ''})…`)
  const clip = await generateToCache(out, async (tmp) => {
    let args: string[] | null = null
    if (style === 'retro') args = fillerArgsRetro(tmp, d, audioFile)
    else if (style === 'vintage') args = fillerArgsVintage(tmp, d, audioFile)
    else if (style === 'logowall' && logoFile) args = fillerArgsLogowall(tmp, logoFile, d, audioFile)
    else if (style === 'pulse' && logoFile) args = fillerArgsPulse(tmp, logoFile, d, audioFile)
    if (!args) throw new Error(`theme "${style}" unavailable (missing logo?)`)
    await runFfmpeg(args, onProgress, d)
  })
  if (!clip) log('warn', 'system', `${style} filler generation failed — falling back to animated`)
  return clip
}

type FillerRow = { style: string; assetId: number | null; audioAssetId: number | null; durationMode: string; durationSec: number }

// Resolve a Filler to a playable clip (+ music overlaid at playback for custom
// clips). Generated styles bake the chosen audio in and match its length. Falls
// back to animated on any failure. `onProgress` reports generation progress.
async function resolveFillerClip(f: FillerRow, logoFile: string | undefined, onProgress?: ProgressCb): Promise<{ clip?: string; music?: string }> {
  const audioFile = await assetFilePath(f.audioAssetId)
  let dur = clampDur(f.durationSec)
  if (f.durationMode === 'audio' && audioFile) {
    const probed = await probeDuration(audioFile)
    if (probed > 1) dur = clampDur(probed)
  }
  if (f.style === 'custom') {
    const clip = await assetFilePath(f.assetId)
    // A real custom clip plays as-is with the chosen audio overlaid; if missing,
    // fall back to a generated clip with the audio baked in.
    if (clip) return { clip, music: audioFile }
    return { clip: await ensureAnimatedFiller(dur, audioFile, onProgress) }
  }
  if (f.style === 'frosted' && logoFile) {
    const clip = await ensureFrostedFiller(logoFile, dur, audioFile, onProgress)
    return { clip: clip ?? (await ensureAnimatedFiller(dur, audioFile, onProgress)) }
  }
  if (['logowall', 'pulse', 'retro', 'vintage'].includes(f.style)) {
    const clip = await ensureThemedFiller(f.style, logoFile, dur, audioFile, onProgress)
    return { clip: clip ?? (await ensureAnimatedFiller(dur, audioFile, onProgress)) }
  }
  return { clip: await ensureAnimatedFiller(dur, audioFile, onProgress) }
}

// Resolve the on-disk logo file for a logo id (or legacy url), for filler branding.
async function logoFileById(logoId: number | null, logoUrl: string | null): Promise<string | undefined> {
  if (logoId != null) {
    const l = await prisma.logo.findUnique({ where: { id: logoId } })
    if (l) return localLogo(path.join(logosDir(), l.filename))
  }
  return localLogo(logoUrl || null)
}

// Build (if needed) and return a Filler's branded clip — used by the generate
// endpoint. `onProgress` reports 0..99% during generation.
export async function resolveFillerClipById(id: number, onProgress?: ProgressCb): Promise<{ clip?: string; music?: string } | null> {
  const f = await prisma.filler.findUnique({
    where: { id },
    include: { channel: true, timeBlock: { include: { channel: true, collection: true } } },
  })
  if (!f) return null
  let logoId: number | null = null
  let logoUrl: string | null = null
  if (f.timeBlock) {
    logoId = f.timeBlock.logoId ?? f.timeBlock.collection.logoId ?? f.timeBlock.channel.logoId
    logoUrl = f.timeBlock.logoUrl ?? f.timeBlock.channel.logoUrl
  } else if (f.channel) {
    logoId = f.channel.logoId
    logoUrl = f.channel.logoUrl
  }
  return resolveFillerClip(f, await logoFileById(logoId, logoUrl), onProgress)
}

/**
 * Pre-build filler at boot so an intermission never blocks on generation: the
 * animated fallback plus every channel/block filler.
 */
export async function warmFiller(): Promise<void> {
  const animated = await ensureAnimatedFiller(30).catch(() => undefined)
  if (animated) log('info', 'system', `Animated filler ready: ${animated}`)
  else log('warn', 'system', 'No filler clip available — gaps will play black')

  const channels = await prisma.channel.findMany({
    include: { fillers: true, timeBlocks: { include: { fillers: true, collection: true } } },
  })
  for (const ch of channels) {
    const chLogo = await logoFileById(ch.logoId, ch.logoUrl)
    for (const f of ch.fillers) await resolveFillerClip(f, chLogo).catch(() => {})
    for (const b of ch.timeBlocks) {
      if (b.fillers.length === 0) continue
      const bLogo = await logoFileById(b.logoId ?? b.collection.logoId ?? ch.logoId, b.logoUrl ?? ch.logoUrl)
      for (const f of b.fillers) await resolveFillerClip(f, bLogo).catch(() => {})
    }
  }
}

type SegmentResult = { code: number | null; stderr: string; spawnError?: Error; bytes: number; firstByteMs: number }

/**
 * Pipe a child's stdout to the response with backpressure; resolve on exit.
 * Captures a tail of stderr, the exit code, bytes written, and how long until
 * the first byte arrived (a big first-byte delay is a stall the viewer sees).
 */
function pipeSegment(proc: ChildProcess, res: Response): Promise<SegmentResult> {
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
    const onData = (chunk: Buffer) => {
      if (firstByteMs < 0) firstByteMs = Date.now() - t0
      bytes += chunk.length
      if (!res.write(chunk)) proc.stdout?.pause()
    }
    const onDrain = () => proc.stdout?.resume()
    proc.stdout?.on('data', onData)
    res.on('drain', onDrain)
    let settled = false
    const done = (code: number | null) => {
      if (settled) return
      settled = true
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
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  const ua = (req.headers['user-agent'] as string) || 'unknown'
  return `${ip} — ${ua}`
}

// Count of live viewers per channel number, for logging concurrency.
const viewers = new Map<number, number>()

/** Live viewer count for a channel number (0 for drafts/unknown). */
export function viewerCount(channelNumber: number | null): number {
  return channelNumber != null ? viewers.get(channelNumber) ?? 0 : 0
}

/** Stream a channel's playout as a continuous MPEG-TS to `res`. */

/**
 * Valid black+silence in the channel's format. The concat demuxer treats an
 * empty or unreadable entry as a broken input and gives up on the whole
 * session, so every /internal/stream request must answer with real TS — even
 * when there is nothing to play.
 */
function blackArgs(p: StreamProfile, enc: string, durSec: number): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 'lavfi', '-i', `color=c=black:s=${p.width}x${p.height}:r=${p.fps}`,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-t', Math.max(0.5, durSec).toFixed(3),
    ...encoderArgs(enc, p),
    '-c:a', 'aac', '-ar', '48000', '-ac', String(p.audioChannels), '-b:a', `${p.audioBitrate}k`,
    '-mpegts_flags', '+resend_headers', '-f', 'mpegts', '-muxpreload', '0', '-muxdelay', '0', 'pipe:1',
  ]
}

/** Stream black for `durSec` so the concat session survives a gap. */
async function streamBlack(res: Response, p: StreamProfile, enc: string, durSec: number, why: string, channelNumber: number): Promise<void> {
  log('warn', 'stream', `Channel ${channelNumber}: filling ${durSec.toFixed(1)}s with black — ${why}`)
  if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache, no-store' })
  const proc = spawn('ffmpeg', blackArgs(p, enc, durSec))
  res.on('close', () => proc.kill('SIGKILL'))
  await pipeSegment(proc, res)
  if (!res.writableEnded) res.end()
}

/** Base URL for the internal per-item endpoints the concat demuxer fetches. */
function internalBase(): string {
  return `http://127.0.0.1:${Number(process.env.PORT ?? 8688)}`
}

/**
 * The playlist the outer ffmpeg's concat demuxer reads. Two identical entries is
 * all it needs: `-stream_loop -1` cycles the list forever, and each pass re-opens
 * the URL, which hands back whatever should be on air at that moment. (Same trick
 * ErsatzTV uses.)
 */
export function concatPlaylist(channelNumber: number): string {
  const url = `${internalBase()}/internal/stream/${channelNumber}`
  return `ffconcat version 1.0\nfile ${url}\nfile ${url}\n`
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

  const nViewers = (viewers.get(channelNumber) ?? 0) + 1
  viewers.set(channelNumber, nViewers)
  log(
    'info',
    'stream',
    `▶ Channel ${channelNumber} (${channel.name}) connected — ${nViewers} viewer(s) now watching this channel`,
    clientInfo(req),
  )

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
    '-stream_loop', '-1',
    '-i', `${internalBase()}/internal/concat/${channelNumber}`,
    '-c', 'copy',
    '-f', 'mpegts', '-muxpreload', '0', '-muxdelay', '0', 'pipe:1',
  ]
  log('debug', 'ffmpeg', `Ch ${channelNumber} concat command`, 'ffmpeg ' + args.join(' '))

  res.writeHead(200, {
    'Content-Type': 'video/mp2t',
    'Cache-Control': 'no-cache, no-store',
    Connection: 'close',
  })

  let reason = 'client disconnected'
  const proc = spawn('ffmpeg', args)
  res.on('close', () => proc.kill('SIGKILL'))
  const result = await pipeSegment(proc, res)
  if (result.spawnError) {
    reason = 'failed to launch ffmpeg'
    log('error', 'ffmpeg', `Channel ${channelNumber}: could not launch the concat process`, String(result.spawnError))
  } else if (result.code && result.code !== 0 && !res.writableEnded) {
    reason = `ffmpeg exited ${result.code}`
    log('error', 'ffmpeg', `Channel ${channelNumber}: concat process exited ${result.code}`, result.stderr || '(no stderr)')
  }

  const left = (viewers.get(channelNumber) ?? 1) - 1
  viewers.set(channelNumber, Math.max(0, left))
  log('info', 'stream', `⏹ Channel ${channelNumber} (${channel.name}) stream ended — ${reason}; ${Math.max(0, left)} viewer(s) still watching`)
  if (!res.writableEnded) res.end()
}

/** Build the playout if it's empty or nearly exhausted. False = nothing scheduled. */
async function ensurePlayout(
  channel: { id: number; playoutCursor: Date | null; rotationItems: unknown[] },
  channelNumber: number,
): Promise<boolean> {
  const now = Date.now()
  if (channel.playoutCursor && channel.playoutCursor.getTime() >= now + 30 * 60 * 1000) return true

  const blocks = await prisma.timeBlock.count({ where: { channelId: channel.id } })
  if (channel.rotationItems.length === 0 && blocks === 0) {
    log('warn', 'stream', `Channel ${channelNumber} has nothing scheduled — no rotation or time blocks`)
    return false
  }
  await prunePlayout(channel.id).catch((e) =>
    log('warn', 'playout', `Prune failed for channel ${channelNumber}`, String(e)),
  )
  const built = await buildPlayout(channel.id, new Date(now + 4 * 3600 * 1000)).catch((e) => {
    log('error', 'playout', `Playout build failed for channel ${channelNumber}`, String(e?.stack || e))
    return -1
  })
  if (built >= 0) log('debug', 'playout', `Channel ${channelNumber}: built ${built} playout item(s) on connect`)
  return true
}

/**
 * One program (or filler) — whatever is on air right now — encoded to the
 * channel's format and streamed until it ends. The concat demuxer opens this
 * once per item; because the item is chosen by wall clock, every viewer sees the
 * same thing and no per-client session state is needed.
 */
export async function streamChannelItem(channelNumber: number, res: Response, req?: Request): Promise<void> {
  const channel = await prisma.channel.findFirst({
    where: { number: channelNumber },
    include: {
      timeBlocks: { include: { collection: true, fillers: { orderBy: { order: 'asc' } } } },
      fillers: { orderBy: { order: 'asc' } },
      rotationItems: true,
      profile: true,
    },
  })
  if (!channel) {
    res.status(404).end()
    return
  }
  if (!(await ensurePlayout(channel, channelNumber))) {
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
  const prev = await prisma.playoutItem.findFirst({
    where: { channelId: channel.id, stopTime: { lte: now } },
    orderBy: { stopTime: 'desc' },
    select: { kind: true },
  })
  const item = items[0]
  if (!item) {
    await streamBlack(res, profile, enc, 2, 'nothing on air (playout exhausted)', channelNumber)
    return
  }

  {
    {
      {
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
        const fadeOutSec = edgeFade > 0 && items[1]?.kind === 'filler' ? edgeFade : 0
        // Don't fade in when tuning in mid-program — there was no filler on screen.
        const fadeInSec = edgeFade > 0 && prev?.kind === 'filler' && !midItem ? edgeFade : 0
        const mi = item.mediaItem
        // Absolute wall-clock start of the frames we're about to emit — anchors
        // the intermittent watermark so it fires on schedule for every viewer.
        const wmEpochSec = item.startTime.getTime() / 1000 + offset
        // Cap every segment to its scheduled slot so output timestamps stay
        // exactly continuous (a program overrunning its probed duration is what
        // could otherwise push the next segment's PTS backwards → a freeze).
        const segDur = (item.stopTime.getTime() - now.getTime()) / 1000
        let seg: Segment | null = null
        let label: string

        if (item.kind === 'filler' || !mi) {
          const genStart = Date.now()
          // Filler pool: the active block's own fillers → the channel's →
          // the built-in animated fallback.
          const poolBlock = activeBlockAt(channel.timeBlocks, item.startTime)
          const blockPool = poolBlock?.fillers ?? []
          const pool = blockPool.length > 0 ? blockPool : channel.fillers
          const src = blockPool.length > 0 ? ' [block]' : channel.fillers.length > 0 ? ' [channel]' : ''
          let clip: string | undefined
          let music: string | undefined
          if (pool.length > 0) {
            const f = pool[Math.floor(item.startTime.getTime() / 1000) % pool.length]
            const r = await resolveFillerClip(f, logo)
            clip = r.clip
            music = r.music
          } else {
            clip = await ensureAnimatedFiller()
          }
          const genMs = Date.now() - genStart
          if (genMs > 500) log('warn', 'system', `Channel ${channelNumber}: filler resolve blocked ${genMs}ms (should be pre-warmed)`)
          if (clip && segDur > 0.3) seg = { filePath: clip, offsetSec: 0, loop: true, durationSec: segDur, hasAudio: true, logo, wmEpochSec, mediaWidth: W, mediaHeight: H, musicPath: music, isFiller: true, fadeInSec: 0, fadeOutSec: 0 }
          label = `filler (${Math.round(segDur)}s)${music ? ' +music' : ''}${src}`
          if (!clip) log('error', 'stream', `Channel ${channelNumber}: no filler clip — a ${Math.round(segDur)}s gap will play black`)
        } else if (fs.existsSync(mi.path) && offset >= (mi.durationSec ?? Infinity) - 0.2) {
          // The file is shorter than the slot it was given. Seeking past its end
          // would produce nothing, and concat would refetch this same item on a
          // tight loop until the slot expired.
          await streamBlack(res, profile, enc, Math.min(segDur, 10), `${mi.title} ran out ${offset.toFixed(1)}s in (file shorter than its slot)`, channelNumber)
          return
        } else if (fs.existsSync(mi.path)) {
          // Only anamorphic sources need correcting, and only a constrained
          // watermark cares — skip the probe otherwise.
          const sar = wm.constrainToMedia && wm.mode !== 'none' && logo ? await probeSar(mi.path) : 1
          const dispW = Math.round((mi.width ?? W) * sar)
          seg = { filePath: mi.path, offsetSec: offset, loop: false, durationSec: segDur, hasAudio: !!mi.audioCodec, logo, wmEpochSec, mediaWidth: dispW, mediaHeight: mi.height ?? H, isFiller: false, fadeInSec, fadeOutSec }
          label = mi.showTitle
            ? `${mi.showTitle}${mi.season != null && mi.episode != null ? ` S${String(mi.season).padStart(2, '0')}E${String(mi.episode).padStart(2, '0')}` : ''}${mi.title ? ` — ${mi.title}` : ''}`
            : mi.title
        } else {
          log('warn', 'stream', `Channel ${channelNumber}: media file missing, skipping`, mi.path)
          label = mi.title
        }

        if (!seg) {
          await streamBlack(res, profile, enc, Math.min(segDur, 10), `no playable segment for ${label}`, channelNumber)
          return
        }
        const args = ffmpegArgs(seg, enc, wm, profile)
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
        log(
          'info',
          'stream',
          `Ch ${channelNumber} ▶ ${label}${offset > 1 ? ` (resuming at ${Math.round(offset)}s)` : ''}`,
          `source ${seg.mediaWidth}x${seg.mediaHeight}, logo ${active.id != null ? '#' + active.id : active.raw ? 'url' : 'none'}, ${wmDesc}`,
        )
        log('debug', 'ffmpeg', `Ch ${channelNumber} ffmpeg command`, 'ffmpeg ' + args.join(' '))
        res.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-cache, no-store' })
        const segStart = Date.now()
        current = spawn('ffmpeg', args)
        const result = await pipeSegment(current, res)
        current = null
        // Log the outcome of every segment (bytes, wall time, first-byte delay)
        // — a slow first byte or zero bytes is the stall a viewer sees as a
        // freeze/black screen.
        {
          const wallMs = Date.now() - segStart
          const wallS = (wallMs / 1000).toFixed(1)
          const mb = (result.bytes / 1e6).toFixed(1)
          const detail = `${mb} MB in ${wallS}s (expected ~${Math.round(segDur)}s), first byte ${result.firstByteMs < 0 ? 'never' : result.firstByteMs + 'ms'}, exit ${result.code ?? 'n/a'}`
          if (result.spawnError) {
            log('error', 'ffmpeg', `Channel ${channelNumber}: failed to launch ffmpeg for ${path.basename(seg.filePath)}`, String(result.spawnError))
          } else if (result.code && result.code !== 0) {
            log('error', 'ffmpeg', `Channel ${channelNumber}: ffmpeg exited ${result.code} on ${path.basename(seg.filePath)}`, `${detail}\n${result.stderr || '(no stderr)'}`)
          } else if (result.bytes === 0) {
            log('error', 'ffmpeg', `Channel ${channelNumber}: ffmpeg produced NO output for ${path.basename(seg.filePath)} — viewers see a freeze/black`, `${detail}\n${result.stderr || '(no stderr)'}`)
          } else if (result.firstByteMs > 2500) {
            log('warn', 'ffmpeg', `Channel ${channelNumber}: slow start (${result.firstByteMs}ms to first byte) on ${path.basename(seg.filePath)} — possible stall`, detail)
          } else if (segDur > 5 && wallMs > (segDur + 3) * 1000 * 1.15) {
            // Took much longer than real time → the encoder can't sustain the
            // stream, so viewers' buffers underrun and it freezes/stutters.
            log('warn', 'ffmpeg', `Channel ${channelNumber}: encoder slower than real-time (${wallS}s for a ${Math.round(segDur)}s segment, ${enc}) — likely cause of freezing`, detail)
          } else {
            log('debug', 'ffmpeg', `Channel ${channelNumber}: segment done — ${label}`, `${detail}${result.stderr ? '\n' + result.stderr : ''}`)
          }
        }
      }
    }
  }
  // Viewer accounting lives on the outer /iptv stream; this endpoint is just one
  // item of it. Ending here lets concat move straight on to the next item.
  if (!res.writableEnded) res.end()
}
