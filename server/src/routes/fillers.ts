import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { assetsDir } from '../paths.js'
import { runFfmpeg } from '../streaming/run.js'
import {
  DEFAULT_FILLER_KEY,
  FILLER_RESOLUTIONS,
  warmFiller,
  resolveFillerClipById,
  generateDraftStill,
  removeFillerCache,
} from '../streaming/filler.js'

export const fillersRouter = Router()

const STYLES = ['animated', 'frosted', 'spotlight', 'custom', 'logowall', 'pulse', 'retro', 'vintage']
// Clamp an incoming Filler definition payload. (A filler no longer has a
// length: its clip is a seamless loop, and the break's length is the
// schedule's — durationMode/durationSec are left as they were.)
function fillerData(body: Record<string, unknown>) {
  const style = STYLES.includes(String(body?.style)) ? String(body.style) : 'frosted'
  const scale = Number(body?.logoScale)
  return {
    name: body?.name ? String(body.name).trim() : null,
    style,
    assetId: body?.assetId != null && body.assetId !== '' ? Number(body.assetId) : null,
    audioAssetId: body?.audioAssetId != null && body.audioAssetId !== '' ? Number(body.audioAssetId) : null,
    logoId: body?.logoId != null && body.logoId !== '' ? Number(body.logoId) : null,
    resolution: FILLER_RESOLUTIONS.includes(String(body?.resolution)) ? String(body.resolution) : '1080p',
    logoScale: Math.max(0.4, Math.min(2, Number.isFinite(scale) ? scale : 1)),
    divider: body?.divider === true || body?.divider === 'true',
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
  // Its breaks may now fall back to the channel's fillers or an ident.
  warmFiller().catch(() => {})
  res.status(204).end()
})

// POST /api/fillers/preview { …draft } ?channelId= | ?timeBlockId= — render a
// single still frame of a draft (unsaved) filler and stream it back as a JPEG.
// Lets the user see the branded look before committing to a full generation.
// Nothing is persisted: the still is written to scratch, sent, then deleted.
// Declared before "/:id" so "preview" isn't captured as an id.
fillersRouter.post('/preview', async (req, res) => {
  const d = fillerData(req.body ?? {})
  const ctx = ownerFilter(req)
  try {
    const out = await generateDraftStill(
      {
        id: 0,
        style: d.style,
        assetId: d.assetId,
        audioAssetId: d.audioAssetId,
        logoId: d.logoId,
        resolution: d.resolution,
        logoScale: d.logoScale,
        divider: d.divider,
      },
      ctx,
    )
    if (!fs.existsSync(out)) throw new Error('Preview produced no image — check the Logs.')
    res.type('image/jpeg')
    res.sendFile(out, (err) => {
      fs.rm(out, () => {})
      if (err && !res.headersSent) res.status(500).end()
    })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Preview failed' })
  }
})

// ── Library CRUD ──────────────────────────────────────────────────────────

// Where a filler airs: each channel it's the default for, and each block it's
// assigned to (with that block's channel), so an editor can say what an edit
// reaches before it's made.
const USAGE = {
  assignments: {
    orderBy: { id: 'asc' as const },
    select: {
      channel: { select: { id: true, name: true, number: true } },
      timeBlock: {
        select: {
          id: true,
          days: true,
          startMinute: true,
          endMinute: true,
          collection: { select: { name: true } },
          channel: { select: { id: true, name: true, number: true } },
        },
      },
    },
  },
}

type WithUsage = Awaited<ReturnType<typeof listFillers>>[number]
const listFillers = () => prisma.filler.findMany({ orderBy: { createdAt: 'asc' }, include: USAGE })

// A filler row as the API returns it: its columns plus `usedOn`.
function withUsage({ assignments, ...f }: WithUsage) {
  const usedOn = assignments.flatMap((a) => {
    const ch = a.channel ?? a.timeBlock?.channel
    if (!ch) return []
    const b = a.timeBlock
    return [
      {
        channelId: ch.id,
        channelName: ch.name,
        channelNumber: ch.number,
        block: b ? { id: b.id, name: b.collection.name, days: b.days, startMinute: b.startMinute, endMinute: b.endMinute } : null,
      },
    ]
  })
  return { ...f, usedOn }
}

// GET /api/fillers -> the whole global filler library, each with where it airs.
fillersRouter.get('/', async (_req, res) => {
  res.json((await listFillers()).map(withUsage))
})

// POST /api/fillers/:id/copy { channelId } -> a copy of a shared filler that
// only this channel uses: the copy takes over every place the channel (and its
// blocks) used the original, in the same turn order, and the original keeps
// airing everywhere else. For changing a filler here without changing it there.
fillersRouter.post('/:id/copy', async (req, res) => {
  const id = Number(req.params.id)
  const channelId = Number(req.body?.channelId)
  const src = await prisma.filler.findUnique({ where: { id } })
  if (!src || !channelId) return res.status(404).json({ error: 'Filler not found' })
  const here = await prisma.fillerAssignment.findMany({
    where: { fillerId: id, OR: [{ channelId }, { timeBlock: { channelId } }] },
  })
  const copy = await prisma.$transaction(async (tx) => {
    const { id: _id, createdAt: _c, generatedAssetId: _g, channelId: _ch, timeBlockId: _tb, collectionId: _col, ...fields } = src
    const f = await tx.filler.create({ data: { ...fields, name: `${src.name?.trim() || 'Filler'} (copy)` } })
    for (const a of here) await tx.fillerAssignment.update({ where: { id: a.id }, data: { fillerId: f.id } })
    // Not assigned here at all: it airs here as the default station ident. The
    // copy becomes the channel's own filler instead, or it would air nowhere.
    if (here.length === 0) await tx.fillerAssignment.create({ data: { fillerId: f.id, channelId, order: 0 } })
    return f
  })
  warmFiller().catch(() => {})
  res.status(201).json(withUsage((await prisma.filler.findUnique({ where: { id: copy.id }, include: USAGE }))!))
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

// Everything that changes the rendered clip. `name` is only a label, and the
// music is laid over the clip as it airs, so neither throws away a clip that's
// still correct.
const RENDER_FIELDS = ['style', 'assetId', 'logoId', 'resolution', 'logoScale', 'divider'] as const
// …and what the Studio's preview copy carries on top: the music, mixed in so
// the preview sounds like the break.
const PREVIEW_FIELDS = [...RENDER_FIELDS, 'audioAssetId'] as const

type FillerFields = Record<(typeof PREVIEW_FIELDS)[number], unknown>
const changed = (fields: readonly (typeof PREVIEW_FIELDS)[number][], a: FillerFields, b: FillerFields) => fields.some((k) => a[k] !== b[k])

fillersRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const before = await prisma.filler.findUnique({ where: { id } })
  if (!before) return res.status(404).json({ error: 'Filler not found' })

  const data = fillerData(req.body ?? {})
  // A kept preview would silently be the old settings — it claims to show what
  // airs, so an edit has to invalidate it rather than leave it stale. A change
  // to the look also drops the cached renders (one per branding logo, etc.) at
  // once; the pre-build below makes the new ones.
  const restyled = changed(RENDER_FIELDS, before, data)
  const stalePreview = changed(PREVIEW_FIELDS, before, data)
  if (stalePreview) await dropAsset(before.generatedAssetId)
  if (restyled) removeFillerCache(id)

  const f = await prisma.filler
    .update({ where: { id }, data: stalePreview ? { ...data, generatedAssetId: null } : data })
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
  // Also sweep the cached generated clips this filler left in the data dir —
  // the generated Media asset above is only the copy kept for the UI preview.
  removeFillerCache(id)
  await prisma.filler.delete({ where: { id } }).catch(() => {})
  // Deleting the default station ident leaves no default, not a dangling one.
  await prisma.setting.deleteMany({ where: { key: DEFAULT_FILLER_KEY, value: String(id) } })
  // Where it aired, breaks fall back to other fillers or an ident: build those.
  warmFiller().catch(() => {})
  res.status(204).end()
})

// In-memory generation progress, keyed by filler id (polled by the UI).
// Generation outlives the page that started it: the browser is only watching a
// job the server owns, so navigating away — or reloading — must be able to pick
// it back up. Finished jobs linger briefly so a returning page still learns how
// they ended, then age out.
type GenState = { percent: number; done: boolean; error?: string; assetId?: number; startedAt: number; finishedAt?: number }
const genJobs = new Map<number, GenState>()
const GEN_KEEP_MS = 10 * 60_000

function pruneGenJobs(): void {
  const now = Date.now()
  for (const [id, s] of genJobs) {
    if (s.done && now - (s.finishedAt ?? 0) > GEN_KEEP_MS) genJobs.delete(id)
  }
}

/** Generation jobs the server knows about, running or recently finished (for /api/activity). */
export function fillerJobs(): (GenState & { fillerId: number })[] {
  pruneGenJobs()
  return [...genJobs].map(([fillerId, s]) => ({ fillerId, ...s }))
}

// Write the Studio's preview copy of a clip to `dest`: the clip as it airs,
// with the filler's music mixed in over it (on air it's laid over the break
// live, so the clip itself carries only its soft tone).
async function writePreview(clip: string, music: string | undefined, dest: string): Promise<void> {
  const tmp = `${dest}.${process.pid}.tmp.mp4`
  try {
    if (music) {
      await runFfmpeg(
        ['-y', '-i', clip, '-stream_loop', '-1', '-i', music, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', tmp],
        undefined,
        undefined,
        { background: true },
      )
    } else {
      fs.copyFileSync(clip, tmp)
    }
    fs.renameSync(tmp, dest)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

// Save a freshly-built clip as a Media asset (kind "filler"), reusing the
// filler's previous generated asset on regenerate.
async function registerGeneratedAsset(fillerId: number, name: string, clip: string, music: string | undefined, prevAssetId: number | null): Promise<number> {
  let asset = prevAssetId != null ? await prisma.asset.findUnique({ where: { id: prevAssetId } }) : null
  if (asset) {
    const dest = path.join(assetsDir(), asset.filename)
    await writePreview(clip, music, dest)
    await prisma.asset.update({ where: { id: asset.id }, data: { name, sizeBytes: fs.statSync(dest).size } })
    return asset.id
  }
  asset = await prisma.asset.create({ data: { name, kind: 'filler', filename: 'pending', mime: 'video/mp4', sizeBytes: 0 } })
  const filename = `asset-${asset.id}.mp4`
  const dest = path.join(assetsDir(), filename)
  try {
    await writePreview(clip, music, dest)
  } catch (e) {
    await prisma.asset.delete({ where: { id: asset.id } }).catch(() => {})
    throw e
  }
  await prisma.asset.update({ where: { id: asset.id }, data: { filename, sizeBytes: fs.statSync(dest).size } })
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
  const startedAt = Date.now()
  genJobs.set(id, { percent: 0, done: false, startedAt })
  const name = filler.name?.trim() || `${filler.style} filler`
  ;(async () => {
    try {
      const r = await resolveFillerClipById(id, ctx, (pct) => {
        const s = genJobs.get(id)
        if (s) s.percent = pct
      })
      if (!r?.clip || !fs.existsSync(r.clip)) throw new Error('Generation produced no clip — check the Logs.')
      // The filler may have been edited (or deleted) while this built. Saving
      // the old look as its preview would show something that no longer airs.
      const now = await prisma.filler.findUnique({ where: { id } })
      if (!now) throw new Error('The filler was deleted while its preview was building.')
      if (changed(PREVIEW_FIELDS, filler, now)) throw new Error('The filler changed while its preview was building — generate it again to see the new look.')
      const assetId = await registerGeneratedAsset(id, name, r.clip, r.music, now.generatedAssetId)
      genJobs.set(id, { percent: 100, done: true, assetId, startedAt, finishedAt: Date.now() })
    } catch (e) {
      genJobs.set(id, {
        percent: 100,
        done: true,
        error: e instanceof Error ? e.message : 'Generation failed',
        startedAt,
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
