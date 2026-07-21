import { Router } from 'express'
import { prisma } from '../db.js'
import { asPlaybackOrder, collectionCount, resolveCollection } from '../collections.js'

export const collectionsRouter = Router()

collectionsRouter.get('/', async (req, res) => {
  const channelId = req.query.channelId != null ? Number(req.query.channelId) : undefined
  const cols = await prisma.collection.findMany({
    where: channelId != null ? { channelId } : {},
    orderBy: { createdAt: 'asc' },
    include: { items: { orderBy: { order: 'asc' } } },
  })
  const withCounts = await Promise.all(
    cols.map(async (c) => ({ ...c, itemCount: await collectionCount(c) })),
  )
  res.json(withCounts)
})

collectionsRouter.post('/', async (req, res) => {
  const { name, channelId, logoId, libraryId, defaultOrder, filterType, filterShow, filterSearch, filterGenre } = req.body ?? {}
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' })
  const c = await prisma.collection.create({
    data: {
      name: String(name).trim(),
      channelId: channelId != null ? Number(channelId) : null,
      logoId: logoId != null ? Number(logoId) : null,
      defaultOrder: asPlaybackOrder(defaultOrder),
      libraryId: libraryId ? Number(libraryId) : null,
      filterType: filterType || null,
      filterShow: filterShow || null,
      filterSearch: filterSearch || null,
      filterGenre: filterGenre || null,
    },
    include: { items: true },
  })
  res.status(201).json(c)
})

// Autocomplete for adding members: whole shows, their individual seasons,
// single episodes, and movies. Seasons and episodes are what make a
// hand-picked running order worth having (a "best of" marathon).
collectionsRouter.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!q) return res.json({ results: [] })

  const [shows, seasons, episodes, movies, libs] = await Promise.all([
    prisma.mediaItem.groupBy({
      by: ['showTitle', 'libraryId'],
      where: { type: 'episode', missing: false, showTitle: { contains: q } },
      _count: { _all: true },
      orderBy: { showTitle: 'asc' },
      take: 8,
    }),
    prisma.mediaItem.groupBy({
      by: ['showTitle', 'libraryId', 'season'],
      where: { type: 'episode', missing: false, showTitle: { contains: q } },
      _count: { _all: true },
      orderBy: [{ showTitle: 'asc' }, { season: 'asc' }],
      take: 20,
    }),
    // Episodes whose OWN title matches — a show-title match would just repeat
    // the show entry one line per episode.
    prisma.mediaItem.findMany({
      where: { type: 'episode', missing: false, title: { contains: q } },
      select: { id: true, title: true, showTitle: true, season: true, episode: true },
      orderBy: [{ showTitle: 'asc' }, { season: 'asc' }, { episode: 'asc' }],
      take: 8,
    }),
    prisma.mediaItem.findMany({
      where: { type: 'movie', missing: false, title: { contains: q } },
      select: { id: true, title: true, year: true },
      orderBy: { title: 'asc' },
      take: 8,
    }),
    prisma.library.findMany({ select: { id: true, name: true } }),
  ])
  const libName = new Map(libs.map((l) => [l.id, l.name]))

  const results = [
    ...shows.map((s) => ({
      kind: 'show' as const,
      showTitle: s.showTitle,
      libraryId: s.libraryId,
      libraryName: libName.get(s.libraryId) ?? '',
      episodeCount: s._count._all,
    })),
    ...seasons
      .filter((s) => s.season != null)
      .map((s) => ({
        kind: 'season' as const,
        showTitle: s.showTitle,
        libraryId: s.libraryId,
        libraryName: libName.get(s.libraryId) ?? '',
        season: s.season as number,
        episodeCount: s._count._all,
      })),
    ...episodes.map((e) => ({
      kind: 'episode' as const,
      mediaItemId: e.id,
      title: e.title,
      showTitle: e.showTitle,
      season: e.season,
      episode: e.episode,
    })),
    ...movies.map((m) => ({
      kind: 'movie' as const,
      mediaItemId: m.id,
      title: m.title,
      year: m.year,
    })),
  ]
  res.json({ results })
})

collectionsRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const { name, logoId, libraryId, defaultOrder, filterType, filterShow, filterSearch, filterGenre } = req.body ?? {}
  const data: {
    name?: string
    logoId?: number | null
    libraryId?: number | null
    defaultOrder?: string
    filterType?: string | null
    filterShow?: string | null
    filterSearch?: string | null
    filterGenre?: string | null
  } = {}
  if (name !== undefined) data.name = String(name).trim()
  if (logoId !== undefined) data.logoId = logoId ? Number(logoId) : null
  if (libraryId !== undefined) data.libraryId = libraryId ? Number(libraryId) : null
  if (defaultOrder !== undefined) data.defaultOrder = asPlaybackOrder(defaultOrder)
  if (filterType !== undefined) data.filterType = filterType || null
  if (filterShow !== undefined) data.filterShow = filterShow || null
  if (filterSearch !== undefined) data.filterSearch = filterSearch || null
  if (filterGenre !== undefined) data.filterGenre = filterGenre || null
  const c = await prisma.collection.update({ where: { id }, data }).catch(() => null)
  if (!c) return res.status(404).json({ error: 'Not found' })
  res.json(c)
})

// Preview what the collection actually airs, in the requested playback order.
collectionsRouter.get('/:id/preview', async (req, res) => {
  const id = Number(req.params.id)
  const c = await prisma.collection.findUnique({
    where: { id },
    include: { items: { orderBy: { order: 'asc' } } },
  })
  if (!c) return res.status(404).json({ error: 'Not found' })
  // No explicit order = show what the collection plays by default.
  const order = asPlaybackOrder(req.query.order ?? c.defaultOrder)
  const list = await resolveCollection(c, order, id)
  const sample = Array.from({ length: Math.min(12, list.length) }, (_, i) => list.at(i))
  res.json({ count: list.length, order, sample })
})

// Reorder hand-picked members. Body: { ids: number[] } — the members in their
// new order; any member missing from `ids` keeps its place at the end.
collectionsRouter.patch('/:id/items/reorder', async (req, res) => {
  const collectionId = Number(req.params.id)
  const raw: unknown = req.body?.ids
  if (!Array.isArray(raw)) return res.status(400).json({ error: 'ids must be an array of member ids' })
  const ids: number[] = raw.map(Number)

  const existing = await prisma.collectionItem.findMany({
    where: { collectionId },
    orderBy: { order: 'asc' },
    select: { id: true },
  })
  const known = new Set(existing.map((i) => i.id))
  // Only ids that belong to this collection, deduped, then anything left over.
  const ordered: number[] = [...new Set(ids.filter((id) => known.has(id)))]
  for (const i of existing) if (!ordered.includes(i.id)) ordered.push(i.id)

  await prisma.$transaction(
    ordered.map((id, order) => prisma.collectionItem.update({ where: { id }, data: { order } })),
  )
  const items = await prisma.collectionItem.findMany({
    where: { collectionId },
    orderBy: { order: 'asc' },
  })
  res.json(items)
})

// Add a member: a whole show, one season of it, a single episode, or a movie.
const MEMBER_KINDS = ['show', 'season', 'episode', 'movie']
collectionsRouter.post('/:id/items', async (req, res) => {
  const collectionId = Number(req.params.id)
  const { kind, showTitle, libraryId, season, mediaItemId, label } = req.body ?? {}
  if (!MEMBER_KINDS.includes(kind)) {
    return res.status(400).json({ error: `kind must be one of ${MEMBER_KINDS.join(', ')}` })
  }
  const byShow = kind === 'show' || kind === 'season'
  if (byShow && !showTitle) return res.status(400).json({ error: 'showTitle is required' })
  if (kind === 'season' && season == null) {
    return res.status(400).json({ error: 'season is required' })
  }
  if (!byShow && !mediaItemId) return res.status(400).json({ error: 'mediaItemId is required' })

  const col = await prisma.collection.findUnique({ where: { id: collectionId } })
  if (!col) return res.status(404).json({ error: 'Collection not found' })

  const max = await prisma.collectionItem.aggregate({
    where: { collectionId },
    _max: { order: true },
  })
  const item = await prisma.collectionItem.create({
    data: {
      collectionId,
      kind,
      showTitle: byShow ? String(showTitle) : null,
      libraryId: libraryId ? Number(libraryId) : null,
      season: kind === 'season' ? Number(season) : null,
      mediaItemId: byShow ? null : Number(mediaItemId),
      label: label ? String(label) : byShow ? String(showTitle) : null,
      order: (max._max.order ?? -1) + 1,
    },
  })
  res.status(201).json(item)
})

collectionsRouter.delete('/:id/items/:itemId', async (req, res) => {
  await prisma.collectionItem.delete({ where: { id: Number(req.params.itemId) } }).catch(() => {})
  res.status(204).end()
})

collectionsRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const [rotations, blocks] = await Promise.all([
    prisma.rotationItem.count({ where: { collectionId: id } }),
    prisma.timeBlock.count({ where: { collectionId: id } }),
  ])
  if (rotations + blocks > 0) {
    return res.status(409).json({ error: 'Collection is used by a channel. Remove it there first.' })
  }
  await prisma.collection.delete({ where: { id } }).catch(() => {})
  res.status(204).end()
})
