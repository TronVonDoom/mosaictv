// "What's on" for the web UI: each on-air channel's current program and the
// next few after it, shaped for display — titles split into a headline and a
// subline, a multi-part airing folded into one program, and a flag for which
// artwork actually exists so the page never asks for a picture that 404s.
//
// Read-only over the built playout; nothing here schedules anything.

import { prisma } from './db.js'
import { episodeCode } from './labels.js'

type MediaForNow = {
  id: number
  libraryId: number
  type: string
  title: string
  showTitle: string | null
  season: number | null
  episode: number | null
  year: number | null
  artist: string | null
  overview: string | null
  genres: string | null
  rating: number | null
  posterPath: string | null
  showPosterPath: string | null
  tmdbPosterPath: string | null
  tmdbBackdropPath: string | null
}

type RowForNow = {
  kind: string
  title: string | null
  startTime: Date
  stopTime: Date
  groupKey: string | null
  mediaItem: MediaForNow | null
}

type ShowMeta = {
  overview: string | null
  genres: string | null
  rating: number | null
  tmdbPosterPath: string | null
  tmdbBackdropPath: string | null
}

/** One program as the UI shows it. A multi-part airing is a single unit. */
export type NowUnit = {
  kind: 'program' | 'filler'
  startTime: string
  stopTime: string
  /** The item artwork is requested for (the first segment of an airing). */
  mediaItemId: number | null
  type: string | null
  /** "Doug" for an episode, the film's title for a movie. */
  title: string
  /** "S04E07 · Doug's Halloween Adventure", a movie's year, a song's artist. */
  subtitle: string | null
  year: number | null
  overview: string | null
  genres: string | null
  rating: number | null
  /** Which artwork request answers for this program, or null if none will. */
  art: 'poster' | 'show' | null
  hasBackdrop: boolean
  parts: number
}

/**
 * Fold consecutive playout rows into program units: rows that share a
 * groupKey are one airing (Dexter's three segments), everything else stands
 * alone. Input must be in start order.
 */
export function groupRows<T extends { groupKey: string | null }>(rows: T[]): T[][] {
  const out: T[][] = []
  for (const r of rows) {
    const last = out[out.length - 1]
    if (r.groupKey && last && last[0].groupKey === r.groupKey) last.push(r)
    else out.push([r])
  }
  return out
}

/** Shape one unit for display. `show` is the TMDB show row, for episodes. */
export function describeUnit(unit: RowForNow[], show: ShowMeta | undefined): NowUnit {
  const first = unit[0]
  const last = unit[unit.length - 1]
  const m = first.mediaItem
  const base = {
    startTime: first.startTime.toISOString(),
    stopTime: last.stopTime.toISOString(),
    parts: unit.length,
  }
  if (first.kind === 'filler' || !m) {
    return {
      ...base,
      kind: 'filler',
      mediaItemId: null,
      type: null,
      title: first.title && first.title !== 'Filler' ? first.title : 'Station break',
      subtitle: null,
      year: null,
      overview: null,
      genres: null,
      rating: null,
      art: null,
      hasBackdrop: false,
    }
  }

  if (m.type === 'episode' && m.showTitle) {
    // Every segment's code and title, so a two-parter reads as both halves.
    const segs = unit
      .map((r) => r.mediaItem)
      .filter((x): x is MediaForNow => !!x)
    const code = episodeCode(m)
    const lastCode = episodeCode(segs[segs.length - 1])
    const codes = segs.length > 1 && lastCode && lastCode !== code ? `${code}–${lastCode.replace(/^S\d+/, '')}` : code
    const titles = segs.map((s) => s.title).filter(Boolean).join(' / ')
    return {
      ...base,
      kind: 'program',
      mediaItemId: m.id,
      type: m.type,
      title: m.showTitle,
      subtitle: [codes, titles].filter(Boolean).join(' · ') || null,
      year: m.year,
      overview: m.overview ?? show?.overview ?? null,
      genres: show?.genres ?? m.genres,
      rating: show?.rating ?? m.rating,
      art: m.showPosterPath || show?.tmdbPosterPath ? 'show' : m.posterPath ? 'poster' : null,
      hasBackdrop: !!show?.tmdbBackdropPath,
    }
  }

  return {
    ...base,
    kind: 'program',
    mediaItemId: m.id,
    type: m.type,
    title: m.title,
    subtitle: m.type === 'music' ? m.artist : m.year != null ? String(m.year) : null,
    year: m.year,
    overview: m.overview,
    genres: m.genres,
    rating: m.rating,
    art: m.posterPath || m.tmdbPosterPath ? 'poster' : null,
    hasBackdrop: !!m.tmdbBackdropPath,
  }
}

const MEDIA_SELECT = {
  id: true,
  libraryId: true,
  type: true,
  title: true,
  showTitle: true,
  season: true,
  episode: true,
  year: true,
  artist: true,
  overview: true,
  genres: true,
  rating: true,
  posterPath: true,
  showPosterPath: true,
  tmdbPosterPath: true,
  tmdbBackdropPath: true,
} as const

export type ChannelNow = {
  channelId: number
  now: NowUnit | null
  next: NowUnit[]
}

/** The current program and the next `nextCount` programs on each channel. */
export async function channelsNow(channelIds: number[], nextCount = 3): Promise<ChannelNow[]> {
  const now = new Date()
  const perChannel = await Promise.all(
    channelIds.map((channelId) =>
      prisma.playoutItem.findMany({
        where: { channelId, stopTime: { gt: now } },
        orderBy: { startTime: 'asc' },
        // Enough rows to see past a station break and a few multi-part airings.
        take: 24,
        select: { kind: true, title: true, startTime: true, stopTime: true, groupKey: true, mediaItem: { select: MEDIA_SELECT } },
      }),
    ),
  )

  // Show-level TMDB data for every episode involved, in one query.
  const wanted = new Map<number, Set<string>>()
  for (const rows of perChannel)
    for (const r of rows) {
      const m = r.mediaItem
      if (m?.type === 'episode' && m.showTitle) {
        let s = wanted.get(m.libraryId)
        if (!s) wanted.set(m.libraryId, (s = new Set()))
        s.add(m.showTitle)
      }
    }
  const shows = new Map<string, ShowMeta>()
  if (wanted.size) {
    const rows = await prisma.show.findMany({
      where: { OR: [...wanted].map(([libraryId, titles]) => ({ libraryId, title: { in: [...titles] } })) },
      select: { libraryId: true, title: true, overview: true, genres: true, rating: true, tmdbPosterPath: true, tmdbBackdropPath: true },
    })
    for (const s of rows) shows.set(`${s.libraryId}\u0000${s.title}`, s)
  }
  const showFor = (u: RowForNow[]) => {
    const m = u[0].mediaItem
    return m?.showTitle ? shows.get(`${m.libraryId}\u0000${m.showTitle}`) : undefined
  }

  return channelIds.map((channelId, i) => {
    const units = groupRows(perChannel[i])
    const current = units[0] && units[0][0].startTime <= now ? units[0] : null
    const rest = current ? units.slice(1) : units
    return {
      channelId,
      now: current ? describeUnit(current, showFor(current)) : null,
      next: rest
        .filter((u) => u[0].kind !== 'filler' && u[0].mediaItem)
        .slice(0, nextCount)
        .map((u) => describeUnit(u, showFor(u))),
    }
  })
}
