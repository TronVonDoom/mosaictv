import { spawn } from 'node:child_process'

/** Run ffprobe and resolve with its trimmed stdout ('' on any failure). */
function ffprobeText(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    const p = spawn('ffprobe', args)
    p.stdout?.on('data', (d) => (out += d))
    p.on('error', () => resolve(''))
    p.on('close', () => resolve(out.trim()))
  })
}

export type ProbeResult = {
  durationSec: number | null
  width: number | null
  height: number | null
  videoCodec: string | null
  audioCodec: string | null
  container: string | null
}

type FfprobeStream = {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
}

type FfprobeJson = {
  streams?: FfprobeStream[]
  format?: {
    duration?: string
    format_name?: string
  }
}

/**
 * Run ffprobe on a file and return normalized media info, or null if the file
 * can't be probed (corrupt, unsupported, or ffprobe missing).
 */
export function ffprobe(filePath: string): Promise<ProbeResult | null> {
  return new Promise((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]
    const proc = spawn('ffprobe', args)
    let stdout = ''

    proc.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    proc.on('error', () => resolve(null))
    proc.on('close', (code) => {
      if (code !== 0 || !stdout) return resolve(null)
      try {
        const json = JSON.parse(stdout) as FfprobeJson
        const video = json.streams?.find((s) => s.codec_type === 'video')
        const audio = json.streams?.find((s) => s.codec_type === 'audio')
        const duration = json.format?.duration
          ? Number.parseFloat(json.format.duration)
          : null
        resolve({
          durationSec: duration != null && !Number.isNaN(duration) ? duration : null,
          width: video?.width ?? null,
          height: video?.height ?? null,
          videoCodec: video?.codec_name ?? null,
          audioCodec: audio?.codec_name ?? null,
          container: json.format?.format_name ?? null,
        })
      } catch {
        resolve(null)
      }
    })
  })
}

// ---- Single-question probes used by the streaming pipeline ------------------
// Each is cached per file: the stream re-opens the same items over and over
// (once per program airing), and these answers never change for a given file.

// Sample aspect ratio. The scanner records coded dimensions, but anamorphic
// sources (720x480 DVD rips at SAR 8:9) *display* at a different shape — and
// the stream de-anamorphizes with scale=iw*sar:ih, so the picture on the canvas
// is the SAR-corrected one. Using coded dims to place the watermark puts it on
// the pillarbars.
const sarCache = new Map<string, Promise<number>>()
export function probeSar(filePath: string): Promise<number> {
  const hit = sarCache.get(filePath)
  if (hit) return hit
  const probe = ffprobeText([
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=sample_aspect_ratio',
    '-of', 'default=nw=1:nk=1',
    filePath,
  ]).then((out) => {
    // "8:9" -> 0.888…; "N/A", "0:1" and anything odd mean square pixels.
    const m = out.match(/^(\d+):(\d+)$/)
    const n = m ? Number(m[1]) : 0
    const d = m ? Number(m[2]) : 0
    return n > 0 && d > 0 ? n / d : 1
  })
  sarCache.set(filePath, probe)
  return probe
}

/** Whether a source has at least one subtitle stream (for subtitle burn-in). */
const subsCache = new Map<string, Promise<boolean>>()
export function hasSubtitleStream(filePath: string): Promise<boolean> {
  const hit = subsCache.get(filePath)
  if (hit) return hit
  const probe = ffprobeText([
    '-v', 'error',
    '-select_streams', 's',
    '-show_entries', 'stream=index',
    '-of', 'default=nw=1:nk=1',
    filePath,
  ]).then((out) => out.length > 0)
  subsCache.set(filePath, probe)
  return probe
}

/** A media file's duration in seconds (0 on failure). */
export function probeDuration(filePath: string): Promise<number> {
  return ffprobeText([
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1',
    filePath,
  ]).then((out) => parseFloat(out) || 0)
}

// ---- Audio track selection --------------------------------------------------

// ISO 639 is two standards deep: files tag audio "eng" or "en", "jpn" or "ja",
// and the two forms share no prefix, so matching needs the pairs spelled out.
// Only the languages offered in the UI need an entry; anything else falls
// through to an exact match on whatever the file says.
const LANG_ALIASES: Record<string, string> = {
  en: 'eng', eng: 'eng', english: 'eng',
  ja: 'jpn', jpn: 'jpn', japanese: 'jpn',
  es: 'spa', spa: 'spa', spanish: 'spa',
  fr: 'fre', fre: 'fre', fra: 'fre', french: 'fre',
  de: 'ger', ger: 'ger', deu: 'ger', german: 'ger',
  it: 'ita', ita: 'ita', italian: 'ita',
  pt: 'por', por: 'por', portuguese: 'por',
  ko: 'kor', kor: 'kor', korean: 'kor',
  zh: 'chi', chi: 'chi', zho: 'chi', chinese: 'chi',
  ru: 'rus', rus: 'rus', russian: 'rus',
}

/** Normalize a language tag: "en-US" -> "eng", "Japanese" -> "jpn". */
export function normalizeLang(tag: string | null | undefined): string {
  const base = String(tag ?? '').trim().toLowerCase().split(/[-_]/)[0]
  if (!base) return ''
  return LANG_ALIASES[base] ?? base
}

/**
 * Which audio track to air, as an index into the file's audio streams.
 *
 * Falls back to the first track whenever the preference can't be honoured — no
 * preference, no tags on the file, or no track in that language. Silence would
 * be the alternative, and a wrong-language track beats no sound at all.
 */
export function pickAudioTrack(langs: string[], preferred: string | null | undefined): number {
  const want = normalizeLang(preferred)
  if (!want || langs.length === 0) return 0
  const idx = langs.findIndex((l) => normalizeLang(l) === want)
  return idx >= 0 ? idx : 0
}

/**
 * The language tag of each audio stream, in the file's own order — '' where a
 * stream carries no tag, so the array index is always the ffmpeg `a:N` index.
 */
const audioLangCache = new Map<string, Promise<string[]>>()
export function probeAudioLangs(filePath: string): Promise<string[]> {
  const hit = audioLangCache.get(filePath)
  if (hit) return hit
  const probe = ffprobeText([
    '-v', 'error',
    '-select_streams', 'a',
    '-show_entries', 'stream=index:stream_tags=language',
    '-of', 'json',
    filePath,
  ]).then((out) => {
    if (!out) return []
    try {
      const json = JSON.parse(out) as { streams?: { tags?: { language?: string } }[] }
      return (json.streams ?? []).map((s) => s.tags?.language ?? '')
    } catch {
      return []
    }
  })
  audioLangCache.set(filePath, probe)
  return probe
}
