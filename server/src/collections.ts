import type { Prisma, MediaItem, Airing, AiringSegment } from '@prisma/client'
import { prisma } from './db.js'

type AiringWithSegments = Airing & {
  segments: (AiringSegment & { mediaItem: MediaItem })[]
}

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
 * One program on the timeline: an ordered list of one or more media files that
 * always air back-to-back as a single unit. A normal episode or movie is a unit
 * of length 1; a multi-part airing (Dexter's three segments) is longer. Nothing
 * downstream of the resolver treats the segments individually — block packing,
 * filler, shuffle and the guide all reason about the whole unit.
 */
export type ProgramUnit = MediaItem[]

/**
 * A collection resolved into an ordered list of program UNITS that repeats
 * forever.
 *
 * Playout stores only a numeric position per collection, so `at(pos)` must be a
 * pure function of that position: an incremental rebuild re-derives the exact
 * same timeline. That is also what lets shuffle re-deal on every pass (see
 * `shuffled`) without persisting the permutation.
 */
export type ResolvedList = {
  length: number
  at(pos: number): ProgramUnit
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
 * Fold a member show's episodes into program units using the airings owned by
 * that show: each airing becomes one ordered multi-segment unit — playing ALL
 * its segments, including any borrowed from another show (2 Stupid Dogs pulling
 * in a Secret Squirrel short) — and every one of the member's own episodes not
 * claimed by an airing stays a unit of one. Units come back in broadcast order
 * (by the first segment's season/episode). A segment whose file is missing or
 * has no duration is skipped.
 *
 * A file may legitimately appear in more than one airing (a short borrowed into
 * two different hosts airs inside each), so airings are NOT deduped against each
 * other — reuse is intentional. `claimed` only suppresses an episode from ALSO
 * airing standalone once an airing has consumed it (that's what keeps a grouped
 * multi-part episode from re-airing as its loose parts). Because airings are
 * folded before the standalone pass, a borrowed short always wins over its own
 * standalone copy rather than the outcome depending on member order.
 */
export function groupIntoAirings(memberEpisodes: MediaItem[], airings: AiringWithSegments[]): ProgramUnit[] {
  const claimed = new Set<number>()
  const units: ProgramUnit[] = []
  for (const a of airings) {
    const items: MediaItem[] = []
    for (const s of [...a.segments].sort((x, y) => x.order - y.order)) {
      const m = s.mediaItem
      if (!m || m.missing || !(m.durationSec && m.durationSec > 0)) continue
      items.push(m)
      claimed.add(m.id)
    }
    if (items.length > 0) units.push(items)
  }
  for (const e of memberEpisodes) if (!claimed.has(e.id)) units.push([e])
  return units.sort(byUnit)
}

const airingInclude = {
  segments: { orderBy: { order: 'asc' as const }, include: { mediaItem: true } },
}

/** Airings owned by (filed under) the given shows, with their segments' files. */
async function airingsForShows(
  where: { libraryId?: number; showTitle?: string; showTitles?: string[]; season?: number },
): Promise<AiringWithSegments[]> {
  const titleClause = where.showTitles
    ? { showTitle: { in: where.showTitles } }
    : where.showTitle
      ? { showTitle: where.showTitle }
      : {}
  return prisma.airing.findMany({
    where: {
      ...titleClause,
      ...(where.libraryId ? { libraryId: where.libraryId } : {}),
      ...(where.season != null ? { season: where.season } : {}),
    },
    include: airingInclude,
  })
}

/**
 * The collection's members expanded into program units, in the order the user
 * arranged them: a "show"/"season" member becomes its episodes folded into
 * airings (multi-part episodes as one unit, the rest as units of one), a
 * "movie"/"episode" member a single unit. The smart filter (which has no
 * user-defined position) contributes its units at the end.
 */
async function resolveUnitGroups(c: CollectionWithItems): Promise<ProgramUnit[]> {
  const out: ProgramUnit[] = []
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
      if (eps.length === 0) continue
      const airings = await airingsForShows({
        showTitle: it.showTitle,
        ...(it.libraryId ? { libraryId: it.libraryId } : {}),
        ...(it.kind === 'season' && it.season != null ? { season: it.season } : {}),
      })
      for (const u of groupIntoAirings(eps, airings)) out.push(u)
    } else if ((it.kind === 'movie' || it.kind === 'episode') && it.mediaItemId != null) {
      const m = singleById.get(it.mediaItemId)
      if (m) out.push([m])
    }
  }

  if (hasFilter(c)) {
    const filtered = await prisma.mediaItem.findMany({ where: collectionWhere(c) })
    const eps = filtered.filter((m) => m.type === 'episode' && m.showTitle)
    const others = filtered.filter((m) => !(m.type === 'episode' && m.showTitle))
    const showTitles = [...new Set(eps.map((e) => e.showTitle as string))]
    const airings = showTitles.length
      ? await airingsForShows({
          showTitles,
          ...(c.libraryId ? { libraryId: c.libraryId } : {}),
        })
      : []
    for (const u of groupIntoAirings(eps, airings)) out.push(u)
    for (const m of others.sort((a, b) => a.title.localeCompare(b.title))) out.push([m])
  }
  return out
}

/**
 * Union of all hand-picked members and the smart filter (if any) as program
 * units, deduped in hand-picked order — what the "custom" playback order airs.
 * The other orders re-sort this list. First occurrence of a file wins, so an
 * item pulled in twice (member + filter) stays where the user first put it; a
 * unit reduced to nothing by dedup is dropped.
 */
export async function resolveUnits(c: CollectionWithItems): Promise<ProgramUnit[]> {
  const seen = new Set<number>()
  const out: ProgramUnit[] = []
  for (const u of await resolveUnitGroups(c)) {
    const items = u.filter((m) => !seen.has(m.id))
    if (items.length === 0) continue
    for (const m of items) seen.add(m.id)
    out.push(items)
  }
  return out
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

/** A fixed order, looped: position 0 and position `length` are the same unit. */
function looped(units: ProgramUnit[]): ResolvedList {
  return {
    length: units.length,
    at(pos) {
      if (units.length === 0) throw new Error('empty collection')
      return units[pos % units.length]
    },
  }
}

/**
 * A list that is dealt afresh on every pass. The deal is derived from the cycle
 * (how many times the position has wrapped), so it stays reproducible across
 * rebuilds — but a viewer who watches the collection twice through does not get
 * the same running order twice, which a single fixed seed would give.
 */
function redealt(length: number, deal: (cycle: number) => ProgramUnit[]): ResolvedList {
  const cache = new Map<number, ProgramUnit[]>()
  const cycle = (n: number): ProgramUnit[] => {
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

// A unit's identity for hashing/sorting is its first segment.
function seededShuffleUnits(units: ProgramUnit[], seed: number): ProgramUnit[] {
  return [...units]
    .map((u) => ({ u, k: hash(u[0].id ^ seed) }))
    .sort((a, b) => a.k - b.k)
    .map((o) => o.u)
}

/** Every unit in random order, re-dealt each pass. */
function shuffled(units: ProgramUnit[], seed: number): ResolvedList {
  return redealt(units.length, (cycle) => seededShuffleUnits(units, (seed ^ hash(cycle)) >>> 0))
}

/**
 * Shows in random order, but each show's episodes still in sequence: a
 * marathon of one show, then a marathon of another. Which show is up next is
 * re-dealt each pass; the episodes never jump around.
 */
function shuffledShows(units: ProgramUnit[], seed: number): ResolvedList {
  const groups = showGroups(units)
  return redealt(units.length, (cycle) =>
    seededShuffle(
      groups.map((g) => ({ id: g[0][0].id, g })),
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

// Order units by their first segment's episode key.
function byUnit(a: ProgramUnit, b: ProgramUnit): number {
  return byEpisode(a[0], b[0])
}

function chronological(units: ProgramUnit[]): ProgramUnit[] {
  return [...units].sort(
    (a, b) => (a[0].showTitle ?? '').localeCompare(b[0].showTitle ?? '') || byEpisode(a[0], b[0]),
  )
}

/**
 * Split units into per-show groups, each internally in episode order. Units
 * without a show (movies, one-offs) form ONE group rather than a group each:
 * as separate groups they'd swamp a round-robin, so a collection of one show
 * plus fifty movies would give the show 1/51 of its airtime instead of half.
 * A multi-part airing is keyed by its first segment's show. Groups come back in
 * a stable, name-sorted order for callers to use or reorder.
 */
function showGroups(units: ProgramUnit[]): ProgramUnit[][] {
  const groups = new Map<string, ProgramUnit[]>()
  for (const u of units) {
    const key = u[0].showTitle ? 'show:' + u[0].showTitle : 'movies'
    const g = groups.get(key)
    if (g) g.push(u)
    else groups.set(key, [u])
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, arr]) => arr.sort(byUnit))
}

// Round-robin across shows: one unit from each show in turn, each show
// advancing in episode order, looping until every unit is placed.
function rotateShows(units: ProgramUnit[]): ProgramUnit[] {
  const lists = showGroups(units)
  const pointers = new Array(lists.length).fill(0)
  const result: ProgramUnit[] = []
  let remaining = units.length
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

/** Resolve a collection to an ordered, endlessly repeating list of units. */
export async function resolveCollection(
  c: CollectionWithItems,
  order: PlaybackOrder,
  seed = 0,
): Promise<ResolvedList> {
  // `resolveUnits` already returns the hand-picked order.
  const units = await resolveUnits(c)
  if (order === 'custom') return looped(units)
  if (order === 'shuffle') return shuffled(units, seed)
  if (order === 'shuffleShows') return shuffledShows(units, seed)
  if (order === 'rotate') return looped(rotateShows(units))
  return looped(chronological(units))
}
