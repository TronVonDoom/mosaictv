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

export type PlaybackOrder = 'chronological' | 'shuffle'

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

/** Union of the smart filter (if any) and all hand-picked members, deduped. */
export async function resolveMembers(c: CollectionWithItems): Promise<MediaItem[]> {
  const map = new Map<number, MediaItem>()

  if (hasFilter(c)) {
    for (const m of await prisma.mediaItem.findMany({ where: collectionWhere(c) })) {
      map.set(m.id, m)
    }
  }

  for (const it of c.items.filter((i) => i.kind === 'show' && i.showTitle)) {
    const eps = await prisma.mediaItem.findMany({
      where: {
        type: 'episode',
        missing: false,
        durationSec: { gt: 0 },
        showTitle: it.showTitle,
        ...(it.libraryId ? { libraryId: it.libraryId } : {}),
      },
    })
    for (const m of eps) map.set(m.id, m)
  }

  const movieIds = c.items
    .filter((i) => i.kind === 'movie' && i.mediaItemId != null)
    .map((i) => i.mediaItemId as number)
  if (movieIds.length > 0) {
    const movies = await prisma.mediaItem.findMany({
      where: { id: { in: movieIds }, missing: false, durationSec: { gt: 0 } },
    })
    for (const m of movies) map.set(m.id, m)
  }

  return [...map.values()]
}

/** Approximate count without loading rows (ignores cross-source dedupe). */
export async function collectionCount(c: CollectionWithItems): Promise<number> {
  let n = 0
  if (hasFilter(c)) n += await prisma.mediaItem.count({ where: collectionWhere(c) })
  for (const it of c.items.filter((i) => i.kind === 'show' && i.showTitle)) {
    n += await prisma.mediaItem.count({
      where: {
        type: 'episode',
        missing: false,
        durationSec: { gt: 0 },
        showTitle: it.showTitle,
        ...(it.libraryId ? { libraryId: it.libraryId } : {}),
      },
    })
  }
  const movieIds = c.items
    .filter((i) => i.kind === 'movie' && i.mediaItemId != null)
    .map((i) => i.mediaItemId as number)
  if (movieIds.length > 0) {
    n += await prisma.mediaItem.count({
      where: { id: { in: movieIds }, missing: false, durationSec: { gt: 0 } },
    })
  }
  return n
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

function chronological(items: MediaItem[]): MediaItem[] {
  return [...items].sort(
    (a, b) =>
      (a.showTitle ?? '').localeCompare(b.showTitle ?? '') ||
      (a.season ?? 0) - (b.season ?? 0) ||
      (a.episode ?? 0) - (b.episode ?? 0) ||
      (a.year ?? 0) - (b.year ?? 0) ||
      a.title.localeCompare(b.title),
  )
}

/** Resolve a collection to an ordered, playable list of media items. */
export async function resolveCollection(
  c: CollectionWithItems,
  order: PlaybackOrder,
  seed = 0,
): Promise<MediaItem[]> {
  const items = await resolveMembers(c)
  return order === 'shuffle' ? seededShuffle(items, seed) : chronological(items)
}
