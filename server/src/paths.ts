import fs from 'node:fs'
import path from 'node:path'

export function dataDir(): string {
  const url = process.env.DATABASE_URL || ''
  const dir = url.startsWith('file:/') ? path.dirname(url.slice(5)) : path.join(process.cwd(), 'data')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function logosDir(): string {
  const d = path.join(dataDir(), 'logos')
  fs.mkdirSync(d, { recursive: true })
  return d
}

export function assetsDir(): string {
  const d = path.join(dataDir(), 'assets')
  fs.mkdirSync(d, { recursive: true })
  return d
}

// Live HLS output (one shared segment set per channel, served to all viewers).
// Ephemeral — cleaned when a channel's encoder stops.
export function hlsDir(): string {
  const d = path.join(dataDir(), 'hls')
  fs.mkdirSync(d, { recursive: true })
  return d
}

// Downloaded TMDB artwork, so guide clients fetch posters from us on the LAN
// rather than needing their own route to the internet.
export function tmdbCacheDir(): string {
  const d = path.join(dataDir(), 'tmdb-cache')
  fs.mkdirSync(d, { recursive: true })
  return d
}

// Legacy http:// logo URLs downloaded for watermarking. Kept under the data
// dir like everything else the app writes — never the media library, and not
// the container's /tmp, which is lost on restart.
export function logoCacheDir(): string {
  const d = path.join(dataDir(), 'logo-cache')
  fs.mkdirSync(d, { recursive: true })
  return d
}
