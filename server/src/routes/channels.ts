import { Router } from 'express'
import { prisma } from '../db.js'
import { buildPlayout, prunePlayout, resetPlayout } from '../playout.js'

export const channelsRouter = Router()

const ORDERS = ['chronological', 'shuffle', 'rotate']
const asOrder = (v: unknown) => (ORDERS.includes(String(v)) ? String(v) : 'chronological')

channelsRouter.get('/', async (_req, res) => {
  const chs = await prisma.channel.findMany({
    orderBy: { number: 'asc' },
    include: { _count: { select: { rotationItems: true, timeBlocks: true, playout: true } } },
  })
  res.json(
    chs.map((c) => ({
      id: c.id,
      number: c.number,
      name: c.name,
      group: c.group,
      logoUrl: c.logoUrl,
      rotationCount: c._count.rotationItems,
      blockCount: c._count.timeBlocks,
      playoutCount: c._count.playout,
      playoutCursor: c.playoutCursor,
    })),
  )
})

channelsRouter.post('/', async (req, res) => {
  const { number, name, group } = req.body ?? {}
  if (number == null || !name) return res.status(400).json({ error: 'number and name are required' })
  try {
    const c = await prisma.channel.create({
      data: { number: Number(number), name: String(name).trim(), group: group || null },
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
  const { name, group, logoUrl, number } = req.body ?? {}
  const data: { name?: string; group?: string | null; logoUrl?: string | null; number?: number } = {}
  if (name !== undefined) data.name = String(name).trim()
  if (group !== undefined) data.group = group || null
  if (logoUrl !== undefined) data.logoUrl = logoUrl || null
  if (number !== undefined) data.number = Number(number)
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
      playbackOrder: asOrder(playbackOrder),
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
  const { collectionId, days, startMinute, endMinute, playbackOrder, logoUrl } = req.body ?? {}
  if (!collectionId || !days || startMinute == null || endMinute == null) {
    return res.status(400).json({ error: 'collectionId, days, startMinute, endMinute are required' })
  }
  if (Number(endMinute) === Number(startMinute)) {
    return res.status(400).json({ error: 'Start and end time cannot be the same.' })
  }
  const b = await prisma.timeBlock.create({
    data: {
      channelId,
      collectionId: Number(collectionId),
      days: String(days),
      startMinute: Number(startMinute),
      endMinute: Number(endMinute),
      playbackOrder: asOrder(playbackOrder),
      logoUrl: logoUrl || null,
    },
  })
  res.status(201).json(b)
})

channelsRouter.patch('/:id/blocks/:blockId', async (req, res) => {
  const blockId = Number(req.params.blockId)
  const { collectionId, days, startMinute, endMinute, playbackOrder, logoUrl } = req.body ?? {}
  const data: {
    collectionId?: number
    days?: string
    startMinute?: number
    endMinute?: number
    playbackOrder?: string
    logoUrl?: string | null
  } = {}
  if (collectionId !== undefined) data.collectionId = Number(collectionId)
  if (days !== undefined) data.days = String(days)
  if (startMinute !== undefined) data.startMinute = Number(startMinute)
  if (endMinute !== undefined) data.endMinute = Number(endMinute)
  if (playbackOrder !== undefined) data.playbackOrder = asOrder(playbackOrder)
  if (logoUrl !== undefined) data.logoUrl = logoUrl || null
  if (data.startMinute != null && data.endMinute != null && data.endMinute === data.startMinute) {
    return res.status(400).json({ error: 'Start and end time cannot be the same.' })
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
  await resetPlayout(Number(req.params.id))
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
          durationSec: true,
          posterPath: true,
          tmdbPosterPath: true,
        },
      },
    },
  })
  res.json({ now: now.toISOString(), items })
})
