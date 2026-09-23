import { Router } from 'express'
import type { Response } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { cachedTmdbImage, localThumb } from '../artworkFiles.js'

export const artworkRouter = Router()

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.tbn': 'image/jpeg',
}

// ---- Thumbnails --------------------------------------------------------------
// The web UI's grids ask for `?w=` sized to the tile. A request rounds up to one
// of a few widths so the cache holds a handful of sizes, not one per pixel;
// anything wider than the largest gets the original.
const THUMB_WIDTHS = [160, 320, 480, 780]
function thumbWidth(q: unknown): number | null {
  const n = Number(q)
  if (!Number.isFinite(n) || n <= 0) return null
  return THUMB_WIDTHS.find((w) => w >= n) ?? null
}

// TMDB serves fixed sizes — ask for the smallest that covers the request.
const tmdbPosterSize = (w: number | null) => (!w ? 'w500' : w <= 185 ? 'w185' : w <= 342 ? 'w342' : 'w500')
const tmdbBackdropSize = (w: number | null) => (!w || w > 780 ? 'w1280' : w <= 300 ? 'w300' : 'w780')

function sendArtwork(res: Response, filePath: string, maxAgeSec = 86400) {
  res.setHeader('Cache-Control', `public, max-age=${maxAgeSec}`)
  res.type(MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream')
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) res.status(404).end()
  })
}

// GET /api/artwork/random/backdrop -> { id } of something with a backdrop —
// the backdrop behind the Studio and Settings watermark previews.
artworkRouter.get('/random/backdrop', async (_req, res) => {
  const where = { missing: false, tmdbBackdropPath: { not: null } }
  const n = await prisma.mediaItem.count({ where })
  if (n === 0) return res.status(404).json({ error: 'No backdrops yet — fetch TMDB metadata for a library.' })
  const pick = await prisma.mediaItem.findFirst({ where, skip: Math.floor(Math.random() * n), select: { id: true } })
  res.json({ id: pick?.id ?? null })
})

// GET /api/artwork/:id?type=poster|show|season|backdrop&w=
// Serves local artwork when the scanner found some, else falls back to the
// item's (or its show's) TMDB poster, downloaded and cached locally. Only paths
// recorded on the item are used, so this can't be made to read arbitrary files.
//
// `backdrop` is the wide TMDB still behind the web UI's hero panels: a movie's
// own, or an episode's show's. There's no local equivalent to prefer.
//
// `w` asks for a thumbnail about that wide — see thumbWidth.
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
      season: true,
      libraryId: true,
    },
  })
  if (!item) return res.status(404).end()

  const type = req.query.type
  const w = thumbWidth(req.query.w)

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
    const cached = await cachedTmdbImage(backdrop, tmdbBackdropSize(w))
    if (!cached) return res.status(404).end()
    return sendArtwork(res, cached, 604800)
  }
  const localPath =
    type === 'show'
      ? item.showPosterPath
      : type === 'season'
        ? item.seasonPosterPath
        : item.posterPath

  if (localPath && fs.existsSync(localPath)) {
    if (w) {
      const thumb = await localThumb(localPath, w)
      if (thumb) return sendArtwork(res, thumb, 604800)
    }
    return sendArtwork(res, localPath)
  }

  // No local file — fall back to TMDB. Episodes rarely carry their own poster,
  // so reach for the show's — or for a season, that season's own TMDB poster
  // first, so a list of seasons doesn't show the same picture five times.
  let tmdbPath: string | null = null
  if ((type === 'show' || type === 'season' || item.type === 'episode') && item.showTitle) {
    const show = await prisma.show.findFirst({
      where: { libraryId: item.libraryId, title: item.showTitle },
      select: {
        tmdbPosterPath: true,
        seasons:
          type === 'season' && item.season != null
            ? { where: { number: item.season }, select: { tmdbPosterPath: true } }
            : false,
      },
    })
    tmdbPath = show?.seasons?.[0]?.tmdbPosterPath ?? show?.tmdbPosterPath ?? null
  }
  tmdbPath ??= item.tmdbPosterPath

  if (!tmdbPath) return res.status(404).end()
  const cached = await cachedTmdbImage(tmdbPath, tmdbPosterSize(w))
  if (!cached) return res.status(404).end()
  sendArtwork(res, cached, w ? 604800 : 86400)
})
