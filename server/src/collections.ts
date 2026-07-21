import type { Prisma, MediaItem } from '@prisma/client'
import { prisma } from './db.js'

export type CollectionFilter = {
  libraryId?: number | null
  filterType?: string | null
  filterShow?: string | null
  filterSearch?: string | null
  filterGenre?: string | null
}

export type CollectionWithItems = Prisma.CollectionGetPayload<{ include: { items: true } }>

export type PlaybackOrder =
  | 'chronological'
  | 'shuffle'
  | 'shuffleShows'
  | 'rotate'
  | 'custom'

export const PLAYBACK_ORDERS: PlaybackOrder[] = [
  'chronological',
  'custom',
  'rotate',
  'shuffle',
  'shuffleShows',
]

export function asPlaybackOrder(v: unknown): PlaybackOrder {
  return PLAYBACK_ORDERS.includes(String(v) as PlaybackOrder)
    ? (String(v) as PlaybackOrder)
    : 'chronological'
}

/**
 * A rotation item's / time block's order setting, which may defer to the
 * collection's own default. Stored as "inherit"; resolve with `effectiveOrder`.
 */
export type OrderSetting = PlaybackOrder | 'inherit'

export function asOrderSetting(v: unknown): OrderSetting {
  return String(v) === 'inherit' ? 'inherit' : asPlaybackOrder(v)
}

/** The order to actually play with, resolving "inherit" against the collection. */
export function effectiveOrder(
  setting: string,
  collection: { defaultOrder: string },
): PlaybackOrder {
  return asPlaybackOrder(setting === 'inherit' ? collection.defaultOrder : setting)
}

/**
 * A collection resolved into an ordered program list that repeats forever.
 *
 * Playout stores only a numeric position per collection, so `at(pos)` must be a
 * pure function of that position: an incremental rebuild re-derives the exact
 * same timeline. That is also what lets shuffle re-deal on every pass (see
 * `shuffled`) without persisting the permutation.
 */
export type ResolvedList = {
  length: number
  at(pos: number): MediaItem
}

// Only playable items: present on disk and with a known duration.
export function collectionWhere(c: CollectionFilter): Prisma.MediaItemWhereInput {
  const where: Prisma.MediaItemWhereInput = { missing: false, durationSec: { gt: 0 } }
  if (c.libraryId) where.libraryId = c.libraryId
  if (c.filterType) where.type = c.filterType
  if (c.filterShow) where.showTitle = c.filterShow
  if (c.filterGenre) where.genres = { contains: c.filterGenre }
  if (c.filterSearch) {
    where.OR = [
      { title: { contains: c.filterSearch } },
      { showTitle: { contains: c.filterSearch } },
    ]
  }
  return where
}

function hasFilter(c: CollectionFilter): boolean {
  return !!(c.libraryId || c.filterType || c.filterShow || c.filterSearch || c.filterGenre)
}

/**
 * The collection's members expanded into per-member blocks, in the order the
 * user arranged them: a "show" or "season" member becomes its episodes in
 * season/episode order, a "movie"/"episode" member a single item. The smart
 * filter (which has no user-defined position) contributes one chronological
 * block at the end.
 */
async function resolveGroups(c: CollectionWithItems): Promise<MediaItem[][]> {
  const groups: MediaItem[][] = []
  // Sort defensively: not every caller's `include` sets an orderBy.
  const members = [...c.items].sort((a, b) => a.order - b.order || a.id - b.id)

  // Single-item members are fetched in one query, then placed back at their
  // member's spot rather than being appended as a batch.
  const singleIds = members
    .filter((i) => (i.kind === 'movie' || i.kind === 'episode') && i.mediaItemId != null)
    .map((i) => i.mediaItemId as number)
  const singles = singleIds.length
    ? await prisma.mediaItem.findMany({
        where: { id: { in: singleIds }, missing: false, durationSec: { gt: 0 } },
      })
    : []
  const singleById = new Map(singles.map((m) => [m.id, m]))

  for (const it of members) {
    if ((it.kind === 'show' || it.kind === 'season') && it.showTitle) {
      const eps = await prisma.mediaItem.findMany({
        where: {
          type: 'episode',
          missing: false,
          durationSec: { gt: 0 },
          showTitle: it.showTitle,
          ...(it.libraryId ? { libraryId: it.libraryId } : {}),
          ...(it.kind === 'season' && it.season != null ? { season: it.season } : {}),
        },
      })
      if (eps.length > 0) groups.push(eps.sort(byEpisode))
    } else if ((it.kind === 'movie' || it.kind === 'episode') && it.mediaItemId != null) {
      const m = singleById.get(it.mediaItemId)
      if (m) groups.push([m])
    }
  }

  if (hasFilter(c)) {
    groups.push(chronological(await prisma.mediaItem.findMany({ where: collectionWhere(c) })))
  }
  return groups
}

/**
 * Union of all hand-picked members and the smart filter (if any), deduped —
 * in hand-picked order, which is what the "custom" playback order airs. The
 * other orders re-sort this list.
 */
export async function resolveMembers(c: CollectionWithItems): Promise<MediaItem[]> {
  const map = new Map<number, MediaItem>()
  // First occurrence wins: a Map keeps the original insertion position, so an
  // item pulled in twice (member + filter) stays where the user put it.
  for (const g of await resolveGroups(c)) for (const m of g) map.set(m.id, m)
  return [...map.values()]
}

/**
 * Approximate count without loading rows (ignores cross-source dedupe). Three
 * queries at most regardless of how many members there are — this runs for
 * every collection on the collections list.
 */
export async function collectionCount(c: CollectionWithItems): Promise<number> {
  // One OR'd query covers every show/season member at once.
  const showWhere = c.items
    .filter((i) => (i.kind === 'show' || i.kind === 'season') && i.showTitle)
    .map((i) => ({
      showTitle: i.showTitle as string,
      ...(i.libraryId ? { libraryId: i.libraryId } : {}),
      ...(i.kind === 'season' && i.season != null ? { season: i.season } : {}),
    }))
  const singleIds = c.items
    .filter((i) => (i.kind === 'movie' || i.kind === 'episode') && i.mediaItemId != null)
    .map((i) => i.mediaItemId as number)

  const [filterN, showN, singleN] = await Promise.all([
    hasFilter(c) ? prisma.mediaItem.count({ where: collectionWhere(c) }) : 0,
    showWhere.length > 0
      ? prisma.mediaItem.count({
          where: { type: 'episode', missing: false, durationSec: { gt: 0 }, OR: showWhere },
        })
      : 0,
    singleIds.length > 0
      ? prisma.mediaItem.count({
          where: { id: { in: singleIds }, missing: false, durationSec: { gt: 0 } },
        })
      : 0,
  ])
  return filterN + showN + singleN
}

// Stable integer hash for deterministic shuffles.
function hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
  return (x ^ (x >>> 16)) >>> 0
}

function seededShuffle<T extends { id: number }>(arr: T[], seed: number): T[] {
  return [...arr]
    .map((x) => ({ x, k: hash(x.id ^ seed) }))
    .sort((a, b) => a.k - b.k)
    .map((o) => o.x)
}

/** A fixed order, looped: position 0 and position `length` are the same item. */
function looped(items: MediaItem[]): ResolvedList {
  return {
    length: items.length,
    at(pos) {
      if (items.length === 0) throw new Error('empty collection')
      return items[pos % items.length]
    },
  }
}

/**
 * A list that is dealt afresh on every pass. The deal is derived from the cycle
 * (how many times the position has wrapped), so it stays reproducible across
 * rebuilds — but a viewer who watches the collection twice through does not get
 * the same running order twice, which a single fixed seed would give.
 */
function redealt(length: number, deal: (cycle: number) => MediaItem[]): ResolvedList {
  const cache = new Map<number, MediaItem[]>()
  const cycle = (n: number): MediaItem[] => {
    let perm = cache.get(n)
    if (!perm) {
      perm = deal(n)
      // A build pass only ever touches a cycle or two; don't grow unbounded.
      if (cache.size > 3) cache.clear()
      cache.set(n, perm)
    }
    return perm
  }
  return {
    length,
    at(pos) {
      if (length === 0) throw new Error('empty collection')
      return cycle(Math.floor(pos / length))[pos % length]
    },
  }
}

/** Every item in random order, re-dealt each pass. */
function shuffled(items: MediaItem[], seed: number): ResolvedList {
  return redealt(items.length, (cycle) => seededShuffle(items, (seed ^ hash(cycle)) >>> 0))
}

/**
 * Shows in random order, but each show's episodes still in sequence: a
 * marathon of one show, then a marathon of another. Which show is up next is
 * re-dealt each pass; the episodes never jump around.
 */
function shuffledShows(items: MediaItem[], seed: number): ResolvedList {
  const groups = showGroups(items)
  return redealt(items.length, (cycle) =>
    seededShuffle(
      groups.map((g) => ({ id: g[0].id, g })),
      (seed ^ hash(cycle)) >>> 0,
    ).flatMap((o) => o.g),
  )
}

// Order within a single show/group: season, episode, year, title.
function byEpisode(a: MediaItem, b: MediaItem): number {
  return (
    (a.season ?? 0) - (b.season ?? 0) ||
    (a.episode ?? 0) - (b.episode ?? 0) ||
    (a.year ?? 0) - (b.year ?? 0) ||
    a.title.localeCompare(b.title)
  )
}

function chronological(items: MediaItem[]): MediaItem[] {
  return [...items].sort(
    (a, b) => (a.showTitle ?? '').localeCompare(b.showTitle ?? '') || byEpisode(a, b),
  )
}

/**
 * Split into per-show groups, each internally in episode order. Everything
 * without a show (movies, one-offs) forms ONE group rather than a group each:
 * as separate groups they'd swamp a round-robin, so a collection of one show
 * plus fifty movies would give the show 1/51 of its airtime instead of half.
 * Groups come back in a stable, name-sorted order for callers to use or reorder.
 */
function showGroups(items: MediaItem[]): MediaItem[][] {
  const groups = new Map<string, MediaItem[]>()
  for (const m of items) {
    const key = m.showTitle ? 'show:' + m.showTitle : 'movies'
    const g = groups.get(key)
    if (g) g.push(m)
    else groups.set(key, [m])
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, arr]) => arr.sort(byEpisode))
}

// Round-robin across shows: one episode from each show in turn, each show
// advancing in episode order, looping until every item is placed.
function rotateShows(items: MediaItem[]): MediaItem[] {
  const lists = showGroups(items)
  const pointers = new Array(lists.length).fill(0)
  const result: MediaItem[] = []
  let remaining = items.length
  while (remaining > 0) {
    for (let g = 0; g < lists.length; g++) {
      if (pointers[g] < lists[g].length) {
        result.push(lists[g][pointers[g]])
        pointers[g]++
        remaining--
      }
    }
  }
  return result
}

/** Resolve a collection to an ordered, endlessly repeating playable list. */
export async function resolveCollection(
  c: CollectionWithItems,
  order: PlaybackOrder,
  seed = 0,
): Promise<ResolvedList> {
  // `resolveMembers` already returns the hand-picked order.
  const items = await resolveMembers(c)
  if (order === 'custom') return looped(items)
  if (order === 'shuffle') return shuffled(items, seed)
  if (order === 'shuffleShows') return shuffledShows(items, seed)
  if (order === 'rotate') return looped(rotateShows(items))
  return looped(chronological(items))
}
