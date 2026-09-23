import { Router } from 'express'
import type { Response } from 'express'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../db.js'
import { tmdbCacheDir } from '../paths.js'
import { TMDB_IMAGE_BASE } from '../tmdb.js'
import { log } from '../logs.js'

export const artworkRouter = Router()

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.tbn': 'image/jpeg',
}

// Fetch a TMDB poster once, then serve it from disk. Guide clients (Jellyfin,
// Plex) pull artwork from us over the LAN and can't be assumed to have a route
// to the internet themselves — so we do the fetching on their behalf.
async function cachedTmdbPoster(tmdbPath: string, size = 'w500'): Promise<string | null> {
  // tmdbPath comes from our own DB and looks like "/abc123.jpg"; basename it so
  // it can't climb out of the cache dir.
  const file = path.join(tmdbCacheDir(), `${size}_${path.basename(tmdbPath)}`)
  if (fs.existsSync(file)) return file

  try {
    const res = await fetch(`${TMDB_IMAGE_BASE}/${size}${tmdbPath}`)
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

function sendArtwork(res: Response, filePath: string) {
  res.setHeader('Cache-Control', 'public, max-age=86400')
  res.type(MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream')
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).end()
  })
}

// GET /api/artwork/:id?type=poster|show|season|backdrop
// Serves local artwork when the scanner found some, else falls back to the
// item's (or its show's) TMDB poster, downloaded and cached locally. Only paths
// recorded on the item are used, so this can't be made to read arbitrary files.
//
// `backdrop` is the wide TMDB still behind the web UI's hero panels: a movie's
// own, or an episode's show's. There's no local equivalent to prefer.
artworkRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).end()

  const item = await prisma.mediaItem.findUnique({
    where: { id },
    select: {
      posterPath: true,
      showPosterPath: true,
      seasonPosterPath: true,
      tmdbPosterPath: true,
      tmdbBackdropPath: true,
      type: true,
      showTitle: true,
      libraryId: true,
    },
  })
  if (!item) return res.status(404).end()

  const type = req.query.type

  if (type === 'backdrop') {
    let backdrop = item.type === 'episode' ? null : item.tmdbBackdropPath
    if (!backdrop && item.showTitle) {
      const show = await prisma.show.findFirst({
        where: { libraryId: item.libraryId, title: item.showTitle },
        select: { tmdbBackdropPath: true },
      })
      backdrop = show?.tmdbBackdropPath ?? null
    }
    if (!backdrop) return res.status(404).end()
    const cached = await cachedTmdbPoster(backdrop, 'w1280')
    if (!cached) return res.status(404).end()
    return sendArtwork(res, cached)
  }
  const localPath =
    type === 'show'
      ? item.showPosterPath
      : type === 'season'
        ? item.seasonPosterPath
        : item.posterPath

  if (localPath && fs.existsSync(localPath)) return sendArtwork(res, localPath)

  // No local file — fall back to TMDB. Episodes rarely carry their own poster,
  // so reach for the show's.
  let tmdbPath: string | null = null
  if ((type === 'show' || item.type === 'episode') && item.showTitle) {
    const show = await prisma.show.findFirst({
      where: { libraryId: item.libraryId, title: item.showTitle },
      select: { tmdbPosterPath: true },
    })
    tmdbPath = show?.tmdbPosterPath ?? null
  }
  tmdbPath ??= item.tmdbPosterPath

  if (!tmdbPath) return res.status(404).end()
  const cached = await cachedTmdbPoster(tmdbPath)
  if (!cached) return res.status(404).end()
  sendArtwork(res, cached)
})
