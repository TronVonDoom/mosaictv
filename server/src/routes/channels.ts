import { Router } from 'express'
import { prisma } from '../db.js'
import { buildPlayout, prunePlayout, resetPlayout } from '../playout.js'
import { sanitizeComingUp } from '../streaming/overlays.js'
import { viewerCount } from '../streaming/channel.js'
import { asOrderSetting } from '../collections.js'
import { programLabel } from '../labels.js'

export const channelsRouter = Router()

const FILLERS = ['none', 'between', 'end']
const asFiller = (v: unknown) => (FILLERS.includes(String(v)) ? String(v) : 'none')
const asStartMode = (v: unknown) => (String(v) === 'hard' ? 'hard' : 'soft')
// A "coming up next" config to store: null/'' clears it (channel = off, block =
// inherit); an object is clamped and stored as JSON.
const asComingUp = (v: unknown): string | null =>
  v == null || v === '' ? null : JSON.stringify(sanitizeComingUp(v))

// Expand a block into intervals on a weekly minute timeline [0, 10080),
// splitting any that cross the week boundary. Handles midnight wrap.
function toIntervals(days: number[], start: number, end: number): [number, number][] {
  const dur = end > start ? end - start : 1440 - start + end
  const res: [number, number][] = []
  for (const d of days) {
    if (Number.isNaN(d)) continue
    const s = (((d * 1440 + start) % 10080) + 10080) % 10080
    const e = s + dur
    if (e <= 10080) res.push([s, e])
    else {
      res.push([s, 10080])
      res.push([0, e - 10080])
    }
  }
  return res
}
function intervalsOverlap(a: [number, number][], b: [number, number][]): boolean {
  for (const [s1, e1] of a) for (const [s2, e2] of b) if (s1 < e2 && s2 < e1) return true
  return false
}

// Label for the program airing right now (mirrors the EPG naming).
function nowLabel(it: { title: string | null; mediaItem: { title: string; showTitle: string | null; season: number | null; episode: number | null; type: string } | null }): string {
  return it.mediaItem ? programLabel(it.mediaItem) : it.title || 'Station break'
}

channelsRouter.get('/', async (_req, res) => {
  const chs = await prisma.channel.findMany({
    orderBy: { number: 'asc' },
    include: { _count: { select: { rotationItems: true, timeBlocks: true, playout: true } } },
  })
  // What's airing right now on each channel (one query for all).
  const now = new Date()
  const airing = await prisma.playoutItem.findMany({
    where: { startTime: { lte: now }, stopTime: { gt: now } },
    include: { mediaItem: { select: { title: true, showTitle: true, season: true, episode: true, type: true } } },
  })
  const nowBy = new Map(airing.map((it) => [it.channelId, it]))
  res.json(
    chs.map((c) => {
      const cur = nowBy.get(c.id)
      return {
        id: c.id,
        number: c.number,
        name: c.name,
        group: c.group,
        logoUrl: c.logoUrl,
        logoId: c.logoId,
        rotationCount: c._count.rotationItems,
        blockCount: c._count.timeBlocks,
        playoutCount: c._count.playout,
        playoutCursor: c.playoutCursor,
        viewers: viewerCount(c.number),
        nowPlaying: cur ? nowLabel(cur) : null,
      }
    }),
  )
})

channelsRouter.post('/', async (req, res) => {
  const { number, name, group, logoId } = req.body ?? {}
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' })
  // Number is optional — a channel with no number is a draft.
  const num = number == null || number === '' ? null : Number(number)
  if (num != null && !Number.isInteger(num)) return res.status(400).json({ error: 'number must be a whole number' })
  try {
    const c = await prisma.channel.create({
      data: {
        number: num,
        name: String(name).trim(),
        group: group || null,
        logoId: logoId != null ? Number(logoId) : null,
      },
    })
    res.status(201).json(c)
  } catch {
    res.status(409).json({ error: 'A channel with that number already exists.' })
  }
})

channelsRouter.get('/:id', async (req, res) => {
  const c = await prisma.channel.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      rotationItems: { orderBy: { order: 'asc' }, include: { collection: true } },
      timeBlocks: { orderBy: { startMinute: 'asc' }, include: { collection: true } },
    },
  })
  if (!c) return res.status(404).json({ error: 'Not found' })
  res.json(c)
})

channelsRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id)
  const { name, group, logoUrl, number, logoId, profileId, comingUp } = req.body ?? {}
  const data: { name?: string; group?: string | null; logoUrl?: string | null; number?: number | null; logoId?: number | null; profileId?: number | null; comingUp?: string | null } = {}
  if (name !== undefined) data.name = String(name).trim()
  if (group !== undefined) data.group = group || null
  if (logoUrl !== undefined) data.logoUrl = logoUrl || null
  if (logoId !== undefined) data.logoId = logoId ? Number(logoId) : null
  if (profileId !== undefined) data.profileId = profileId ? Number(profileId) : null
  if (number !== undefined) data.number = number === null || number === '' ? null : Number(number)
  if (comingUp !== undefined) data.comingUp = asComingUp(comingUp)
  try {
    const c = await prisma.channel.update({ where: { id }, data })
    res.json(c)
  } catch {
    res.status(409).json({ error: 'Update failed — is that channel number already in use?' })
  }
})

channelsRouter.delete('/:id', async (req, res) => {
  await prisma.channel.delete({ where: { id: Number(req.params.id) } }).catch(() => {})
  res.status(204).end()
})

// --- rotation items ---
channelsRouter.post('/:id/rotation', async (req, res) => {
  const channelId = Number(req.params.id)
  const { collectionId, playbackOrder, mode, count } = req.body ?? {}
  if (!collectionId) return res.status(400).json({ error: 'collectionId is required' })
  const max = await prisma.rotationItem.aggregate({ where: { channelId }, _max: { order: true } })
  const item = await prisma.rotationItem.create({
    data: {
      channelId,
      collectionId: Number(collectionId),
      order: (max._max.order ?? -1) + 1,
      playbackOrder: asOrderSetting(playbackOrder),
      mode: mode === 'multiple' ? 'multiple' : 'one',
      count: count ? Math.max(1, Number(count)) : 1,
    },
  })
  res.status(201).json(item)
})

channelsRouter.delete('/:id/rotation/:itemId', async (req, res) => {
  await prisma.rotationItem.delete({ where: { id: Number(req.params.itemId) } }).catch(() => {})
  res.status(204).end()
})

// --- time blocks ---
channelsRouter.post('/:id/blocks', async (req, res) => {
  const channelId = Number(req.params.id)
  const { collectionId, days, startMinute, endMinute, playbackOrder, logoUrl, fillerMode, logoId, startMode, comingUp } = req.body ?? {}
  if (!collectionId || !days || startMinute == null || endMinute == null) {
    return res.status(400).json({ error: 'collectionId, days, startMinute, endMinute are required' })
  }
  if (Number(endMinute) === Number(startMinute)) {
    return res.status(400).json({ error: 'Start and end time cannot be the same.' })
  }
  const newIv = toIntervals(String(days).split(',').map(Number), Number(startMinute), Number(endMinute))
  const siblings = await prisma.timeBlock.findMany({ where: { channelId } })
  for (const s of siblings) {
    if (intervalsOverlap(newIv, toIntervals(s.days.split(',').map(Number), s.startMinute, s.endMinute))) {
      return res.status(409).json({ error: 'That block overlaps an existing time block on this channel.' })
    }
  }
  const b = await prisma.timeBlock.create({
    data: {
      channelId,
      collectionId: Number(collectionId),
      days: String(days),
      startMinute: Number(startMinute),
      endMinute: Number(endMinute),
      playbackOrder: asOrderSetting(playbackOrder),
      logoUrl: logoUrl || null,
      logoId: logoId ? Number(logoId) : null,
      fillerMode: asFiller(fillerMode),
      startMode: asStartMode(startMode),
      comingUp: asComingUp(comingUp),
    },
  })
  res.status(201).json(b)
})

channelsRouter.patch('/:id/blocks/:blockId', async (req, res) => {
  const blockId = Number(req.params.blockId)
  const { collectionId, days, startMinute, endMinute, playbackOrder, logoUrl, fillerMode, logoId, startMode, comingUp } = req.body ?? {}
  const data: {
    collectionId?: number
    days?: string
    startMinute?: number
    endMinute?: number
    playbackOrder?: string
    logoUrl?: string | null
    fillerMode?: string
    logoId?: number | null
    startMode?: string
    comingUp?: string | null
  } = {}
  if (collectionId !== undefined) data.collectionId = Number(collectionId)
  if (days !== undefined) data.days = String(days)
  if (startMinute !== undefined) data.startMinute = Number(startMinute)
  if (endMinute !== undefined) data.endMinute = Number(endMinute)
  if (playbackOrder !== undefined) data.playbackOrder = asOrderSetting(playbackOrder)
  if (logoUrl !== undefined) data.logoUrl = logoUrl || null
  if (logoId !== undefined) data.logoId = logoId ? Number(logoId) : null
  if (fillerMode !== undefined) data.fillerMode = asFiller(fillerMode)
  if (startMode !== undefined) data.startMode = asStartMode(startMode)
  if (comingUp !== undefined) data.comingUp = asComingUp(comingUp)
  if (data.startMinute != null && data.endMinute != null && data.endMinute === data.startMinute) {
    return res.status(400).json({ error: 'Start and end time cannot be the same.' })
  }
  const current = await prisma.timeBlock.findUnique({ where: { id: blockId } })
  if (!current) return res.status(404).json({ error: 'Block not found.' })
  const eDays = (data.days ?? current.days).split(',').map(Number)
  const eStart = data.startMinute ?? current.startMinute
  const eEnd = data.endMinute ?? current.endMinute
  const newIv = toIntervals(eDays, eStart, eEnd)
  const others = await prisma.timeBlock.findMany({
    where: { channelId: current.channelId, id: { not: blockId } },
  })
  for (const s of others) {
    if (intervalsOverlap(newIv, toIntervals(s.days.split(',').map(Number), s.startMinute, s.endMinute))) {
      return res.status(409).json({ error: 'That change would overlap another time block on this channel.' })
    }
  }
  const b = await prisma.timeBlock.update({ where: { id: blockId }, data }).catch(() => null)
  if (!b) return res.status(404).json({ error: 'Block not found.' })
  res.json(b)
})

channelsRouter.delete('/:id/blocks/:blockId', async (req, res) => {
  await prisma.timeBlock.delete({ where: { id: Number(req.params.blockId) } }).catch(() => {})
  res.status(204).end()
})

// --- playout build / reset / read ---
channelsRouter.post('/:id/build', async (req, res) => {
  const channelId = Number(req.params.id)
  const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 48))
  try {
    await prunePlayout(channelId)
    const built = await buildPlayout(channelId, new Date(Date.now() + hours * 3600 * 1000))
    res.json({ built })
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Build failed' })
  }
})

channelsRouter.post('/:id/reset', async (req, res) => {
  const hard = req.query.hard === '1' || req.query.hard === 'true'
  await resetPlayout(Number(req.params.id), hard)
  res.json({ ok: true })
})

channelsRouter.get('/:id/playout', async (req, res) => {
  const channelId = Number(req.params.id)
  const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24))
  const now = new Date()
  const items = await prisma.playoutItem.findMany({
    where: {
      channelId,
      stopTime: { gt: now },
      startTime: { lt: new Date(now.getTime() + hours * 3600 * 1000) },
    },
    orderBy: { startTime: 'asc' },
    include: {
      mediaItem: {
        select: {
          id: true,
          title: true,
          showTitle: true,
          season: true,
          episode: true,
          type: true,
          artist: true,
          durationSec: true,
          posterPath: true,
          tmdbPosterPath: true,
        },
      },
    },
  })
  res.json({ now: now.toISOString(), items })
})
