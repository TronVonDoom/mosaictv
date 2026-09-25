import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { logosDir } from '../paths.js'
import { parseWatermark, sanitizeWatermark } from '../streaming/overlays.js'
import { warmFiller } from '../streaming/filler.js'

export const logosRouter = Router()

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

logosRouter.get('/', async (_req, res) => {
  const logos = await prisma.logo.findMany({ orderBy: { createdAt: 'desc' } })
  res.json(
    logos.map((l) => ({
      id: l.id,
      name: l.name,
      mime: l.mime,
      updatedAt: l.updatedAt,
      watermark: parseWatermark(l.watermark),
    })),
  )
})

// Upload via a data URL (no multipart dependency needed).
// Decode an uploaded data URL into the bytes to store, or the reason not to.
type Decoded = { mime: string; ext: string; buf: Buffer }
function decodeImage(dataUrl: string): Decoded | { error: string } {
  const m = String(dataUrl ?? '').match(/^data:(image\/[a-z+]+);base64,(.+)$/i)
  if (!m) return { error: 'an image file is required' }
  const mime = m[1].toLowerCase()
  const ext = EXT[mime]
  if (!ext) return { error: 'Unsupported image type (use PNG, JPG, WEBP, or GIF).' }
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > 5 * 1024 * 1024) return { error: 'Image too large (max 5 MB).' }
  return { mime, ext, buf }
}

logosRouter.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const decoded = decodeImage(req.body?.dataUrl)
  if (!name) return res.status(400).json({ error: 'name and an image file are required' })
  if ('error' in decoded) return res.status(400).json({ error: decoded.error })
  const { mime, ext, buf } = decoded

  const logo = await prisma.logo.create({ data: { name, filename: 'pending', mime } })
  const filename = `logo-${logo.id}.${ext}`
  fs.writeFileSync(path.join(logosDir(), filename), buf)
  await prisma.logo.update({ where: { id: logo.id }, data: { filename } })
  res.status(201).json({ id: logo.id, name, mime, updatedAt: logo.updatedAt, watermark: parseWatermark(logo.watermark) })
})

// Update a logo's name and/or its per-logo watermark settings.
logosRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const existing = await prisma.logo.findUnique({ where: { id } })
  if (!existing) return res.status(404).json({ error: 'Logo not found' })
  const data: { name?: string; watermark?: string } = {}
  if (typeof req.body?.name === 'string' && req.body.name.trim()) data.name = req.body.name.trim()
  if (req.body?.watermark !== undefined) data.watermark = JSON.stringify(sanitizeWatermark(req.body.watermark))
  const updated = await prisma.logo.update({ where: { id }, data })
  res.json({ id: updated.id, name: updated.name, mime: updated.mime, updatedAt: updated.updatedAt, watermark: parseWatermark(updated.watermark) })
})

logosRouter.get('/:id/image', async (req, res) => {
  const logo = await prisma.logo.findUnique({ where: { id: Number(req.params.id) } })
  if (!logo) return res.status(404).end()
  const file = path.join(logosDir(), logo.filename)
  if (!fs.existsSync(file)) return res.status(404).end()
  // Short cache so a swapped logo shows up promptly (was 24h, which made the
  // guide/UI appear "stuck" on the old image).
  res.setHeader('Cache-Control', 'public, max-age=60')
  res.type(logo.mime)
  res.sendFile(file)
})

// Swap a logo's image while keeping its id, name and watermark settings — and
// so every channel, block and collection that points at it. The old file is
// removed; replacing a PNG with a WEBP changes the stored filename, which is
// why the old name is captured before the update rather than derived after.
logosRouter.put('/:id/image', async (req, res) => {
  const id = Number(req.params.id)
  const existing = await prisma.logo.findUnique({ where: { id } })
  if (!existing) return res.status(404).json({ error: 'Logo not found' })
  const decoded = decodeImage(req.body?.dataUrl)
  if ('error' in decoded) return res.status(400).json({ error: decoded.error })
  const { mime, ext, buf } = decoded

  const previous = existing.filename
  const filename = `logo-${id}.${ext}`
  fs.writeFileSync(path.join(logosDir(), filename), buf)
  if (previous && previous !== filename) fs.rm(path.join(logosDir(), previous), () => {})
  const updated = await prisma.logo.update({ where: { id }, data: { filename, mime } })
  // Every filler branded with it needs rebuilding with the new image.
  warmFiller().catch(() => {})
  res.json({
    id: updated.id,
    name: updated.name,
    mime: updated.mime,
    updatedAt: updated.updatedAt,
    watermark: parseWatermark(updated.watermark),
  })
})

logosRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const logo = await prisma.logo.findUnique({ where: { id } })
  if (logo) {
    const file = path.join(logosDir(), logo.filename)
    fs.rm(file, () => {})
    await prisma.logo.delete({ where: { id } }).catch(() => {})
    warmFiller().catch(() => {})
  }
  res.status(204).end()
})
