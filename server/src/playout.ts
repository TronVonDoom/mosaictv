import type { TimeBlock } from '@prisma/client'
import { prisma } from './db.js'
import {
  effectiveOrder,
  resolveCollection,
  type CollectionWithItems,
  type ResolvedList,
} from './collections.js'
import { log } from './logs.js'

const MAX_ITERATIONS = 50000

type BlockWithCollection = TimeBlock & { collection: CollectionWithItems }
type State = { rotationIndex: number; positions: Record<string, number> }

function truncateToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60000) * 60000)
}

/** The time block (if any) active at the given local date/time. First match wins. */
function activeBlock(blocks: BlockWithCollection[], date: Date): BlockWithCollection | null {
  const day = date.getDay()
  const prevDay = (day + 6) % 7
  const tod = date.getHours() * 60 + date.getMinutes()
  for (const b of blocks) {
    const days = b.days.split(',').map((s) => Number(s.trim()))
    if (b.endMinute > b.startMinute) {
      // Same-day block.
      if (days.includes(day) && tod >= b.startMinute && tod < b.endMinute) return b
    } else {
      // Wraps past midnight: evening part today, or the morning tail of a block
      // that started the previous day.
      if (days.includes(day) && tod >= b.startMinute) return b
      if (days.includes(prevDay) && tod < b.endMinute) return b
    }
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

/** The soonest block start strictly after `cursor` and before `until` (and which block), or null. */
function nextBlockBoundary(
  blocks: BlockWithCollection[],
  cursor: Date,
  until: Date,
): { start: Date; block: BlockWithCollection } | null {
  let best: { start: Date; block: BlockWithCollection } | null = null
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(cursor)
    day.setDate(day.getDate() + offset)
    const wd = day.getDay()
    for (const b of blocks) {
      if (!b.days.split(',').map((s) => Number(s.trim())).includes(wd)) continue
      const start = new Date(day)
      start.setHours(Math.floor(b.startMinute / 60), b.startMinute % 60, 0, 0)
      if (start > cursor && start < until && (best === null || start < best.start)) best = { start, block: b }
    }
  }
  return best
}

// One build per channel at a time. Concurrent builds (e.g. two viewers
// connecting at once) would each read the same saved positions, double-schedule
// the same window, and the last writer would clobber the other's state — which
// loses episode continuity. Serialized, the second build re-reads the advanced
// cursor and becomes a cheap no-op.
const buildChain = new Map<number, Promise<unknown>>()
export function buildPlayout(channelId: number, until: Date): Promise<number> {
  const prev = buildChain.get(channelId) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(() => buildPlayoutInner(channelId, until))
  buildChain.set(channelId, next.catch(() => {}))
  return next
}

/**
 * Build (extend) a channel's playout timeline up to `until`. Rotation fills the
 * timeline 24/7; an active time block overrides it. Programs play fully, so
 * block boundaries are honored at program ends (soft dayparting).
 *
 * Continuity: playback positions are keyed by COLLECTION, so a collection
 * continues from where it left off no matter which block or rotation slot airs
 * it (five single-day blocks of "Snick" behave like one weekly strip). Legacy
 * per-block/per-rotation position keys are adopted on first use.
 */
async function buildPlayoutInner(channelId: number, until: Date): Promise<number> {
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

  // Cache resolved collection lists for this build pass (per collection+order).
  // `setting` may be "inherit", which defers to the collection's own default.
  const cache = new Map<string, ResolvedList>()
  const listFor = async (
    collection: CollectionWithItems,
    setting: string,
  ): Promise<ResolvedList> => {
    const order = effectiveOrder(setting, collection)
    const ck = `${collection.id}:${order}`
    if (!cache.has(ck)) {
      const seed = channelId * 100000 + collection.id
      cache.set(ck, await resolveCollection(collection, order, seed))
    }
    return cache.get(ck)!
  }
  // Position for a collection, adopting the pre-refactor per-block/per-rotation
  // key the first time so nothing restarts at episode 1 on upgrade.
  const posOf = (key: string, legacyKey: string): number =>
    state.positions[key] ?? state.positions[legacyKey] ?? 0

  const created: {
    mediaItemId: number | null
    kind: string
    title: string | null
    startTime: Date
    stopTime: Date
  }[] = []
  const pushProgram = (id: number, start: Date, stop: Date) =>
    created.push({ mediaItemId: id, kind: 'program', title: null, startTime: start, stopTime: stop })
  const pushFiller = (start: Date, stop: Date) =>
    created.push({ mediaItemId: null, kind: 'filler', title: 'Filler', startTime: start, stopTime: stop })
  let iterations = 0
  let stall = 0
  const stallLimit = channel.rotationItems.length + channel.timeBlocks.length + 3

  while (cursor < until && iterations < MAX_ITERATIONS) {
    iterations++
    const before = cursor.getTime()
    const block = activeBlock(channel.timeBlocks, cursor)

    if (block) {
      const key = 'c' + block.collectionId
      const legacy = 'b' + block.id
      const items = await listFor(block.collection, block.playbackOrder)
      const blockEnd = skipToBlockEnd(cursor, block)
      const fillerMode = block.fillerMode || 'none'

      if (items.length === 0) {
        // No programs: fill the whole window with filler (if enabled), else skip.
        if (fillerMode !== 'none' && blockEnd > cursor) pushFiller(new Date(cursor), new Date(blockEnd))
        cursor = blockEnd
      } else if (fillerMode === 'none') {
        // Soft boundary: one program per iteration; may overrun the block end.
        const pos = posOf(key, legacy)
        const mi = items.at(pos)
        state.positions[key] = pos + 1
        const dur = mi.durationSec ?? 0
        if (dur > 0) {
          const stop = new Date(cursor.getTime() + dur * 1000)
          pushProgram(mi.id, new Date(cursor), stop)
          cursor = stop
        }
      } else {
        // Pack as many programs as fit, then filler to land exactly on blockEnd.
        const availSec = (blockEnd.getTime() - cursor.getTime()) / 1000
        let pos = posOf(key, legacy)
        const startPos = pos
        const fit: { id: number; dur: number }[] = []
        let used = 0
        for (let g = 0; g < 20000; g++) {
          const mi = items.at(pos)
          const dur = mi.durationSec ?? 0
          if (dur <= 0) {
            pos++
            continue
          }
          if (used + dur > availSec) break
          fit.push({ id: mi.id, dur })
          used += dur
          pos++
        }
        state.positions[key] = pos

        if (fit.length === 0) {
          // A single program is longer than the whole block — play it (overruns).
          const mi = items.at(pos)
          state.positions[key] = pos + 1
          const stop = new Date(cursor.getTime() + Math.max(mi.durationSec ?? 0, 1) * 1000)
          pushProgram(mi.id, new Date(cursor), stop)
          cursor = stop
        } else {
          const gapSec = Math.max(0, availSec - used)
          let c = cursor.getTime()
          const perGap = fillerMode === 'between' ? gapSec / fit.length : 0
          for (const p of fit) {
            const stop = c + p.dur * 1000
            pushProgram(p.id, new Date(c), new Date(stop))
            c = stop
            if (perGap > 0.5) {
              const fEnd = c + perGap * 1000
              pushFiller(new Date(c), new Date(fEnd))
              c = fEnd
            }
          }
          if (fillerMode === 'end' && gapSec > 0.5) pushFiller(new Date(c), new Date(blockEnd))
          cursor = blockEnd
          log(
            'debug',
            'playout',
            `Block airing: ${fit.length} program(s) starting at item ${(startPos % items.length) + 1}/${items.length} (position ${startPos})`,
          )
        }
      }
    } else if (channel.rotationItems.length > 0) {
      const ri = channel.rotationItems[state.rotationIndex % channel.rotationItems.length]
      state.rotationIndex = state.rotationIndex + 1
      const key = 'c' + ri.collectionId
      const legacy = 'r' + ri.id
      const items = await listFor(ri.collection, ri.playbackOrder)
      if (items.length > 0) {
        const take = ri.mode === 'multiple' ? Math.max(1, ri.count) : 1
        let pos = posOf(key, legacy)
        for (let k = 0; k < take; k++) {
          const mi = items.at(pos)
          const dur = mi.durationSec ?? 0
          if (dur <= 0) {
            pos++
            continue
          }
          // Hard block ahead? If this program would overrun a "hard" block's
          // start, fill the gap so the block begins exactly on time and defer
          // this program (don't advance pos) rather than cutting it short.
          const boundary = nextBlockBoundary(channel.timeBlocks, cursor, until)
          if (boundary && boundary.block.startMode === 'hard') {
            const gapMs = boundary.start.getTime() - cursor.getTime()
            if (dur * 1000 > gapMs) {
              if (gapMs > 500) pushFiller(new Date(cursor), new Date(boundary.start))
              cursor = boundary.start
              break
            }
          }
          pos++
          const stop = new Date(cursor.getTime() + dur * 1000)
          pushProgram(mi.id, new Date(cursor), stop)
          cursor = stop
          if (cursor >= until) break
          if (activeBlock(channel.timeBlocks, cursor)) break // enter the block promptly
        }
        state.positions[key] = pos
      }
    } else {
      // No rotation: this is a blocks-only channel. Jump to the next block
      // start (dead air in between), or stop if none is coming up.
      const next = channel.timeBlocks.length ? nextBlockBoundary(channel.timeBlocks, cursor, until)?.start ?? null : null
      if (next) cursor = next
      else break
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

/**
 * Clear a channel's future timeline and re-anchor it to now. By default this
 * KEEPS each rotation/block's saved position, so shows continue where they
 * left off instead of restarting at episode 1 — pass hard=true to also wipe
 * positions and start every item over from the beginning.
 */
export async function resetPlayout(channelId: number, hard = false): Promise<void> {
  const anchor = truncateToMinute(new Date())
  await prisma.$transaction([
    prisma.playoutItem.deleteMany({ where: { channelId } }),
    prisma.channel.update({
      where: { id: channelId },
      data: { playoutAnchor: anchor, playoutCursor: anchor, ...(hard ? { playoutState: null } : {}) },
    }),
  ])
}

/** Drop already-finished programs to keep the table small. */
export async function prunePlayout(channelId: number): Promise<void> {
  const cutoff = new Date(Date.now() - 3600 * 1000)
  await prisma.playoutItem.deleteMany({ where: { channelId, stopTime: { lt: cutoff } } })
}
