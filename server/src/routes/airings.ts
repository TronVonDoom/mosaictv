import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db.js'

export const airingsRouter = Router()

// The default broadcast-block length the suggester packs toward (a US half-hour
// slot). Multi-segment cartoons pack ~three 7-minute shorts into one of these.
const DEFAULT_TARGET_SEC = 22 * 60

// Fields the editor needs to render any segment — including one borrowed from
// another show, which the current season's episode list wouldn't carry.
const SEGMENT_SELECT = {
  id: true,
  showTitle: true,
  season: true,
  episode: true,
  title: true,
  durationSec: true,
  missing: true,
} satisfies Prisma.MediaItemSelect

type SegmentRow = Prisma.MediaItemGetPayload<{ select: typeof SEGMENT_SELECT }>
function segmentDto(m: SegmentRow) {
  return {
    mediaItemId: m.id,
    showTitle: m.showTitle,
    season: m.season,
    episode: m.episode,
    title: m.title,
    durationSec: m.durationSec,
    missing: m.missing,
  }
}

type AiringRow = Prisma.AiringGetPayload<{
  include: { segments: { include: { mediaItem: { select: typeof SEGMENT_SELECT } } } }
}>
function airingDto(a: AiringRow) {
  return {
    id: a.id,
    season: a.season,
    number: a.number,
    title: a.title,
    segments: a.segments.map((s) => segmentDto(s.mediaItem)),
  }
}
const airingInclude = {
  segments: { orderBy: { order: 'asc' as const }, include: { mediaItem: { select: SEGMENT_SELECT } } },
}

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

// GET /api/airings?libraryId=&show=  -> the show's airings with full segment info.
airingsRouter.get('/', async (req, res) => {
  const libraryId = Number(req.query.libraryId)
  const show = typeof req.query.show === 'string' ? req.query.show : ''
  if (!Number.isFinite(libraryId) || !show) {
    return res.status(400).json({ error: 'libraryId and show are required' })
  }
  const airings = await prisma.airing.findMany({
    where: { libraryId, showTitle: show },
    include: airingInclude,
    orderBy: [{ season: 'asc' }, { number: 'asc' }],
  })
  res.json({ airings: airings.map(airingDto) })
})

// GET /api/airings/appearances?libraryId=&show=
// The reverse of the owned-airings query: every place an episode of THIS show is
// borrowed as a segment inside ANOTHER show's broadcast episode (Secret Squirrel
// woven into 2 Stupid Dogs). One row per (my episode, host airing) — an episode
// borrowed into two hosts yields two rows. Cheap: AiringSegment is indexed by
// mediaItemId. Lets the show's own page flag which of its episodes air elsewhere.
airingsRouter.get('/appearances', async (req, res) => {
  const libraryId = Number(req.query.libraryId)
  const show = typeof req.query.show === 'string' ? req.query.show : ''
  if (!Number.isFinite(libraryId) || !show) {
    return res.status(400).json({ error: 'libraryId and show are required' })
  }
  const segs = await prisma.airingSegment.findMany({
    where: {
      mediaItem: { libraryId, showTitle: show },
      airing: { libraryId, showTitle: { not: show } },
    },
    include: {
      mediaItem: { select: SEGMENT_SELECT },
      airing: { select: { id: true, showTitle: true, number: true, season: true } },
    },
  })
  const appearances = segs.map((s) => ({
    mediaItemId: s.mediaItemId,
    season: s.mediaItem.season,
    episode: s.mediaItem.episode,
    title: s.mediaItem.title,
    host: {
      showTitle: s.airing.showTitle,
      airingId: s.airing.id,
      number: s.airing.number,
      season: s.airing.season,
    },
  }))
  res.json({ appearances })
})

// GET /api/airings/search-episodes?libraryId=&q=&limit=
// Episodes across every show in the library, for inserting a segment from
// another show into an airing (the 2 Stupid Dogs / Secret Squirrel case).
airingsRouter.get('/search-episodes', async (req, res) => {
  const libraryId = Number(req.query.libraryId)
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const limit = Math.min(Number(req.query.limit) || 40, 100)
  if (!Number.isFinite(libraryId)) {
    return res.status(400).json({ error: 'libraryId is required' })
  }
  const rows = await prisma.mediaItem.findMany({
    where: {
      libraryId,
      type: 'episode',
      missing: false,
      durationSec: { gt: 0 },
      ...(q
        ? { OR: [{ title: { contains: q } }, { showTitle: { contains: q } }] }
        : {}),
    },
    orderBy: [{ showTitle: 'asc' }, { season: 'asc' }, { episode: 'asc' }],
    take: limit,
    select: SEGMENT_SELECT,
  })
  res.json({ episodes: rows.map(segmentDto) })
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
// Replace the airings filed under one (show, season). Each group of 2+ segments
// becomes an airing; singletons are plain episodes and aren't stored. Segment
// ids may reference episodes of OTHER shows (a borrowed segment); order within a
// group is preserved. Returns the show's full airing list afterwards.
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

  // A segment id is valid if it's a playable episode in this library (any show —
  // that's what allows cross-show blocks). Each file appears in one airing.
  const allIds = [...new Set(groups.flatMap((g) => (Array.isArray(g) ? g.map(Number) : [])))]
  const playable = allIds.length
    ? await prisma.mediaItem.findMany({
        where: { id: { in: allIds }, libraryId, type: 'episode', missing: false, durationSec: { gt: 0 } },
        select: { id: true },
      })
    : []
  const valid = new Set(playable.map((e) => e.id))
  const used = new Set<number>()
  const clean: number[][] = []
  for (const g of groups) {
    if (!Array.isArray(g)) continue
    const ids = g.map(Number).filter((id) => valid.has(id) && !used.has(id))
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
    include: airingInclude,
    orderBy: [{ season: 'asc' }, { number: 'asc' }],
  })
  res.json({ airings: saved.map(airingDto) })
})

// DELETE /api/airings/:id  -> ungroup a single airing.
airingsRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' })
  await prisma.airing.deleteMany({ where: { id } })
  res.status(204).end()
})
