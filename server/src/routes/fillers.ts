import { Router } from 'express'
import fs from 'node:fs'
import { prisma } from '../db.js'
import { warmFiller, resolveFillerClipById } from '../stream.js'

export const fillersRouter = Router()

// Clamp an incoming Filler payload (owner is set separately on create).
function fillerData(body: Record<string, unknown>) {
  const style = ['animated', 'frosted', 'custom'].includes(String(body?.style)) ? String(body.style) : 'frosted'
  return {
    name: body?.name ? String(body.name).trim() : null,
    style,
    assetId: body?.assetId != null && body.assetId !== '' ? Number(body.assetId) : null,
    audioAssetId: body?.audioAssetId != null && body.audioAssetId !== '' ? Number(body.audioAssetId) : null,
    durationMode: body?.durationMode === 'audio' ? 'audio' : 'fixed',
    durationSec: Math.max(5, Math.min(600, Number(body?.durationSec) || 30)),
  }
}

// GET /api/fillers?channelId=  or  ?timeBlockId=
fillersRouter.get('/', async (req, res) => {
  const channelId = req.query.channelId != null ? Number(req.query.channelId) : undefined
  const timeBlockId = req.query.timeBlockId != null ? Number(req.query.timeBlockId) : undefined
  const where = channelId != null ? { channelId } : timeBlockId != null ? { timeBlockId } : { id: -1 }
  res.json(await prisma.filler.findMany({ where, orderBy: { order: 'asc' } }))
})

// POST /api/fillers  { channelId? | timeBlockId?, ...filler fields }
fillersRouter.post('/', async (req, res) => {
  const channelId = req.body?.channelId != null ? Number(req.body.channelId) : null
  const timeBlockId = req.body?.timeBlockId != null ? Number(req.body.timeBlockId) : null
  if (channelId == null && timeBlockId == null) {
    return res.status(400).json({ error: 'channelId or timeBlockId is required' })
  }
  const max = await prisma.filler.aggregate({
    where: channelId != null ? { channelId } : { timeBlockId },
    _max: { order: true },
  })
  const f = await prisma.filler.create({
    data: { channelId, timeBlockId, ...fillerData(req.body ?? {}), order: (max._max.order ?? -1) + 1 },
  })
  warmFiller().catch(() => {}) // pre-generate in the background
  res.status(201).json(f)
})

fillersRouter.patch('/:id', async (req, res) => {
  const f = await prisma.filler.update({ where: { id: Number(req.params.id) }, data: fillerData(req.body ?? {}) }).catch(() => null)
  if (!f) return res.status(404).json({ error: 'Filler not found' })
  warmFiller().catch(() => {})
  res.json(f)
})

fillersRouter.delete('/:id', async (req, res) => {
  await prisma.filler.delete({ where: { id: Number(req.params.id) } }).catch(() => {})
  res.status(204).end()
})

// GET /api/fillers/:id/clip — build (if needed) and stream the branded clip so
// the UI can preview exactly what will play.
fillersRouter.get('/:id/clip', async (req, res) => {
  const r = await resolveFillerClipById(Number(req.params.id)).catch(() => null)
  if (!r?.clip || !fs.existsSync(r.clip)) return res.status(404).json({ error: 'Could not generate the preview clip.' })
  res.type('video/mp4')
  res.setHeader('Cache-Control', 'no-store')
  res.sendFile(r.clip)
})
