import { Router } from 'express'
import { getTmdbKey, setTmdbKey, validateKey } from '../tmdb.js'
import { loadWatermark, sanitizeWatermark } from '../streaming/overlays.js'
import { prisma } from '../db.js'

export const settingsRouter = Router()

async function setSetting(k: string, v: string | null) {
  if (v == null) await prisma.setting.deleteMany({ where: { key: k } })
  else await prisma.setting.upsert({ where: { key: k }, create: { key: k, value: v }, update: { value: v } })
}

// Filler is configured per channel/block (see /api/fillers); watermark defaults
// live here with per-logo overrides on the Media page.
settingsRouter.get('/', async (_req, res) => {
  const key = await getTmdbKey()
  const modeRow = await prisma.setting.findUnique({ where: { key: 'streamMode' } })
  res.json({
    tmdbConfigured: !!key,
    watermark: await loadWatermark(),
    streamMode: modeRow?.value === 'hls' ? 'hls' : 'mpegts',
  })
})

settingsRouter.post('/watermark', async (req, res) => {
  const wm = sanitizeWatermark(req.body)
  await setSetting('watermark', JSON.stringify(wm))
  res.json({ ok: true, watermark: wm })
})

// Global streaming output mode. 'hls' = shared (one transcode per channel,
// many viewers); 'mpegts' = per-client. Only affects which URL the M3U hands
// out; both endpoints stay live regardless.
settingsRouter.post('/stream-mode', async (req, res) => {
  const mode = req.body?.mode === 'hls' ? 'hls' : 'mpegts'
  await setSetting('streamMode', mode)
  res.json({ ok: true, streamMode: mode })
})

// Validate and save the TMDB API key in one step.
settingsRouter.post('/tmdb', async (req, res) => {
  const apiKey = String(req.body?.apiKey ?? '').trim()
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' })
  const valid = await validateKey(apiKey)
  if (!valid) {
    return res.status(400).json({ error: 'TMDB rejected that key. Double-check it and try again.' })
  }
  await setTmdbKey(apiKey)
  res.json({ ok: true, tmdbConfigured: true })
})
