import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { assetsDir } from '../paths.js'
import { warmFiller, resolveFillerClipById } from '../streaming/filler.js'

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

// Drop an asset (file + row).
async function dropAsset(assetId: number | null): Promise<void> {
  if (assetId == null) return
  const a = await prisma.asset.findUnique({ where: { id: assetId } })
  if (!a) return
  fs.rm(path.join(assetsDir(), a.filename), () => {})
  await prisma.asset.delete({ where: { id: a.id } }).catch(() => {})
}

// Everything that changes how the clip renders. `name` is only a label, so
// renaming a filler shouldn't throw away a clip that's still correct.
const RENDER_FIELDS = ['style', 'assetId', 'audioAssetId', 'durationMode', 'durationSec'] as const

fillersRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const before = await prisma.filler.findUnique({ where: { id } })
  if (!before) return res.status(404).json({ error: 'Filler not found' })

  const data = fillerData(req.body ?? {})
  // A kept clip would silently be the old settings — Preview claimed to show
  // what airs, so an edit has to invalidate it rather than leave it stale.
  const restyled = RENDER_FIELDS.some((k) => before[k] !== data[k])
  if (restyled) await dropAsset(before.generatedAssetId)

  const f = await prisma.filler
    .update({ where: { id }, data: restyled ? { ...data, generatedAssetId: null } : data })
    .catch(() => null)
  if (!f) return res.status(404).json({ error: 'Filler not found' })
  warmFiller().catch(() => {})
  res.json(f)
})

// Delete a filler from the library entirely. Cascade removes its assignments
// (channels/blocks fall back to the default frosted-glass ident in those gaps),
// and we delete its derived generated clip.
//
// A custom filler's source clip goes too: uploading a clip and creating the
// filler are now one action, so leaving the file behind would strand it in the
// library with nothing pointing at it. Shared sources (another filler still
// uses the same clip) survive, as does anything kept with `?keepSource=1`.
fillersRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const filler = await prisma.filler.findUnique({ where: { id } })
  await dropAsset(filler?.generatedAssetId ?? null)
  if (filler?.assetId != null && req.query.keepSource !== '1') {
    const shared = await prisma.filler.count({ where: { assetId: filler.assetId, id: { not: id } } })
    if (shared === 0) await dropAsset(filler.assetId)
  }
  await prisma.filler.delete({ where: { id } }).catch(() => {})
  res.status(204).end()
})

// In-memory generation progress, keyed by filler id (polled by the UI).
// Generation outlives the page that started it: the browser is only watching a
// job the server owns, so navigating away — or reloading — must be able to pick
// it back up. Finished jobs linger briefly so a returning page still learns how
// they ended, then age out.
type GenState = { percent: number; done: boolean; error?: string; assetId?: number; finishedAt?: number }
const genJobs = new Map<number, GenState>()
const GEN_KEEP_MS = 10 * 60_000

function pruneGenJobs(): void {
  const now = Date.now()
  for (const [id, s] of genJobs) {
    if (s.done && now - (s.finishedAt ?? 0) > GEN_KEEP_MS) genJobs.delete(id)
  }
}

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
// `?channelId=` / `?timeBlockId=` brand the preview with that owner's logo;
// without one it falls back to wherever the filler is first assigned.
fillersRouter.post('/:id/generate', async (req, res) => {
  const id = Number(req.params.id)
  const filler = await prisma.filler.findUnique({ where: { id } })
  if (!filler) return res.status(404).json({ error: 'Filler not found' })
  if (genJobs.get(id)?.done === false) return res.json({ started: true }) // already running

  const ctx = ownerFilter(req)
  genJobs.set(id, { percent: 0, done: false })
  const name = filler.name?.trim() || `${filler.style} filler`
  ;(async () => {
    try {
      const r = await resolveFillerClipById(id, ctx, (pct) => {
        const s = genJobs.get(id)
        if (s) s.percent = pct
      })
      if (!r?.clip || !fs.existsSync(r.clip)) throw new Error('Generation produced no clip — check the Logs.')
      const assetId = await registerGeneratedAsset(id, name, r.clip, filler.generatedAssetId)
      genJobs.set(id, { percent: 100, done: true, assetId, finishedAt: Date.now() })
    } catch (e) {
      genJobs.set(id, {
        percent: 100,
        done: true,
        error: e instanceof Error ? e.message : 'Generation failed',
        finishedAt: Date.now(),
      })
    }
  })()
  res.status(202).json({ started: true })
})

// GET /api/fillers/:id/generate/status — poll one job's progress.
fillersRouter.get('/:id/generate/status', (req, res) => {
  const s = genJobs.get(Number(req.params.id))
  res.json(s ?? { idle: true })
})

// GET /api/fillers/generating — every job the server knows about, so a page
// that was closed mid-generation (or never opened) can show what's running
// instead of implying it stopped. Declared last but matched before "/:id/…"
// only because no GET "/:id" route exists; keep it that way.
fillersRouter.get('/generating', (_req, res) => {
  pruneGenJobs()
  res.json(
    [...genJobs].map(([fillerId, s]) => ({
      fillerId,
      percent: s.percent,
      done: s.done,
      error: s.error ?? null,
    })),
  )
})
