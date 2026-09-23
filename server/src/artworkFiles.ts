// Artwork as files on disk: TMDB images fetched once and cached, and local
// posters shrunk to a thumbnail once and cached. Shared by the artwork route
// (the web UI and guide clients) and the on-screen info card, which needs a
// small local poster file to composite.

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { prisma } from './db.js'
import { log } from './logs.js'
import { thumbsDir, tmdbCacheDir } from './paths.js'
import { runFfmpeg } from './streaming/run.js'
import { TMDB_IMAGE_BASE } from './tmdb.js'

// Fetch a TMDB image once, then serve it from disk. Guide clients (Jellyfin,
// Plex) pull artwork from us over the LAN and can't be assumed to have a route
// to the internet themselves — so we do the fetching on their behalf.
export async function cachedTmdbImage(tmdbPath: string, size = 'w500', timeoutMs?: number): Promise<string | null> {
  // tmdbPath comes from our own DB and looks like "/abc123.jpg"; basename it so
  // it can't climb out of the cache dir.
  const file = path.join(tmdbCacheDir(), `${size}_${path.basename(tmdbPath)}`)
  if (fs.existsSync(file)) return file

  try {
    const res = await fetch(`${TMDB_IMAGE_BASE}/${size}${tmdbPath}`, timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : undefined)
    if (!res.ok) {
      log('warn', 'system', `TMDB poster fetch failed (${res.status}) for ${tmdbPath}`)
      return null
    }
    const buf = Buffer.from(await res.arrayBuffer())
    // Write to a temp name first so a half-downloaded file can never be served.
    const tmp = `${file}.${process.pid}.part`
    await fsp.writeFile(tmp, buf)
    await fsp.rename(tmp, file)
    log('debug', 'system', `Cached TMDB poster ${path.basename(file)} (${buf.length} bytes)`)
    return file
  } catch (e) {
    log('warn', 'system', `TMDB poster fetch errored for ${tmdbPath}`, String(e))
    return null
  }
}

// Local artwork is shrunk once with ffmpeg and cached, keyed by the source's
// path, mtime and width — so a replaced poster makes a new thumbnail. A few
// encodes at a time: a grid of sixty new posters mustn't fork sixty ffmpegs,
// and a second request for an image already being shrunk waits on the first.
const thumbJobs = new Map<string, Promise<string | null>>()
let thumbsRunning = 0
const thumbQueue: (() => void)[] = []
async function withThumbSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (thumbsRunning >= 3) await new Promise<void>((r) => thumbQueue.push(r))
  thumbsRunning++
  try {
    return await fn()
  } finally {
    thumbsRunning--
    thumbQueue.shift()?.()
  }
}

export async function localThumb(src: string, w: number): Promise<string | null> {
  const st = await fsp.stat(src).catch(() => null)
  if (!st) return null
  const out = path.join(thumbsDir(), createHash('sha1').update(`${src}|${st.mtimeMs}|${w}`).digest('hex') + '.jpg')
  if (fs.existsSync(out)) return out
  let job = thumbJobs.get(out)
  if (!job) {
    job = withThumbSlot(async () => {
      const tmp = `${out}.${process.pid}.part.jpg`
      try {
        await runFfmpeg(['-v', 'error', '-y', '-i', src, '-frames:v', '1', '-vf', `scale='min(${w},iw)':-2`, '-q:v', '4', tmp])
        await fsp.rename(tmp, out)
        return out
      } catch (e) {
        log('debug', 'system', `Thumbnail failed for ${path.basename(src)} — serving the original`, String(e))
        await fsp.rm(tmp, { force: true }).catch(() => {})
        return null
      }
    }).finally(() => thumbJobs.delete(out))
    thumbJobs.set(out, job)
  }
  return job
}

/**
 * A wide backdrop for an item (a movie's own, an episode's show's) from TMDB,
 * cached — the still behind the up-next card's settings preview.
 */
export async function backdropFileFor(item: { libraryId: number; type: string; showTitle: string | null; tmdbBackdropPath: string | null }): Promise<string | null> {
  let backdrop = item.type === 'episode' ? null : item.tmdbBackdropPath
  if (!backdrop && item.showTitle) {
    const show = await prisma.show.findFirst({
      where: { libraryId: item.libraryId, title: item.showTitle },
      select: { tmdbBackdropPath: true },
    })
    backdrop = show?.tmdbBackdropPath ?? null
  }
  return backdrop ? cachedTmdbImage(backdrop, 'w1280', 3000) : null
}

/**
 * A small poster file for an item, for the on-screen info card: the show's
 * poster for an episode, the item's own otherwise — local art first, TMDB's
 * second. Null when there is none, or it can't be had quickly (a TMDB fetch is
 * capped so a slow network never holds up an encode).
 */
export async function posterFileFor(
  item: { libraryId: number; type: string; showTitle: string | null; posterPath: string | null; showPosterPath: string | null; tmdbPosterPath: string | null },
  width = 240,
): Promise<string | null> {
  const local = item.type === 'episode' ? item.showPosterPath ?? item.posterPath : item.posterPath
  if (local && fs.existsSync(local)) return (await localThumb(local, width)) ?? local
  let tmdbPath = item.tmdbPosterPath
  if (item.type === 'episode' && item.showTitle) {
    const show = await prisma.show.findFirst({
      where: { libraryId: item.libraryId, title: item.showTitle },
      select: { tmdbPosterPath: true },
    })
    tmdbPath = show?.tmdbPosterPath ?? tmdbPath
  }
  return tmdbPath ? cachedTmdbImage(tmdbPath, 'w342', 3000) : null
}
