import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { assetsDir } from '../paths.js'
import { warmFiller, resolveFillerClipById } from '../stream.js'

export const fillersRouter = Router()

// Clamp an incoming Filler definition payload.
function fillerData(body: Record<string, unknown>) {
  const style = ['animated', 'frosted', 'custom', 'logowall', 'pulse', 'retro', 'vintage'].includes(String(body?.style)) ? String(body.style) : 'frosted'
  return {
    name: body?.name ? String(body.name).trim() : null,
    style,
    assetId: body?.assetId != null && body.assetId !== '' ? Number(body.assetId) : null,
    audioAssetId: body?.audioAssetId != null && body.audioAssetId !== '' ? Number(body.audioAssetId) : null,
    durationMode: body?.durationMode === 'audio' ? 'audio' : 'fixed',
    durationSec: Math.max(5, Math.min(600, Number(body?.durationSec) || 30)),
  }
}

// ── Assignments ───────────────────────────────────────────────────────────
// A filler is a global library item; these routes assign it to a channel (its
// default gap filler) or a time block. Declared before the "/:id" routes so
// "/assignments" isn't captured as an id.

function ownerFilter(req: { query: Record<string, unknown>; body?: Record<string, unknown> }) {
  const src = { ...req.query, ...(req.body ?? {}) }
  const channelId = src.channelId != null && src.channelId !== '' ? Number(src.channelId) : null
  const timeBlockId = src.timeBlockId != null && src.timeBlockId !== '' ? Number(src.timeBlockId) : null
  return { channelId, timeBlockId }
}

// GET /api/fillers/assignments?channelId= | ?timeBlockId= -> assigned filler ids
fillersRouter.get('/assignments', async (req, res) => {
  const { channelId, timeBlockId } = ownerFilter(req)
  if (channelId == null && timeBlockId == null) return res.json([])
  const rows = await prisma.fillerAssignment.findMany({
    where: channelId != null ? { channelId } : { timeBlockId },
    orderBy: { order: 'asc' },
  })
  res.json(rows.map((r) => r.fillerId))
})

// POST /api/fillers/assignments { fillerId, channelId? | timeBlockId? }
fillersRouter.post('/assignments', async (req, res) => {
  const fillerId = Number(req.body?.fillerId)
  const { channelId, timeBlockId } = ownerFilter(req)
  if (!fillerId || (channelId == null && timeBlockId == null)) {
    return res.status(400).json({ error: 'fillerId and channelId or timeBlockId are required' })
  }
  const max = await prisma.fillerAssignment.aggregate({
    where: channelId != null ? { channelId } : { timeBlockId },
    _max: { order: true },
  })
  const where =
    channelId != null
      ? { fillerId_channelId: { fillerId, channelId } }
      : { fillerId_timeBlockId: { fillerId, timeBlockId: timeBlockId! } }
  await prisma.fillerAssignment.upsert({
    where,
    create: { fillerId, channelId, timeBlockId, order: (max._max.order ?? -1) + 1 },
    update: {},
  })
  warmFiller().catch(() => {})
  res.status(201).json({ ok: true })
})

// DELETE /api/fillers/assignments { fillerId, channelId? | timeBlockId? }
fillersRouter.delete('/assignments', async (req, res) => {
  const fillerId = Number(req.body?.fillerId)
  const { channelId, timeBlockId } = ownerFilter(req)
  if (!fillerId) return res.status(400).json({ error: 'fillerId is required' })
  await prisma.fillerAssignment.deleteMany({
    where: { fillerId, ...(channelId != null ? { channelId } : { timeBlockId }) },
  })
  res.status(204).end()
})

// ── Library CRUD ──────────────────────────────────────────────────────────

// GET /api/fillers -> the whole global filler library.
fillersRouter.get('/', async (_req, res) => {
  res.json(await prisma.filler.findMany({ orderBy: { createdAt: 'asc' } }))
})

// POST /api/fillers -> create a global filler definition.
fillersRouter.post('/', async (req, res) => {
  const f = await prisma.filler.create({ data: fillerData(req.body ?? {}) })
  res.status(201).json(f)
})

fillersRouter.patch('/:id', async (req, res) => {
  const f = await prisma.filler.update({ where: { id: Number(req.params.id) }, data: fillerData(req.body ?? {}) }).catch(() => null)
  if (!f) return res.status(404).json({ error: 'Filler not found' })
  warmFiller().catch(() => {})
  res.json(f)
})

// Delete a filler from the library entirely. Cascade removes its assignments
// (channels/blocks fall back to the default frosted-glass ident in those gaps)
// and we also delete its derived generated clip asset. A user-uploaded custom
// source asset is left alone — it lives independently in Media.
fillersRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const filler = await prisma.filler.findUnique({ where: { id } })
  if (filler?.generatedAssetId != null) {
    const a = await prisma.asset.findUnique({ where: { id: filler.generatedAssetId } })
    if (a) {
      fs.rm(path.join(assetsDir(), a.filename), () => {})
      await prisma.asset.delete({ where: { id: a.id } }).catch(() => {})
    }
  }
  await prisma.filler.delete({ where: { id } }).catch(() => {})
  res.status(204).end()
})

// In-memory generation progress, keyed by filler id (polled by the UI).
type GenState = { percent: number; done: boolean; error?: string; assetId?: number }
const genJobs = new Map<number, GenState>()

// Save a freshly-built clip as a Media asset (kind "filler"), reusing the
// filler's previous generated asset on regenerate.
async function registerGeneratedAsset(fillerId: number, name: string, clip: string, prevAssetId: number | null): Promise<number> {
  const size = fs.statSync(clip).size
  let asset = prevAssetId != null ? await prisma.asset.findUnique({ where: { id: prevAssetId } }) : null
  if (asset) {
    fs.copyFileSync(clip, path.join(assetsDir(), asset.filename))
    await prisma.asset.update({ where: { id: asset.id }, data: { name, sizeBytes: size } })
    return asset.id
  }
  asset = await prisma.asset.create({ data: { name, kind: 'filler', filename: 'pending', mime: 'video/mp4', sizeBytes: size } })
  const filename = `asset-${asset.id}.mp4`
  fs.copyFileSync(clip, path.join(assetsDir(), filename))
  await prisma.asset.update({ where: { id: asset.id }, data: { filename } })
  await prisma.filler.update({ where: { id: fillerId }, data: { generatedAssetId: asset.id } })
  return asset.id
}

// POST /api/fillers/:id/generate — kick off generation in the background (so the
// request returns immediately) and track progress. Poll the status endpoint.
fillersRouter.post('/:id/generate', async (req, res) => {
  const id = Number(req.params.id)
  const filler = await prisma.filler.findUnique({ where: { id } })
  if (!filler) return res.status(404).json({ error: 'Filler not found' })
  if (genJobs.get(id)?.done === false) return res.json({ started: true }) // already running

  genJobs.set(id, { percent: 0, done: false })
  const name = filler.name?.trim() || `${filler.style} filler`
  ;(async () => {
    try {
      const r = await resolveFillerClipById(id, (pct) => {
        const s = genJobs.get(id)
        if (s) s.percent = pct
      })
      if (!r?.clip || !fs.existsSync(r.clip)) throw new Error('Generation produced no clip — check the Logs.')
      const assetId = await registerGeneratedAsset(id, name, r.clip, filler.generatedAssetId)
      genJobs.set(id, { percent: 100, done: true, assetId })
    } catch (e) {
      genJobs.set(id, { percent: 100, done: true, error: e instanceof Error ? e.message : 'Generation failed' })
    }
  })()
  res.status(202).json({ started: true })
})

// GET /api/fillers/:id/generate/status — poll generation progress.
fillersRouter.get('/:id/generate/status', (req, res) => {
  const s = genJobs.get(Number(req.params.id))
  res.json(s ?? { idle: true })
})
