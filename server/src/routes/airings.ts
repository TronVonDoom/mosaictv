import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db.js'

export const airingsRouter = Router()

// The default broadcast-block length the suggester packs toward (a US half-hour
// slot). Multi-segment cartoons pack ~three 7-minute shorts into one of these.
const DEFAULT_TARGET_SEC = 22 * 60

// The season a request is scoped to: a number, or null for the "unsorted"
// (no season) bucket. `?season=` absent means "any"; an explicit empty/-1 means
// null.
function parseSeason(raw: unknown): number | null | undefined {
  if (raw == null || raw === '') return undefined
  const n = Number(raw)
  if (Number.isNaN(n) || n < 0) return null
  return n
}

function episodeWhere(libraryId: number, show: string, season: number | null | undefined): Prisma.MediaItemWhereInput {
  return {
    type: 'episode',
    missing: false,
    libraryId,
    showTitle: show,
    ...(season === undefined ? {} : { season }),
  }
}

// GET /api/airings?libraryId=&show=  -> the show's defined airings + segments.
airingsRouter.get('/', async (req, res) => {
  const libraryId = Number(req.query.libraryId)
  const show = typeof req.query.show === 'string' ? req.query.show : ''
  if (!Number.isFinite(libraryId) || !show) {
    return res.status(400).json({ error: 'libraryId and show are required' })
  }
  const airings = await prisma.airing.findMany({
    where: { libraryId, showTitle: show },
    include: { segments: { orderBy: { order: 'asc' }, select: { mediaItemId: true, order: true } } },
    orderBy: [{ season: 'asc' }, { number: 'asc' }],
  })
  res.json({
    airings: airings.map((a) => ({
      id: a.id,
      season: a.season,
      number: a.number,
      title: a.title,
      segmentIds: a.segments.map((s) => s.mediaItemId),
    })),
  })
})

// GET /api/airings/suggest?libraryId=&show=&season=&targetSec=
// Propose a broadcast running order by packing consecutive episodes up to
// ~targetSec, using the durations already probed. Nothing is saved — the client
// reviews and PUTs what it wants to keep. Returns every block (singletons too).
airingsRouter.get('/suggest', async (req, res) => {
  const libraryId = Number(req.query.libraryId)
  const show = typeof req.query.show === 'string' ? req.query.show : ''
  const season = parseSeason(req.query.season)
  const targetSec = Number(req.query.targetSec) > 0 ? Number(req.query.targetSec) : DEFAULT_TARGET_SEC
  if (!Number.isFinite(libraryId) || !show) {
    return res.status(400).json({ error: 'libraryId and show are required' })
  }
  const eps = await prisma.mediaItem.findMany({
    // Only packable episodes (the suggester needs real durations).
    where: { ...episodeWhere(libraryId, show, season), durationSec: { gt: 0 } },
    orderBy: [{ season: 'asc' }, { episode: 'asc' }],
    select: { id: true, durationSec: true },
  })

  // Greedy pack: keep adding the next episode while the running block stays
  // within ~10% of the target; otherwise start a fresh block.
  const tolerance = 1.1
  const blocks: number[][] = []
  let cur: number[] = []
  let curDur = 0
  for (const ep of eps) {
    const d = ep.durationSec ?? 0
    if (cur.length === 0) {
      cur = [ep.id]
      curDur = d
    } else if (curDur + d <= targetSec * tolerance) {
      cur.push(ep.id)
      curDur += d
    } else {
      blocks.push(cur)
      cur = [ep.id]
      curDur = d
    }
  }
  if (cur.length) blocks.push(cur)
  res.json({ blocks })
})

// PUT /api/airings  { libraryId, showTitle, season, groups: number[][] }
// Replace the airings for one (show, season): existing airings for that scope
// are deleted and one is created per group of 2+ segments (singletons are just
// normal episodes and are not stored). Segment ids outside the season are
// ignored. Returns the show's full airing list afterwards.
airingsRouter.put('/', async (req, res) => {
  const body = req.body ?? {}
  const libraryId = Number(body.libraryId)
  const showTitle = typeof body.showTitle === 'string' ? body.showTitle : ''
  const season = parseSeason(body.season)
  const groups: unknown = body.groups
  if (!Number.isFinite(libraryId) || !showTitle || season === undefined) {
    return res.status(400).json({ error: 'libraryId, showTitle and season are required' })
  }
  if (!Array.isArray(groups)) {
    return res.status(400).json({ error: 'groups must be an array of id arrays' })
  }

  // Only ids that are real episodes in this scope may be grouped, and each may
  // appear in at most one airing.
  const eps = await prisma.mediaItem.findMany({
    where: episodeWhere(libraryId, showTitle, season),
    select: { id: true },
  })
  const valid = new Set(eps.map((e) => e.id))
  const used = new Set<number>()
  const clean: number[][] = []
  for (const g of groups) {
    if (!Array.isArray(g)) continue
    const ids = g
      .map(Number)
      .filter((id) => valid.has(id) && !used.has(id))
    if (ids.length >= 2) {
      ids.forEach((id) => used.add(id))
      clean.push(ids)
    }
  }

  await prisma.$transaction([
    prisma.airing.deleteMany({ where: { libraryId, showTitle, season: season ?? null } }),
    ...clean.map((ids, gi) =>
      prisma.airing.create({
        data: {
          libraryId,
          showTitle,
          season: season ?? null,
          number: gi + 1,
          segments: { create: ids.map((mediaItemId, order) => ({ mediaItemId, order })) },
        },
      }),
    ),
  ])

  const saved = await prisma.airing.findMany({
    where: { libraryId, showTitle },
    include: { segments: { orderBy: { order: 'asc' }, select: { mediaItemId: true } } },
    orderBy: [{ season: 'asc' }, { number: 'asc' }],
  })
  res.json({
    airings: saved.map((a) => ({
      id: a.id,
      season: a.season,
      number: a.number,
      title: a.title,
      segmentIds: a.segments.map((s) => s.mediaItemId),
    })),
  })
})

// DELETE /api/airings/:id  -> ungroup a single airing.
airingsRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' })
  await prisma.airing.deleteMany({ where: { id } })
  res.status(204).end()
})
