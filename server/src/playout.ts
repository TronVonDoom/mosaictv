import type { Collection, MediaItem, TimeBlock } from '@prisma/client'
import { prisma } from './db.js'
import { resolveCollection, type PlaybackOrder } from './collections.js'

const MAX_ITERATIONS = 50000

type BlockWithCollection = TimeBlock & { collection: Collection }
type State = { rotationIndex: number; positions: Record<string, number> }

function truncateToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60000) * 60000)
}

/** The time block (if any) active at the given local date/time. First match wins. */
function activeBlock(blocks: BlockWithCollection[], date: Date): BlockWithCollection | null {
  const day = date.getDay()
  const tod = date.getHours() * 60 + date.getMinutes()
  for (const b of blocks) {
    const days = b.days.split(',').map((s) => Number(s.trim()))
    if (days.includes(day) && tod >= b.startMinute && tod < b.endMinute) return b
  }
  return null
}

/** Jump the cursor to the end of the block window active at `cursor` (same day). */
function skipToBlockEnd(cursor: Date, block: TimeBlock): Date {
  const end = new Date(cursor)
  end.setHours(Math.floor(block.endMinute / 60), block.endMinute % 60, 0, 0)
  if (end <= cursor) end.setDate(end.getDate() + 1)
  return end
}

/**
 * Build (extend) a channel's playout timeline up to `until`. Rotation fills the
 * timeline 24/7; an active time block overrides it. Programs play fully, so
 * block boundaries are honored at program ends (soft dayparting). State persists
 * so shows continue in order across loops and days.
 */
export async function buildPlayout(channelId: number, until: Date): Promise<number> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      rotationItems: {
        orderBy: { order: 'asc' },
        include: { collection: { include: { items: true } } },
      },
      timeBlocks: { include: { collection: { include: { items: true } } } },
    },
  })
  if (!channel) throw new Error(`Channel ${channelId} not found`)

  const anchor = channel.playoutAnchor ?? truncateToMinute(new Date())
  let cursor = channel.playoutCursor ?? anchor
  if (cursor >= until) return 0

  const state: State = channel.playoutState
    ? (JSON.parse(channel.playoutState) as State)
    : { rotationIndex: 0, positions: {} }

  // Cache resolved collection lists for this build pass.
  const cache = new Map<string, MediaItem[]>()
  const listFor = async (key: string, filter: unknown, order: string): Promise<MediaItem[]> => {
    if (!cache.has(key)) {
      const seed = channelId * 100000 + (Number(key.slice(1)) || 0)
      cache.set(key, await resolveCollection(filter as never, order as PlaybackOrder, seed))
    }
    return cache.get(key)!
  }

  const created: { mediaItemId: number; startTime: Date; stopTime: Date }[] = []
  let iterations = 0
  let stall = 0
  const stallLimit = channel.rotationItems.length + channel.timeBlocks.length + 3

  while (cursor < until && iterations < MAX_ITERATIONS) {
    iterations++
    const before = cursor.getTime()
    const block = activeBlock(channel.timeBlocks, cursor)

    if (block) {
      const key = 'b' + block.id
      const items = await listFor(key, block.collection, block.playbackOrder)
      if (items.length === 0) {
        cursor = skipToBlockEnd(cursor, block)
      } else {
        const pos = state.positions[key] ?? 0
        const mi = items[pos % items.length]
        state.positions[key] = pos + 1
        const dur = mi.durationSec ?? 0
        if (dur > 0) {
          const stop = new Date(cursor.getTime() + dur * 1000)
          created.push({ mediaItemId: mi.id, startTime: new Date(cursor), stopTime: stop })
          cursor = stop
        }
      }
    } else if (channel.rotationItems.length > 0) {
      const ri = channel.rotationItems[state.rotationIndex % channel.rotationItems.length]
      state.rotationIndex = state.rotationIndex + 1
      const key = 'r' + ri.id
      const items = await listFor(key, ri.collection, ri.playbackOrder)
      if (items.length > 0) {
        const take = ri.mode === 'multiple' ? Math.max(1, ri.count) : 1
        let pos = state.positions[key] ?? 0
        for (let k = 0; k < take; k++) {
          const mi = items[pos % items.length]
          pos++
          const dur = mi.durationSec ?? 0
          if (dur <= 0) continue
          const stop = new Date(cursor.getTime() + dur * 1000)
          created.push({ mediaItemId: mi.id, startTime: new Date(cursor), stopTime: stop })
          cursor = stop
          if (cursor >= until) break
          if (activeBlock(channel.timeBlocks, cursor)) break // enter the block promptly
        }
        state.positions[key] = pos
      }
    } else {
      break // no rotation and no active block — nothing to schedule
    }

    // Break if we're not making progress (all sources empty / zero-duration).
    stall = cursor.getTime() === before ? stall + 1 : 0
    if (stall > stallLimit) break
  }

  await prisma.$transaction([
    prisma.playoutItem.createMany({
      data: created.map((c) => ({ channelId, ...c })),
    }),
    prisma.channel.update({
      where: { id: channelId },
      data: { playoutAnchor: anchor, playoutCursor: cursor, playoutState: JSON.stringify(state) },
    }),
  ])
  return created.length
}

/** Clear a channel's timeline and reset its build state, anchored to now. */
export async function resetPlayout(channelId: number): Promise<void> {
  const anchor = truncateToMinute(new Date())
  await prisma.$transaction([
    prisma.playoutItem.deleteMany({ where: { channelId } }),
    prisma.channel.update({
      where: { id: channelId },
      data: { playoutAnchor: anchor, playoutCursor: anchor, playoutState: null },
    }),
  ])
}

/** Drop already-finished programs to keep the table small. */
export async function prunePlayout(channelId: number): Promise<void> {
  const cutoff = new Date(Date.now() - 3600 * 1000)
  await prisma.playoutItem.deleteMany({ where: { channelId, stopTime: { lt: cutoff } } })
}
