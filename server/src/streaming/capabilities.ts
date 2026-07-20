// What THIS host's ffmpeg can actually do — encoders, GPU decode, drawtext,
// and the newer readrate options — plus the encoder argument construction that
// depends on the answer. Everything here is probed at most once and cached, so
// the streaming path never pays for detection twice.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from '../paths.js'
import { log } from '../logs.js'
import { runFfmpeg } from './run.js'
import { HW_ENCODERS, PRESETS, VAAPI_DEVICE, type HwAccel, type StreamProfile } from './profile.js'

// Whether an encoder actually works on THIS host — not just whether ffmpeg
// lists it. A tiny real encode with the same shape of args the stream uses
// catches "h264_qsv is listed but there's no Intel GPU" or "vaapi render node
// missing", so we can fall back to libx264 gracefully. Probed once per encoder.
const encoderProbeCache = new Map<string, Promise<boolean>>()

function probeArgs(enc: string): string[] {
  const src = ['-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=15:d=0.2']
  const out = ['-f', 'null', '-']
  switch (enc) {
    case 'h264_vaapi':
      return ['-vaapi_device', VAAPI_DEVICE, ...src, '-vf', 'format=nv12,hwupload', '-c:v', 'h264_vaapi', '-b:v', '1M', ...out]
    case 'h264_nvenc':
    case 'h264_qsv':
    case 'h264_amf':
    case 'h264_videotoolbox':
      return [...src, '-c:v', enc, '-b:v', '1M', ...out]
    default:
      return [...src, '-c:v', enc, ...out]
  }
}

function probeEncoder(enc: string): Promise<boolean> {
  if (enc === 'libx264') return Promise.resolve(true)
  const hit = encoderProbeCache.get(enc)
  if (hit) return hit
  const probe = new Promise<boolean>((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...probeArgs(enc)])
    p.on('error', () => resolve(false))
    p.on('close', (code) => resolve(code === 0))
  })
  encoderProbeCache.set(enc, probe)
  return probe
}

// "auto" priority: fastest widely-available hardware first, CPU last.
const AUTO_ORDER = ['h264_nvenc', 'h264_qsv', 'h264_vaapi', 'h264_amf', 'h264_videotoolbox']
const encoderLogged = new Set<string>()
function logEncoder(enc: string): string {
  if (!encoderLogged.has(enc)) {
    encoderLogged.add(enc)
    log('info', 'ffmpeg', `Video encoder selected: ${enc}`)
  }
  return enc
}

/** Pick the actual working encoder for the profile's hardware-accel choice. */
export async function resolveEncoder(hwaccel: HwAccel): Promise<string> {
  if (hwaccel === 'cpu') return 'libx264'
  if (hwaccel !== 'auto') {
    const want = HW_ENCODERS[hwaccel]
    if (want && (await probeEncoder(want))) return logEncoder(want)
    log('warn', 'ffmpeg', `Profile requests ${hwaccel} but ${want ?? '?'} does not work on this host — using CPU (libx264)`)
    return logEncoder('libx264')
  }
  for (const e of AUTO_ORDER) if (await probeEncoder(e)) return logEncoder(e)
  return logEncoder('libx264')
}

// The outer concat process gets a connect-time buffer cushion from
// -readrate_initial_burst (ffmpeg 6.1+) and -readrate_catchup (7.0+). These
// don't exist on older ffmpeg (Debian bookworm ships 5.1), where passing an
// unknown option makes ffmpeg exit immediately — which would kill every
// stream. Probe once at first use; if unsupported, omit them and fall back to
// plain -readrate (supported since 5.1), i.e. the previous behaviour.
let readrateBurstCache: boolean | undefined
export function detectReadrateBurst(): Promise<boolean> {
  if (readrateBurstCache !== undefined) return Promise.resolve(readrateBurstCache)
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', [
      '-hide_banner',
      '-readrate_initial_burst', '1',
      '-readrate_catchup', '1.5',
      '-f', 'lavfi', '-i', 'color=c=black:s=32x32:d=0.1',
      '-f', 'null', '-',
    ])
    p.stderr?.on('data', () => {})
    p.on('error', () => resolve((readrateBurstCache = false)))
    p.on('close', (code) => {
      const ok = code === 0
      if (ok) log('info', 'ffmpeg', 'readrate burst/catchup supported — streams get a connect-time cushion')
      else log('warn', 'ffmpeg', 'ffmpeg lacks -readrate_initial_burst/-readrate_catchup (needs 6.1/7.0+) — streaming with plain readrate')
      resolve((readrateBurstCache = ok))
    })
  })
}

// ---- GPU decode (NVDEC) -----------------------------------------------------
// Encode already runs on nvenc, but decode stays on the CPU unless the command
// asks for -hwaccel cuda. Whether the GPU can decode a codec depends on the
// chip (a GTX 970 does H.264 but not HEVC), so probe each codec ONCE by
// actually decoding a tiny generated sample with the hwaccel forced all the
// way through (-hwaccel_output_format cuda + hwdownload makes a silent
// software fallback fail the probe instead of masking it). The real stream
// command then uses plain -hwaccel cuda, which soft-falls-back to CPU decode
// on any oddball file rather than dying.
const SAMPLE_ENCODERS: Record<string, string> = { h264: 'libx264', hevc: 'libx265' }
const nvdecCache = new Map<string, Promise<boolean>>()
export function canNvdecCodec(codec: string): Promise<boolean> {
  const hit = nvdecCache.get(codec)
  if (hit) return hit
  const probe = (async () => {
    const encoder = SAMPLE_ENCODERS[codec]
    if (!encoder) return false // rare codec — leave it on the CPU
    const sample = path.join(dataDir(), `probe-nvdec-${codec}.mp4`)
    try {
      await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=10:d=0.3', '-c:v', encoder, '-pix_fmt', 'yuv420p', sample])
      await new Promise<void>((resolve, reject) => {
        const d = spawn('ffmpeg', [
          '-hide_banner', '-v', 'error',
          '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda',
          '-i', sample,
          '-vf', 'hwdownload,format=nv12',
          '-f', 'null', '-',
        ])
        let err = ''
        d.stderr?.on('data', (x) => (err += x))
        d.on('error', reject)
        d.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err.slice(-300) || `exit ${c}`))))
      })
      log('info', 'ffmpeg', `GPU decode (NVDEC) available for ${codec}`)
      return true
    } catch (e) {
      log('info', 'ffmpeg', `GPU decode unavailable for ${codec} — decoding on CPU`, String(e).slice(0, 300))
      return false
    } finally {
      fs.rmSync(sample, { force: true })
    }
  })()
  nvdecCache.set(codec, probe)
  return probe
}

// ---- Text overlay support ---------------------------------------------------
// Burned-in text (coming-up-next, song chyron) needs drawtext, which is only
// present when ffmpeg was built with libfreetype, plus a font file on disk.
// Both are detected ONCE; if either is missing, text overlays are silently
// skipped — a missing caption must never fail an encode and black out the
// stream. fonts-dejavu-core (installed in the image) provides these paths.
const FONT_REGULAR = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
const FONT_BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
export type TextSupport = { font: string; fontBold: string }
let textCache: TextSupport | null | undefined
export function detectTextOverlay(): Promise<TextSupport | null> {
  if (textCache !== undefined) return Promise.resolve(textCache)
  return new Promise((resolve) => {
    const font = fs.existsSync(FONT_REGULAR) ? FONT_REGULAR : undefined
    const fontBold = fs.existsSync(FONT_BOLD) ? FONT_BOLD : font
    if (!font) {
      log('warn', 'ffmpeg', 'No DejaVu font on disk — on-screen text overlays disabled')
      return resolve((textCache = null))
    }
    let out = ''
    const p = spawn('ffmpeg', ['-hide_banner', '-filters'])
    p.stdout.on('data', (d) => (out += d))
    p.on('error', () => {
      log('warn', 'ffmpeg', 'Could not probe ffmpeg filters — text overlays disabled')
      resolve((textCache = null))
    })
    p.on('close', () => {
      if (/\bdrawtext\b/.test(out)) {
        log('info', 'ffmpeg', 'Text overlay (drawtext) available')
        resolve((textCache = { font, fontBold: fontBold as string }))
      } else {
        log('warn', 'ffmpeg', 'ffmpeg lacks the drawtext filter (no libfreetype) — text overlays disabled')
        resolve((textCache = null))
      }
    })
  })
}

// ---- Encoder arguments ------------------------------------------------------

// Video quality → bitrate ladder (nvenc VBR) / CRF (libx264), scaled a bit by
// resolution so 1080p isn't starved at the same numbers as 720p.
const QUALITY = {
  low: { bitrate: 2.5, crf: '26' },
  medium: { bitrate: 5, crf: '23' },
  high: { bitrate: 8, crf: '20' },
} as const

export function encoderArgs(enc: string, p: StreamProfile): string[] {
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
  if (enc === 'h264_qsv') {
    // Intel QuickSync. Accepts system-memory frames (internal upload); nv12 in.
    return ['-c:v', 'h264_qsv', '-preset', preset('faster'), '-b:v', bv, '-maxrate', maxrate, '-bufsize', bufsize, '-g', g, ...noBFrames, '-pix_fmt', 'nv12']
  }
  if (enc === 'h264_vaapi') {
    // Intel/AMD on Linux. Frames arrive on a VAAPI surface (hwupload is appended
    // in ffmpegArgs), so no -pix_fmt here.
    return ['-c:v', 'h264_vaapi', '-b:v', bv, '-maxrate', maxrate, '-bufsize', bufsize, '-g', g, ...noBFrames]
  }
  if (enc === 'h264_amf') {
    // AMD (Windows/Linux). -quality is AMF's speed/quality knob.
    return ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', preset('balanced'), '-rc', 'vbr_latency', '-b:v', bv, '-maxrate', maxrate, '-bufsize', bufsize, '-g', g, ...noBFrames, '-pix_fmt', 'yuv420p']
  }
  if (enc === 'h264_videotoolbox') {
    // Apple (macOS). No -bf knob; relies on its default GOP structure.
    return ['-c:v', 'h264_videotoolbox', '-b:v', bv, '-maxrate', maxrate, '-bufsize', bufsize, '-g', g, '-pix_fmt', 'yuv420p']
  }
  // libx264 uses CRF unless an explicit bitrate asks for rate control.
  const rate = p.videoBitrateK > 0 ? ['-b:v', bv, '-maxrate', maxrate] : ['-crf', q.crf, '-maxrate', maxrate]
  return ['-c:v', 'libx264', '-preset', preset('veryfast'), ...rate, '-bufsize', bufsize, '-g', g, ...noBFrames, '-pix_fmt', 'yuv420p']
}
