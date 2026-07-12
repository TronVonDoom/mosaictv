import { Router } from 'express'
import fs from 'node:fs'
import { prisma } from '../db.js'
import { isScanning } from '../scanner/scanner.js'

export const librariesRouter = Router()

const KINDS = ['tv', 'movie', 'other']

librariesRouter.get('/', async (_req, res) => {
  const libs = await prisma.library.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { items: true } } },
  })
  res.json(
    libs.map((l) => ({
      id: l.id,
      name: l.name,
      path: l.path,
      kind: l.kind,
      createdAt: l.createdAt,
      itemCount: l._count.items,
    })),
  )
})

librariesRouter.post('/', async (req, res) => {
  const { name, path: p, kind } = req.body ?? {}
  if (!name || !p || !KINDS.includes(kind)) {
    return res
      .status(400)
      .json({ error: 'name, path, and kind (tv|movie|other) are required' })
  }
  if (!fs.existsSync(p)) {
    return res.status(400).json({
      error: `Path not found inside the container: ${p} — make sure it's under your mounted /media volume.`,
    })
  }
  try {
    const lib = await prisma.library.create({ data: { name, path: p, kind } })
    res.status(201).json(lib)
  } catch {
    res.status(409).json({ error: 'A library with that path already exists.' })
  }
})

librariesRouter.delete('/:id', async (req, res) => {
  if (isScanning()) {
    return res.status(409).json({ error: 'Cannot delete a library while a scan is running.' })
  }
  const id = Number(req.params.id)
  await prisma.library.delete({ where: { id } }).catch(() => {})
  res.status(204).end()
})
