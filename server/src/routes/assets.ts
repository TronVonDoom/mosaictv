import express, { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { assetsDir } from '../paths.js'

export const assetsRouter = Router()

const KINDS = ['audio', 'filler'] as const
type Kind = (typeof KINDS)[number]

// Pick a file extension from the MIME type (best-effort).
function extFor(mime: string): string {
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/flac': 'flac',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
    'video/quicktime': 'mov',
  }
  return map[mime.toLowerCase()] || (mime.startsWith('audio/') ? 'audio' : 'mp4')
}

function shape(a: { id: number; name: string; kind: string; mime: string; sizeBytes: number | null; createdAt: Date }) {
  return { id: a.id, name: a.name, kind: a.kind, mime: a.mime, sizeBytes: a.sizeBytes, createdAt: a.createdAt }
}

// Which asset ids are the output of a Filler rather than a user upload.
async function generatedAssetIds(): Promise<Set<number>> {
  const rows = await prisma.filler.findMany({
    where: { generatedAssetId: { not: null } },
    select: { generatedAssetId: true },
  })
  return new Set(rows.map((r) => r.generatedAssetId as number))
}

assetsRouter.get('/', async (req, res) => {
  const kind = req.query.kind as string | undefined
  const where = kind && KINDS.includes(kind as Kind) ? { kind } : {}
  const assets = await prisma.asset.findMany({ where, orderBy: { createdAt: 'desc' } })
  // Generated clips live alongside uploads under the same "filler" kind; flag
  // them so the UI can badge them and keep them out of the custom-clip picker
  // (choosing one there would nest a generated filler inside another filler).
  const generated = await generatedAssetIds()
  res.json(assets.map((a) => ({ ...shape(a), generated: generated.has(a.id) })))
})

// Raw-body upload so large audio/video files aren't capped by the JSON limit.
// POST /api/assets?kind=audio&name=Ambient  (Content-Type: the file's mime)
assetsRouter.post('/', express.raw({ type: () => true, limit: '500mb' }), async (req, res) => {
  const kind = String(req.query.kind ?? '')
  const name = String(req.query.name ?? '').trim()
  const mime = String(req.headers['content-type'] ?? 'application/octet-stream')
  if (!KINDS.includes(kind as Kind)) return res.status(400).json({ error: 'kind must be audio or filler' })
  if (!name) return res.status(400).json({ error: 'name is required' })
  const buf = req.body as Buffer
  if (!Buffer.isBuffer(buf) || buf.length === 0) return res.status(400).json({ error: 'empty upload' })

  const expectAudio = kind === 'audio'
  if (expectAudio ? !mime.startsWith('audio/') : !mime.startsWith('video/')) {
    return res.status(400).json({ error: `Expected ${expectAudio ? 'an audio' : 'a video'} file, got ${mime}` })
  }

  const asset = await prisma.asset.create({ data: { name, kind, filename: 'pending', mime, sizeBytes: buf.length } })
  const filename = `asset-${asset.id}.${extFor(mime)}`
  fs.writeFileSync(path.join(assetsDir(), filename), buf)
  const updated = await prisma.asset.update({ where: { id: asset.id }, data: { filename } })
  res.status(201).json(shape(updated))
})

assetsRouter.get('/:id/file', async (req, res) => {
  const asset = await prisma.asset.findUnique({ where: { id: Number(req.params.id) } })
  if (!asset) return res.status(404).end()
  const file = path.join(assetsDir(), asset.filename)
  if (!fs.existsSync(file)) return res.status(404).end()
  res.type(asset.mime)
  res.sendFile(file)
})

assetsRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const asset = await prisma.asset.findUnique({ where: { id } })
  if (asset) {
    fs.rm(path.join(assetsDir(), asset.filename), () => {})
    // Clear the back-reference first: a filler pointing at a deleted asset
    // would offer a Preview with nothing behind it.
    await prisma.filler.updateMany({ where: { generatedAssetId: id }, data: { generatedAssetId: null } })
    await prisma.asset.delete({ where: { id } }).catch(() => {})
  }
  res.status(204).end()
})
