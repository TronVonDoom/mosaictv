import { Router } from 'express'
import { prisma } from '../db.js'
import { collectionCount, resolveCollection } from '../collections.js'

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
  const { name, channelId, logoId, libraryId, filterType, filterShow, filterSearch, filterGenre } = req.body ?? {}
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' })
  const c = await prisma.collection.create({
    data: {
      name: String(name).trim(),
      channelId: channelId != null ? Number(channelId) : null,
      logoId: logoId != null ? Number(logoId) : null,
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

// Autocomplete: shows and movies matching a query, for adding as members.
collectionsRouter.get('/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!q) return res.json({ results: [] })

  const [shows, movies, libs] = await Promise.all([
    prisma.mediaItem.groupBy({
      by: ['showTitle', 'libraryId'],
      where: { type: 'episode', missing: false, showTitle: { contains: q } },
      _count: { _all: true },
      orderBy: { showTitle: 'asc' },
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
  const { name, logoId, libraryId, filterType, filterShow, filterSearch, filterGenre } = req.body ?? {}
  const data: {
    name?: string
    logoId?: number | null
    libraryId?: number | null
    filterType?: string | null
    filterShow?: string | null
    filterSearch?: string | null
    filterGenre?: string | null
  } = {}
  if (name !== undefined) data.name = String(name).trim()
  if (logoId !== undefined) data.logoId = logoId ? Number(logoId) : null
  if (libraryId !== undefined) data.libraryId = libraryId ? Number(libraryId) : null
  if (filterType !== undefined) data.filterType = filterType || null
  if (filterShow !== undefined) data.filterShow = filterShow || null
  if (filterSearch !== undefined) data.filterSearch = filterSearch || null
  if (filterGenre !== undefined) data.filterGenre = filterGenre || null
  const c = await prisma.collection.update({ where: { id }, data }).catch(() => null)
  if (!c) return res.status(404).json({ error: 'Not found' })
  res.json(c)
})

collectionsRouter.get('/:id/preview', async (req, res) => {
  const id = Number(req.params.id)
  const c = await prisma.collection.findUnique({ where: { id }, include: { items: true } })
  if (!c) return res.status(404).json({ error: 'Not found' })
  const members = await resolveCollection(c, 'chronological')
  res.json({ count: members.length, sample: members.slice(0, 12) })
})

// Add a member (a whole show, or a single movie).
collectionsRouter.post('/:id/items', async (req, res) => {
  const collectionId = Number(req.params.id)
  const { kind, showTitle, libraryId, mediaItemId, label } = req.body ?? {}
  if (kind !== 'show' && kind !== 'movie') {
    return res.status(400).json({ error: 'kind must be "show" or "movie"' })
  }
  if (kind === 'show' && !showTitle) return res.status(400).json({ error: 'showTitle is required' })
  if (kind === 'movie' && !mediaItemId) return res.status(400).json({ error: 'mediaItemId is required' })

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
      showTitle: kind === 'show' ? String(showTitle) : null,
      libraryId: libraryId ? Number(libraryId) : null,
      mediaItemId: kind === 'movie' ? Number(mediaItemId) : null,
      label: label ? String(label) : kind === 'show' ? String(showTitle) : null,
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
