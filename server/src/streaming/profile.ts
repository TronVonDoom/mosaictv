// Per-channel output settings: the resolved shape the stream pipeline builds
// ffmpeg commands from, plus the tables describing what the encoders accept.
// Pure configuration — nothing here spawns a process (see capabilities.ts for
// what this host can actually do).

export type ScalingMode = 'pad' | 'stretch' | 'crop'
export const SCALING_MODES: ScalingMode[] = ['pad', 'stretch', 'crop']

// Encoder speed presets, per encoder. "auto" keeps our own sensible default.
export const PRESETS: Record<string, string[]> = {
  libx264: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower'],
  h264_nvenc: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
  h264_qsv: ['veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'],
  h264_amf: ['speed', 'balanced', 'quality'],
  // h264_vaapi / h264_videotoolbox have no comparable preset knob.
}
const ALL_PRESETS = new Set(Object.values(PRESETS).flat())

// Hardware-accel choice -> the ffmpeg H.264 encoder it uses. "cpu" = libx264,
// "auto" = probe and pick the best available (see resolveEncoder).
export const HW_ACCELS = ['auto', 'nvidia', 'qsv', 'vaapi', 'amf', 'videotoolbox', 'cpu'] as const
export type HwAccel = (typeof HW_ACCELS)[number]
export const HW_ENCODERS: Record<string, string> = {
  nvidia: 'h264_nvenc',
  qsv: 'h264_qsv',
  vaapi: 'h264_vaapi',
  amf: 'h264_amf',
  videotoolbox: 'h264_videotoolbox',
}
// VAAPI needs a render node; overridable for unusual setups.
export const VAAPI_DEVICE = process.env.VAAPI_DEVICE || '/dev/dri/renderD128'

export type StreamProfile = {
  width: number
  height: number
  fps: number
  quality: 'low' | 'medium' | 'high'
  hwaccel: HwAccel
  audioBitrate: number // kbps
  preset: string // "auto" or an encoder-specific preset
  videoBitrateK: number // 0 = derive from quality
  videoBufferK: number // 0 = derive from bitrate
  scalingMode: ScalingMode
  deinterlace: boolean
  threads: number // 0 = ffmpeg default
  audioChannels: number
  normalizeLoudness: boolean
  burnSubtitles: boolean
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
  burnSubtitles: false,
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
  burnSubtitles?: boolean | null
} | null

/** Clamp a DB profile row (or null) into a valid StreamProfile. */
export function resolveProfile(p: ProfileRow): StreamProfile {
  if (!p) return DEFAULT_PROFILE
  const quality = ['low', 'medium', 'high'].includes(p.quality) ? (p.quality as StreamProfile['quality']) : 'medium'
  const hwaccel = (HW_ACCELS as readonly string[]).includes(p.hwaccel) ? (p.hwaccel as HwAccel) : 'auto'
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
    burnSubtitles: !!p.burnSubtitles,
  }
}
