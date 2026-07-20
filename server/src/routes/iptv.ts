import { Router } from 'express'
import type { Request } from 'express'
import { prisma } from '../db.js'
import { streamChannel } from '../stream.js'

export const iptvRouter = Router()

// Live stream: GET /iptv/channel/1.ts
iptvRouter.get(/^\/channel\/(\d+)\.ts$/, (req, res) => {
  streamChannel(Number((req.params as unknown as string[])[0]), res, req).catch(() => {
    // Always close the response — a hanging one leaves the player spinning.
    if (!res.headersSent) res.status(500).end()
    else if (!res.writableEnded) res.end()
  })
})

function baseUrl(req: Request): string {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0] || req.protocol || 'http'
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host
  return `${proto}://${host}`
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// XMLTV wants "YYYYMMDDHHmmss +0000" (UTC).
function xmltvTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())} +0000`
  )
}

// M3U playlist — one entry per channel, pointing at its (future) stream URL.
iptvRouter.get('/channels.m3u', async (req, res) => {
  const channels = await prisma.channel.findMany({ orderBy: { number: 'asc' } })
  const base = baseUrl(req)
  const fallback = `${base}/mosaictv-icon.png`
  let out = '#EXTM3U\n'
  for (const c of channels) {
    if (c.number == null) continue // draft — not published
    const logo = c.logoId ? `${base}/api/logos/${c.logoId}/image` : c.logoUrl || fallback
    out +=
      `#EXTINF:-1 tvg-id="${c.number}" tvg-chno="${c.number}" ` +
      `tvg-name="${escapeXml(c.name)}" tvg-logo="${escapeXml(logo)}" ` +
      `group-title="${escapeXml(c.group || 'MosaicTV')}",${c.name}\n`
    out += `${base}/iptv/channel/${c.number}.ts\n`
  }
  res.setHeader('Content-Type', 'application/x-mpegurl')
  res.send(out)
})

// XMLTV guide — channels + programmes from the built playout.
iptvRouter.get('/xmltv.xml', async (req, res) => {
  const base = baseUrl(req)
  const channels = await prisma.channel.findMany({ orderBy: { number: 'asc' } })
  const numById = new Map(channels.map((c) => [c.id, c.number]))
  const since = new Date(Date.now() - 2 * 3600 * 1000)
  const items = await prisma.playoutItem.findMany({
    where: { stopTime: { gt: since } },
    orderBy: [{ channelId: 'asc' }, { startTime: 'asc' }],
    include: {
      mediaItem: {
        select: {
          id: true,
          title: true,
          showTitle: true,
          season: true,
          episode: true,
          type: true,
          overview: true,
          libraryId: true,
          posterPath: true,
          showPosterPath: true,
          tmdbPosterPath: true,
        },
      },
    },
  })

  // Episodes rarely carry their own TMDB art, so fall back to the show's poster.
  // Show is unique on (libraryId, title); the maps nest by those two rather than
  // joining them into one key, since a title may contain any separator.
  const wantedShows = new Map<number, Set<string>>()
  for (const it of items) {
    const m = it.mediaItem
    if (m?.type === 'episode' && m.showTitle) {
      let titles = wantedShows.get(m.libraryId)
      if (!titles) wantedShows.set(m.libraryId, (titles = new Set()))
      titles.add(m.showTitle)
    }
  }
  const showHasPoster = new Map<number, Set<string>>()
  if (wantedShows.size) {
    const shows = await prisma.show.findMany({
      where: {
        OR: [...wantedShows].map(([libraryId, titles]) => ({
          libraryId,
          title: { in: [...titles] },
        })),
      },
      select: { libraryId: true, title: true, tmdbPosterPath: true },
    })
    for (const s of shows) {
      if (!s.tmdbPosterPath) continue
      let titles = showHasPoster.get(s.libraryId)
      if (!titles) showHasPoster.set(s.libraryId, (titles = new Set()))
      titles.add(s.title)
    }
  }

  // Always point at our own artwork route rather than image.tmdb.org: guide
  // clients fetch these themselves and may have no internet access, so the
  // server downloads and caches TMDB art instead. Only emit an icon when we
  // know something is actually there, so clients aren't sent to a 404.
  function programmeIcon(m: (typeof items)[number]['mediaItem']): string | null {
    if (!m) return null
    if (m.type === 'episode' && m.showTitle) {
      const hasArt = m.showPosterPath || showHasPoster.get(m.libraryId)?.has(m.showTitle)
      return hasArt ? `${base}/api/artwork/${m.id}?type=show` : null
    }
    return m.posterPath || m.tmdbPosterPath ? `${base}/api/artwork/${m.id}?type=poster` : null
  }

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="MosaicTV">\n'
  for (const c of channels) {
    if (c.number == null) continue // draft — not published
    xml += `  <channel id="${c.number}">\n`
    xml += `    <display-name>${escapeXml(c.name)}</display-name>\n`
    xml += `    <icon src="${escapeXml(c.logoId ? `${base}/api/logos/${c.logoId}/image` : c.logoUrl || `${base}/mosaictv-icon.png`)}" />\n`
    xml += '  </channel>\n'
  }
  for (const it of items) {
    const chno = numById.get(it.channelId)
    if (chno == null) continue
    const m = it.mediaItem
    const isEp = !!m && m.type === 'episode' && !!m.showTitle
    const title = !m ? (it.title || 'Station ID') : isEp ? (m.showTitle as string) : m.title
    xml += `  <programme start="${xmltvTime(it.startTime)}" stop="${xmltvTime(it.stopTime)}" channel="${chno}">\n`
    xml += `    <title>${escapeXml(title)}</title>\n`
    if (isEp && m && m.title) xml += `    <sub-title>${escapeXml(m.title)}</sub-title>\n`
    if (m && m.overview) xml += `    <desc>${escapeXml(m.overview)}</desc>\n`
    const icon = programmeIcon(m)
    if (icon) xml += `    <icon src="${escapeXml(icon)}" />\n`
    if (m && m.type === 'episode' && m.season != null && m.episode != null) {
      xml += `    <episode-num system="onscreen">S${String(m.season).padStart(2, '0')}E${String(m.episode).padStart(2, '0')}</episode-num>\n`
      xml += `    <episode-num system="xmltv_ns">${m.season - 1}.${m.episode - 1}.0</episode-num>\n`
    }
    xml += '  </programme>\n'
  }
  xml += '</tv>\n'
  res.setHeader('Content-Type', 'application/xml')
  res.send(xml)
})
