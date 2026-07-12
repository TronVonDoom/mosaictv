import { spawn } from 'node:child_process'

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
