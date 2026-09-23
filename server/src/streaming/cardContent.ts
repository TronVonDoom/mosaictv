// What the info card says about a program: pulled from the library and the
// playout, shaped for card.ts. "Up next" names the next program (the whole
// broadcast episode when it's a multi-part one); "Now playing" names a music
// video as it starts.

import type { MediaItem } from '@prisma/client'
import { prisma } from '../db.js'
import { posterFileFor } from '../artworkFiles.js'
import type { CardContent } from './card.js'

/**
 * An episode title without a leading episode code the library carried over
 * from the filename ("E03 - Monsters, Get Real!" → "Monsters, Get Real!"). The
 * card shows the code on its own.
 */
export function cleanEpisodeTitle(title: string): string {
  const cut = title.replace(/^\s*(?:S\d{1,3})?E\d{1,4}(?:\s*[-–+&]\s*E?\d{1,4})?\s*[-–—:.]\s+/i, '')
  return cut.trim() || title
}

/** "S1 · E4", "S1 · E4–6" across a broadcast episode, "E12" without a season. */
export function episodeCodeLabel(eps: { season: number | null; episode: number | null }[]): string | null {
  const own = eps.filter((e) => e.episode != null)
  if (own.length === 0) return null
  const first = own[0]
  const last = own[own.length - 1]
  const range =
    last.episode !== first.episode && last.season === first.season ? `E${first.episode}–${last.episode}` : `E${first.episode}`
  if (first.season == null) return range
  if (first.season === 0) return `Special · ${range}`
  return `S${first.season} · ${range}`
}

/** "1h 54m", "45m". */
export function runtimeLabel(sec: number | null | undefined): string | null {
  if (!sec || sec < 60) return null
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

/** The first couple of a comma-separated genre list. */
function genreList(genres: string | null | undefined, n = 2): string[] {
  return (genres ?? '')
    .split(',')
    .map((g) => g.trim())
    .filter(Boolean)
    .slice(0, n)
}

/** "8:30 PM" in the server's timezone (the container's TZ). */
export function clockLabel(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

async function artFor(mi: MediaItem): Promise<CardContent['art']> {
  const file = await posterFileFor(mi).catch(() => null)
  return file ? { file, shape: mi.type === 'music' ? 'square' : 'poster' } : null
}

/**
 * "Up next" for the program starting at `next`. A multi-part broadcast
 * episode (playout rows sharing a groupKey) is named as one: the host show,
 * the range of its episode codes and every segment's title.
 */
export async function upNextContent(next: {
  channelId: number
  startTime: Date
  groupKey: string | null
  mediaItem: MediaItem | null
}): Promise<CardContent | null> {
  const mi = next.mediaItem
  if (!mi) return null
  const time = clockLabel(next.startTime)

  if (mi.type === 'episode' && mi.showTitle) {
    const segs = next.groupKey
      ? (
          await prisma.playoutItem.findMany({
            where: { channelId: next.channelId, groupKey: next.groupKey },
            orderBy: { startTime: 'asc' },
            include: { mediaItem: true },
          })
        )
          .map((r) => r.mediaItem)
          .filter((m): m is MediaItem => !!m)
      : [mi]
    const host = segs.filter((s) => s.showTitle === mi.showTitle)
    const show = await prisma.show.findFirst({ where: { libraryId: mi.libraryId, title: mi.showTitle } })
    const year = show?.year ?? mi.year
    return {
      eyebrow: 'Up next',
      time,
      title: mi.showTitle,
      code: episodeCodeLabel(host.length ? host : [mi]),
      subtitle: segs.map((s) => cleanEpisodeTitle(s.title)).filter(Boolean).join(' / ') || null,
      meta: [...(year ? [String(year)] : []), ...genreList(show?.genres ?? mi.genres)],
      rating: show?.rating ?? mi.rating,
      art: await artFor(mi),
    }
  }

  if (mi.type === 'music') {
    return {
      eyebrow: 'Up next',
      time,
      title: mi.title,
      subtitle: [mi.artist, mi.album].filter(Boolean).join(' — ') || null,
      meta: mi.year ? [String(mi.year)] : [],
      art: await artFor(mi),
    }
  }

  const runtime = runtimeLabel(mi.durationSec)
  return {
    eyebrow: 'Up next',
    time,
    title: mi.title,
    meta: [...(mi.year ? [String(mi.year)] : []), ...genreList(mi.genres), ...(runtime ? [runtime] : [])],
    rating: mi.rating,
    art: await artFor(mi),
  }
}

/** "Now playing" for a music video as it starts. */
export async function nowPlayingContent(mi: MediaItem): Promise<CardContent> {
  return {
    eyebrow: 'Now playing',
    title: mi.title,
    subtitle: [mi.artist, mi.album].filter(Boolean).join(' — ') || null,
    meta: mi.year ? [String(mi.year)] : [],
    art: await artFor(mi),
  }
}
