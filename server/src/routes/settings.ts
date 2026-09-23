import { Router } from 'express'
import { getTmdbKey, setTmdbKey, validateKey } from '../tmdb.js'
import { loadWatermark, sanitizeWatermark } from '../streaming/overlays.js'
import { prisma } from '../db.js'
import { DEFAULT_FILLER_KEY, loadDefaultFiller, warmFiller } from '../streaming/filler.js'
import { MAX_HORIZON_HOURS, MIN_HORIZON_HOURS, horizonHours } from '../playout.js'
import { NO_AUDIO_PREFERENCE, globalAudioLanguage } from '../audio.js'
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
    playoutHorizonHours: await horizonHours(),
    audioLanguage: await globalAudioLanguage(),
    defaultFillerId: (await loadDefaultFiller())?.id ?? null,
  })
})

// The default station ident: the filler a channel with none of its own airs in
// its breaks and in any slot the stream holds. null clears it (back to the
// frosted-glass ident built from each channel's logo).
settingsRouter.post('/default-filler', async (req, res) => {
  const raw = req.body?.fillerId
  if (raw == null) {
    await setSetting(DEFAULT_FILLER_KEY, null)
    return res.json({ ok: true, defaultFillerId: null })
  }
  const filler = await prisma.filler.findUnique({ where: { id: Number(raw) } })
  if (!filler) return res.status(404).json({ error: 'Filler not found' })
  await setSetting(DEFAULT_FILLER_KEY, String(filler.id))
  // Build it for every channel that will fall back to it, off the request.
  warmFiller().catch(() => {})
  res.json({ ok: true, defaultFillerId: filler.id })
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

// How far ahead every channel builds its timeline. This is also the depth of
// the published XMLTV guide, since the guide only shows what has been built.
settingsRouter.post('/playout-horizon', async (req, res) => {
  const n = Number(req.body?.playoutHorizonHours)
  if (!Number.isFinite(n) || n < MIN_HORIZON_HOURS || n > MAX_HORIZON_HOURS) {
    return res.status(400).json({
      error: `playoutHorizonHours must be a number between ${MIN_HORIZON_HOURS} and ${MAX_HORIZON_HOURS}`,
    })
  }
  const hours = Math.round(n)
  await setSetting('playoutHorizonHours', String(hours))
  res.json({ ok: true, playoutHorizonHours: hours })
})

// Which audio track channels air when a file carries more than one: an ISO 639
// language tag, or 'first' to keep whatever order the file lists.
settingsRouter.post('/audio-language', async (req, res) => {
  const raw = String(req.body?.audioLanguage ?? '').trim().toLowerCase()
  if (!raw) return res.status(400).json({ error: 'audioLanguage is required' })
  if (raw !== NO_AUDIO_PREFERENCE && !/^[a-z]{2,3}$/.test(raw)) {
    return res.status(400).json({ error: "audioLanguage must be a 2- or 3-letter language code, or 'first'" })
  }
  await setSetting('audioLanguage', raw)
  res.json({ ok: true, audioLanguage: raw })
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
