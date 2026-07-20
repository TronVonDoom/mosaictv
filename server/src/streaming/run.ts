import { spawn } from 'node:child_process'

export type ProgressCb = (percent: number) => void

/**
 * Run a generation ffmpeg to completion (output goes to a file, so stdout is
 * free for the -progress feed). When onProgress+totalSec are given, report
 * 0..99% from the output timestamp.
 *
 * NOTE: only for generation — never for the streaming pipe, which needs
 * stdout for the media itself (see pipeSegment in channel.ts).
 */
export function runFfmpeg(args: string[], onProgress?: ProgressCb, totalSec?: number): Promise<void> {
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
