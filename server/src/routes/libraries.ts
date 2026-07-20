import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { isScanning } from '../scanner/scanner.js'

export const librariesRouter = Router()

const KINDS = ['tv', 'movie', 'music', 'other']

librariesRouter.get('/', async (_req, res) => {
  const libs = await prisma.library.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      folders: { orderBy: { id: 'asc' }, select: { id: true, path: true } },
      _count: { select: { items: true } },
    },
  })
  res.json(
    libs.map((l) => ({
      id: l.id,
      name: l.name,
      kind: l.kind,
      createdAt: l.createdAt,
      folders: l.folders,
      itemCount: l._count.items,
    })),
  )
})

librariesRouter.post('/', async (req, res) => {
  const { name, kind } = req.body ?? {}
  const folders: unknown = req.body?.folders
  const paths = Array.isArray(folders)
    ? folders
        .map((p) => String(p).trim())
        .filter(Boolean)
        .map((p) => path.resolve(p)) // canonical separators so media paths prefix-match
    : []

  if (!name || !KINDS.includes(kind) || paths.length === 0) {
    return res
      .status(400)
      .json({ error: 'name, kind (tv|movie|music|other), and at least one folder are required' })
  }
  for (const p of paths) {
    if (!fs.existsSync(p)) {
      return res.status(400).json({
        error: `Path not found inside the container: ${p} — make sure it's under your mounted /media volume.`,
      })
    }
  }

  try {
    const lib = await prisma.library.create({
      data: { name, kind, folders: { create: paths.map((p) => ({ path: p })) } },
      include: { folders: true },
    })
    res.status(201).json(lib)
  } catch {
    res.status(409).json({ error: 'One of those folders is already used by a library.' })
  }
})

// Add a folder to an existing library.
librariesRouter.post('/:id/folders', async (req, res) => {
  const libraryId = Number(req.params.id)
  const raw = String(req.body?.path ?? '').trim()
  if (!raw) return res.status(400).json({ error: 'path is required' })
  const folderPath = path.resolve(raw)
  if (!fs.existsSync(folderPath)) {
    return res.status(400).json({ error: `Path not found inside the container: ${folderPath}` })
  }
  const lib = await prisma.library.findUnique({ where: { id: libraryId } })
  if (!lib) return res.status(404).json({ error: 'Library not found.' })
  try {
    const folder = await prisma.libraryFolder.create({ data: { libraryId, path: folderPath } })
    res.status(201).json(folder)
  } catch {
    res.status(409).json({ error: 'That folder is already used by a library.' })
  }
})

// Remove a folder (and the media indexed under it).
librariesRouter.delete('/:id/folders/:folderId', async (req, res) => {
  if (isScanning()) {
    return res.status(409).json({ error: 'Cannot change folders while a scan is running.' })
  }
  const libraryId = Number(req.params.id)
  const folderId = Number(req.params.folderId)
  const folder = await prisma.libraryFolder.findUnique({ where: { id: folderId } })
  if (!folder || folder.libraryId !== libraryId) {
    return res.status(404).json({ error: 'Folder not found.' })
  }
  // Drop media indexed under this folder, then the folder itself. Append the
  // separator so "/media/movies" doesn't also match "/media/movies-4k".
  await prisma.mediaItem.deleteMany({
    where: { libraryId, path: { startsWith: folder.path + path.sep } },
  })
  await prisma.libraryFolder.delete({ where: { id: folderId } })
  res.status(204).end()
})

librariesRouter.delete('/:id', async (req, res) => {
  if (isScanning()) {
    return res.status(409).json({ error: 'Cannot delete a library while a scan is running.' })
  }
  const id = Number(req.params.id)
  await prisma.library.delete({ where: { id } }).catch(() => {})
  res.status(204).end()
})
