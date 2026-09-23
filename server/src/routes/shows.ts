import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db.js'

export const showsRouter = Router()

// GET /api/shows?libraryId=  -> one card per show in a TV library
showsRouter.get('/', async (req, res) => {
  const libraryId = req.query.libraryId ? Number(req.query.libraryId) : undefined
  const where: Prisma.MediaItemWhereInput = {
    type: 'episode',
    missing: false,
    showTitle: { not: null },
  }
  if (libraryId && !Number.isNaN(libraryId)) where.libraryId = libraryId

  const episodes = await prisma.mediaItem.findMany({
    where,
    select: {
      id: true,
      showTitle: true,
      season: true,
      year: true,
      durationSec: true,
      libraryId: true,
      showPosterPath: true,
    },
  })

  type Agg = {
    showTitle: string
    year: number | null
    seasons: Set<number>
    episodeCount: number
    totalDurationSec: number
    libraryId: number
    posterItemId: number | null
    anyItemId: number
  }
  const map = new Map<string, Agg>()
  for (const e of episodes) {
    const key = e.libraryId + ':' + (e.showTitle as string)
    let agg = map.get(key)
    if (!agg) {
      agg = {
        showTitle: e.showTitle as string,
        year: e.year,
        seasons: new Set(),
        episodeCount: 0,
        totalDurationSec: 0,
        libraryId: e.libraryId,
        posterItemId: null,
        anyItemId: e.id,
      }
      map.set(key, agg)
    }
    if (e.season != null) agg.seasons.add(e.season)
    agg.episodeCount++
    agg.totalDurationSec += e.durationSec ?? 0
    if (agg.year == null && e.year != null) agg.year = e.year
    if (agg.posterItemId == null && e.showPosterPath) agg.posterItemId = e.id
  }

  // TMDB metadata (if fetched).
  const metaRows = await prisma.show.findMany({
    where: libraryId ? { libraryId } : {},
    select: {
      libraryId: true,
      title: true,
      year: true,
      tmdbPosterPath: true,
      overview: true,
      rating: true,
      genres: true,
    },
  })
  const metaMap = new Map(metaRows.map((m) => [m.libraryId + ':' + m.title, m]))

  const shows = [...map.values()]
    .map((s) => {
      const m = metaMap.get(s.libraryId + ':' + s.showTitle)
      return {
        showTitle: s.showTitle,
        year: s.year ?? m?.year ?? null,
        seasonCount: s.seasons.size,
        episodeCount: s.episodeCount,
        totalDurationSec: s.totalDurationSec,
        libraryId: s.libraryId,
        posterItemId: s.posterItemId,
        // Any episode will do to ask /api/artwork for the show's TMDB poster,
        // which the server caches — so browsers on a LAN without internet
        // still get artwork.
        artItemId: s.anyItemId,
        tmdbPosterPath: m?.tmdbPosterPath ?? null,
        overview: m?.overview ?? null,
        rating: m?.rating ?? null,
        genres: m?.genres ?? null,
      }
    })
    .sort((a, b) => a.showTitle.localeCompare(b.showTitle))

  res.json({ shows })
})

// GET /api/shows/detail?show=NAME&libraryId=  -> seasons, each with its episodes
showsRouter.get('/detail', async (req, res) => {
  const show = typeof req.query.show === 'string' ? req.query.show : ''
  if (!show) return res.status(400).json({ error: 'show query param is required' })
  const libraryId = req.query.libraryId ? Number(req.query.libraryId) : undefined

  const where: Prisma.MediaItemWhereInput = { type: 'episode', showTitle: show }
  if (libraryId && !Number.isNaN(libraryId)) where.libraryId = libraryId

  const [episodes, showRow] = await Promise.all([
    prisma.mediaItem.findMany({ where, orderBy: [{ season: 'asc' }, { episode: 'asc' }] }),
    prisma.show.findFirst({
      where: { title: show, ...(libraryId ? { libraryId } : {}) },
      include: { seasons: true },
    }),
  ])

  const seasonPosterByNumber = new Map(
    (showRow?.seasons ?? []).map((s) => [s.number, s.tmdbPosterPath]),
  )

  const seasonMap = new Map<number, typeof episodes>()
  for (const ep of episodes) {
    const key = ep.season ?? -1
    if (!seasonMap.has(key)) seasonMap.set(key, [])
    seasonMap.get(key)!.push(ep)
  }
  const seasons = [...seasonMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([season, eps]) => ({
      season: season === -1 ? null : season,
      episodes: eps,
      tmdbPosterPath: season === -1 ? null : seasonPosterByNumber.get(season) ?? null,
    }))

  const year = showRow?.year ?? episodes.find((e) => e.year != null)?.year ?? null
  res.json({
    showTitle: show,
    year,
    episodeCount: episodes.length,
    overview: showRow?.overview ?? null,
    genres: showRow?.genres ?? null,
    rating: showRow?.rating ?? null,
    tmdbPosterPath: showRow?.tmdbPosterPath ?? null,
    // The web's hero panel asks /api/artwork/<any episode>?type=backdrop, which
    // resolves to the show's TMDB backdrop — so name an episode, and say
    // whether there's anything to fetch.
    hasBackdrop: !!showRow?.tmdbBackdropPath,
    artItemId: episodes[0]?.id ?? null,
    seasons,
  })
})
