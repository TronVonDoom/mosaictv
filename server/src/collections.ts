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
  /** Each show's turns taken as of `pos`, for the rotating orders (see RotationProgress). */
  progressAt?(pos: number): Record<string, number>
}

/**
 * Where a rotation stands: `base` is its stored position (a turn counter) and
 * `shows` how many turns each show had taken by then, keyed by show group.
 * Counting each show separately is what lets a show join or leave a rotation
 * without shifting every other show's episode — with only the shared counter,
 * adding an eighth show to seven sent all seven back several episodes.
 */
export type RotationProgress = { base: number; shows?: Record<string, number> }

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
    // Show by show, A–Z: the filter has no member order of its own, and grouped
    // this way its shows follow the hand-picked ones in a rotation too.
    const units = groupIntoAirings(eps, airings).sort(
      (a, b) => (a[0].showTitle ?? '').localeCompare(b[0].showTitle ?? '') || byUnit(a, b),
    )
    for (const u of units) out.push(u)
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

const mod = (a: number, n: number) => ((a % n) + n) % n

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

/** A show (or the one group all the movies share) and its units in episode order. */
type ShowGroup = { key: string; units: ProgramUnit[] }

/**
 * Split units into per-show groups, each internally in episode order. Units
 * without a show (movies, one-offs) form ONE group rather than a group each:
 * as separate groups they'd swamp a round-robin, so a collection of one show
 * plus fifty movies would give the show 1/51 of its airtime instead of half.
 * A multi-part airing is keyed by its first segment's show.
 *
 * Groups come back in the collection's own order — where each group's first
 * unit appears, which is member order, then the smart filter's shows — so the
 * order the user arranges is the order a rotation or release order follows.
 */
function showGroups(units: ProgramUnit[]): ShowGroup[] {
  const groups = new Map<string, ProgramUnit[]>()
  for (const u of units) {
    const key = u[0].showTitle ? 'show:' + u[0].showTitle : 'movies'
    const g = groups.get(key)
    if (g) g.push(u)
    else groups.set(key, [u])
  }
  return [...groups.entries()].map(([key, arr]) => ({ key, units: arr.sort(byUnit) }))
}

/**
 * Release order: each show's episodes in order and the movies oldest first,
 * one group after another in the collection's order. (It used to sort the
 * shows A–Z, which no arrangement could change.)
 */
export function releaseOrder(units: ProgramUnit[]): ProgramUnit[] {
  return showGroups(units).flatMap((g) => g.units)
}

// Turns in [0, x) that land on slot i of an n-slot round-robin.
const slotTurns = (x: number, i: number, n: number) => Math.max(0, Math.floor((x - i + n - 1) / n))

/**
 * Each show's turns taken as of `progress.base`. A rotation saved before shows
 * were counted separately has only its position; it ran the shows A–Z, one
 * turn each, so each show's count follows from that, and every show picks up
 * exactly where it left off in the new order.
 */
function startingTurns(groups: ShowGroup[], progress: RotationProgress): Record<string, number> {
  const out: Record<string, number> = {}
  if (progress.shows) {
    // A show new to the rotation starts at its first episode.
    for (const g of groups) out[g.key] = progress.shows[g.key] ?? 0
    return out
  }
  const alpha = groups.map((g) => g.key).sort((a, b) => a.localeCompare(b))
  for (const g of groups) out[g.key] = slotTurns(progress.base, alpha.indexOf(g.key), groups.length)
  return out
}

/**
 * A rotation over show groups. `turn.showAt(pos)` says whose turn position
 * `pos` is and `turn.before(pos, g)` how many turns group g has had in
 * [0, pos); each show's episode follows from its own count.
 *
 * A show keeps its turn forever — it does NOT drop out once its last episode
 * has aired, but starts over from its first. Dropping it would hand its
 * airtime to whichever shows had more episodes left, so a rotation of a
 * 19-episode show and a 200-episode one would decay into the long one playing
 * alone. Every show gets an equal share instead, which is what "one from each
 * show in turn" has to mean on a channel that runs forever.
 */
function rotation(
  groups: ShowGroup[],
  progress: RotationProgress,
  turn: { showAt(pos: number): number; before(pos: number, g: number): number },
  length: number,
): ResolvedList {
  const start = startingTurns(groups, progress)
  const taken = (g: number, pos: number) =>
    start[groups[g].key] + turn.before(pos, g) - turn.before(progress.base, g)
  return {
    length,
    at(pos) {
      if (groups.length === 0) throw new Error('empty collection')
      const g = turn.showAt(pos)
      const list = groups[g].units
      return list[mod(taken(g, pos), list.length)]
    },
    progressAt(pos) {
      // Shows no longer in the collection keep their count, so one that comes
      // back resumes where it was.
      const out: Record<string, number> = { ...progress.shows }
      groups.forEach((grp, g) => (out[grp.key] = taken(g, pos)))
      return out
    },
  }
}

/** Rotate shows: one unit from each show in turn, in the collection's order. */
export function rotated(units: ProgramUnit[], progress: RotationProgress = { base: 0 }): ResolvedList {
  const groups = showGroups(units)
  const n = groups.length
  return rotation(groups, progress, { showAt: (pos) => mod(pos, n), before: (pos, g) => slotTurns(pos, g, n) }, units.length)
}

/**
 * Rotate shows, mixed: every show still gets one turn per round, but each
 * round is dealt in a fresh random order, reproducible from the seed and the
 * round number. A show never plays twice running across a round boundary — a
 * round that would open with the show that closed the last one swaps its first
 * two. (Only the first two ever move, so the last show of the previous round
 * is always its unadjusted deal.) Two shows have no room to mix: they alternate.
 */
export function mixedRotation(units: ProgramUnit[], seed: number, progress: RotationProgress = { base: 0 }): ResolvedList {
  const groups = showGroups(units)
  const n = groups.length
  const deal = (r: number): number[] =>
    Array.from({ length: n }, (_, i) => ({ i, k: hash((i + 1) ^ ((seed ^ hash(r)) >>> 0)) }))
      .sort((a, b) => a.k - b.k)
      .map((o) => o.i)
  const rounds = new Map<number, { order: number[]; slotOf: number[] }>()
  const round = (r: number) => {
    let hit = rounds.get(r)
    if (!hit) {
      let order = n < 3 ? Array.from({ length: n }, (_, i) => i) : deal(r)
      if (n >= 3 && order[0] === deal(r - 1)[n - 1]) order = [order[1], order[0], ...order.slice(2)]
      const slotOf: number[] = []
      order.forEach((g, j) => (slotOf[g] = j))
      hit = { order, slotOf }
      // A build pass only touches a round or two; don't grow unbounded.
      if (rounds.size > 8) rounds.clear()
      rounds.set(r, hit)
    }
    return hit
  }
  return rotation(
    groups,
    progress,
    {
      showAt: (pos) => round(Math.floor(pos / n)).order[mod(pos, n)],
      // Every whole round before this one gave g one turn; this round has
      // given it one if its slot came before `pos`.
      before: (pos, g) => {
        const r = Math.floor(pos / n)
        return r + (round(r).slotOf[g] < mod(pos, n) ? 1 : 0)
      },
    },
    units.length,
  )
}

/**
 * Resolve a collection to an ordered, endlessly repeating list of units.
 * `progress` is where a rotation stands; the other orders ignore it.
 */
export async function resolveCollection(
  c: CollectionWithItems,
  order: PlaybackOrder,
  seed = 0,
  progress?: RotationProgress,
): Promise<ResolvedList> {
  // `resolveUnits` already returns the hand-picked order.
  const units = await resolveUnits(c)
  if (order === 'custom') return looped(units)
  if (order === 'shuffle') return shuffled(units, seed)
  if (order === 'shuffleShows') return mixedRotation(units, seed, progress)
  if (order === 'rotate') return rotated(units, progress)
  return looped(releaseOrder(units))
}
