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

  const [total, items] = await Promise.all([
    prisma.mediaItem.count({ where }),
    prisma.mediaItem.findMany({
      where,
      orderBy: [
        { showTitle: 'asc' },
        { season: 'asc' },
        { episode: 'asc' },
        { title: 'asc' },
      ],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  res.json({ total, page, pageSize, items })
})
