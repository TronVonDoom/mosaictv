import { Router } from 'express'
import { getTmdbKey, setTmdbKey, validateKey } from '../tmdb.js'
import { loadWatermark, sanitizeWatermark } from '../streaming/overlays.js'
import { prisma } from '../db.js'
import {
  MAX_FRIENDLY_NAME,
  MAX_TUNER_COUNT,
  MIN_TUNER_COUNT,
  deviceId,
  friendlyName,
  tunerCount,
} from '../tuner.js'

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
    tunerCount: await tunerCount(),
    // Read-only in the UI, but surfaced so you can tell which device Plex is
    // talking to. Reading it mints the ID if this instance has never served a
    // tuner request, so it's visible before Plex ever connects.
    hdhrDeviceId: await deviceId(),
    hdhrFriendlyName: await friendlyName(),
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

// How many concurrent streams the emulated HDHomeRun tuner advertises to
// Plex/Emby — one tuner slot = one concurrent Live TV stream from their side.
settingsRouter.post('/tuner-count', async (req, res) => {
  const n = Number(req.body?.tunerCount)
  if (!Number.isFinite(n) || n < MIN_TUNER_COUNT || n > MAX_TUNER_COUNT) {
    return res
      .status(400)
      .json({ error: `tunerCount must be a number between ${MIN_TUNER_COUNT} and ${MAX_TUNER_COUNT}` })
  }
  const count = Math.round(n)
  await setSetting('tunerCount', String(count))
  res.json({ ok: true, tunerCount: count })
})

// The name Plex lists the tuner under. Safe to change at any time — Plex keys
// the device on its ID, not this — though it may keep showing the old name
// until the DVR entry is re-added.
settingsRouter.post('/tuner-name', async (req, res) => {
  const name = String(req.body?.friendlyName ?? '').trim()
  if (!name) return res.status(400).json({ error: 'friendlyName is required' })
  if (name.length > MAX_FRIENDLY_NAME) {
    return res.status(400).json({ error: `friendlyName must be ${MAX_FRIENDLY_NAME} characters or fewer` })
  }
  await setSetting('hdhrFriendlyName', name)
  res.json({ ok: true, hdhrFriendlyName: name })
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
