import { Router } from 'express'
import { prisma } from '../db.js'
import { resolveProfile, DEFAULT_PROFILE } from '../streaming/profile.js'

export const profilesRouter = Router()

// Clamp incoming profile fields to valid ranges/enums (reuses the stream's
// resolver). The editor always sends the full set, so create/update replace all.
function sanitize(body: Record<string, unknown>) {
  return resolveProfile({
    width: Number(body.width),
    height: Number(body.height),
    fps: Number(body.fps),
    quality: String(body.quality),
    hwaccel: String(body.hwaccel),
    audioBitrate: Number(body.audioBitrate),
    preset: body.preset == null ? null : String(body.preset),
    videoBitrateK: Number(body.videoBitrateK),
    videoBufferK: Number(body.videoBufferK),
    scalingMode: body.scalingMode == null ? null : String(body.scalingMode),
    deinterlace: body.deinterlace == null ? null : !!body.deinterlace,
    threads: Number(body.threads),
    audioChannels: Number(body.audioChannels),
    normalizeLoudness: !!body.normalizeLoudness,
    burnSubtitles: body.burnSubtitles == null ? null : !!body.burnSubtitles,
  })
}

profilesRouter.get('/', async (_req, res) => {
  const profiles = await prisma.encodingProfile.findMany({ orderBy: { createdAt: 'asc' } })
  res.json({ profiles, default: DEFAULT_PROFILE })
})

profilesRouter.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'name is required' })
  const created = await prisma.encodingProfile.create({ data: { name, ...sanitize(req.body ?? {}) } })
  res.status(201).json(created)
})

profilesRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const name = String(req.body?.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'name is required' })
  const updated = await prisma.encodingProfile
    .update({ where: { id }, data: { name, ...sanitize(req.body ?? {}) } })
    .catch(() => null)
  if (!updated) return res.status(404).json({ error: 'Profile not found' })
  res.json(updated)
})

profilesRouter.delete('/:id', async (req, res) => {
  // Channels referencing it fall back to the built-in default (FK onDelete: SetNull).
  await prisma.encodingProfile.delete({ where: { id: Number(req.params.id) } }).catch(() => {})
  res.status(204).end()
})
