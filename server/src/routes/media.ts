import { Router } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db.js'

export const mediaRouter = Router()

mediaRouter.get('/', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50))
  const type = typeof req.query.type === 'string' && req.query.type ? req.query.type : undefined
  const libraryId = req.query.libraryId ? Number(req.query.libraryId) : undefined
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''

  const where: Prisma.MediaItemWhereInput = {}
  if (type) where.type = type
  if (libraryId && !Number.isNaN(libraryId)) where.libraryId = libraryId
  if (q) {
    where.OR = [{ title: { contains: q } }, { showTitle: { contains: q } }]
  }

  // Title order by default (shows, then season/episode); the library grid also
  // offers newest release, most recently added, and TMDB rating.
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'title'
  const orderBy: Prisma.MediaItemOrderByWithRelationInput[] =
    sort === 'year'
      ? [{ year: 'desc' }, { title: 'asc' }]
      : sort === 'added'
        ? [{ addedAt: 'desc' }, { title: 'asc' }]
        : sort === 'rating'
          ? [{ rating: 'desc' }, { title: 'asc' }]
          : [{ showTitle: 'asc' }, { season: 'asc' }, { episode: 'asc' }, { title: 'asc' }]

  const [total, items] = await Promise.all([
    prisma.mediaItem.count({ where }),
    prisma.mediaItem.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  res.json({ total, page, pageSize, items })
})

// GET /api/media/:id  -> one item with its library name (for the detail panel)
mediaRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (Number.isNaN(id)) return res.status(400).json({ error: 'invalid id' })
  const item = await prisma.mediaItem.findUnique({
    where: { id },
    include: { library: { select: { name: true, kind: true } } },
  })
  if (!item) return res.status(404).json({ error: 'Not found' })
  res.json(item)
})
