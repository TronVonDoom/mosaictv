import { Router } from 'express'
import type { Request } from 'express'
import { prisma } from '../db.js'
import { streamChannel } from '../streaming/channel.js'
import { ensureHls, touchHls, hlsPlaylistFile, hlsSegmentFile } from '../hls.js'
import { episodeCode } from '../labels.js'
import { baseUrl } from '../http.js'
import { clientName } from '../sessions.js'

export const iptvRouter = Router()

const clientIp = (req: Request) => (req.socket.remoteAddress ?? '') || undefined

// Live stream (per-client MPEG-TS): GET /iptv/channel/1.ts
iptvRouter.get(/^\/channel\/(\d+)\.ts$/, (req, res) => {
  streamChannel(Number((req.params as unknown as string[])[0]), res, req).catch(() => {
    // Always close the response — a hanging one leaves the player spinning.
    if (!res.headersSent) res.status(500).end()
    else if (!res.writableEnded) res.end()
  })
})

// Shared HLS (one transcode per channel, many viewers): the playlist starts the
// channel's encoder on demand; segments are served straight off disk.
// GET /iptv/channel/1/index.m3u8  and  /iptv/channel/1/seg_N.ts
iptvRouter.get(/^\/channel\/(\d+)\/index\.m3u8$/, async (req, res) => {
  const n = Number((req.params as unknown as string[])[0])
  try {
    const status = await ensureHls(n, clientIp(req), clientName(req))
    if (status === 'unavailable') return res.status(409).end() // missing / nothing scheduled
    if (status === 'starting') {
      res.setHeader('Retry-After', '2')
      return res.status(503).end() // encoder warming up — the player will retry
    }
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
    res.setHeader('Cache-Control', 'no-cache, no-store')
    res.sendFile(hlsPlaylistFile(n))
  } catch {
    if (!res.headersSent) res.status(500).end()
  }
})

iptvRouter.get(/^\/channel\/(\d+)\/(seg_\d+\.ts)$/, (req, res) => {
  const params = req.params as unknown as string[]
  const n = Number(params[0])
  const file = hlsSegmentFile(n, params[1])
  if (!file) return res.status(404).end()
  touchHls(n, clientIp(req), clientName(req))
  res.setHeader('Content-Type', 'video/mp2t')
  res.setHeader('Cache-Control', 'no-cache, no-store')
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) res.status(404).end()
  })
})

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
  // Global output mode: 'hls' (shared, one transcode per channel) or 'mpegts'
  // (per-client). The stream URL each channel advertises depends on it.
  const modeRow = await prisma.setting.findUnique({ where: { key: 'streamMode' } })
  const hls = modeRow?.value === 'hls'
  let out = '#EXTM3U\n'
  for (const c of channels) {
    if (c.number == null) continue // draft — not published
    const logo = c.logoId ? `${base}/api/logos/${c.logoId}/image` : c.logoUrl || fallback
    out +=
      `#EXTINF:-1 tvg-id="${c.number}" tvg-chno="${c.number}" ` +
      `tvg-name="${escapeXml(c.name)}" tvg-logo="${escapeXml(logo)}" ` +
      `group-title="${escapeXml(c.group || 'MosaicTV')}",${c.name}\n`
    out += hls ? `${base}/iptv/channel/${c.number}/index.m3u8\n` : `${base}/iptv/channel/${c.number}.ts\n`
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
          artist: true,
          album: true,
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
  let i = 0
  while (i < items.length) {
    const it = items[i]
    const chno = numById.get(it.channelId)
    if (chno == null) {
      i++
      continue
    }

    // A multi-part airing is scheduled as consecutive items sharing a groupKey.
    // Collapse the run into ONE programme spanning the whole block, with each
    // segment listed in the description — matching how it aired.
    let run = 1
    if (it.groupKey) {
      while (
        i + run < items.length &&
        items[i + run].channelId === it.channelId &&
        items[i + run].groupKey === it.groupKey
      )
        run++
    }

    if (run > 1) {
      const segments = items.slice(i, i + run)
      const last = segments[run - 1]
      const m = it.mediaItem // the first segment stands in for the airing (show, art)
      const showName = m?.showTitle || it.title || 'Program'
      const lines = segments
        .map((s) => {
          const sm = s.mediaItem
          if (!sm) return ''
          const code = sm.season != null && sm.episode != null ? episodeCode(sm) : ''
          return `${code ? `${code} — ` : ''}${sm.title}`
        })
        .filter(Boolean)
      xml += `  <programme start="${xmltvTime(it.startTime)}" stop="${xmltvTime(last.stopTime)}" channel="${chno}">\n`
      xml += `    <title>${escapeXml(showName)}</title>\n`
      if (lines.length) {
        xml += `    <sub-title>${escapeXml(lines.join(' • '))}</sub-title>\n`
        xml += `    <desc>${escapeXml(`Aired as ${lines.length} segments:\n${lines.join('\n')}`)}</desc>\n`
      }
      const icon = programmeIcon(m)
      if (icon) xml += `    <icon src="${escapeXml(icon)}" />\n`
      if (m && m.season != null && m.episode != null) {
        xml += `    <episode-num system="onscreen">${episodeCode(m)}</episode-num>\n`
        xml += `    <episode-num system="xmltv_ns">${m.season - 1}.${m.episode - 1}.0</episode-num>\n`
      }
      xml += '  </programme>\n'
      i += run
      continue
    }

    const m = it.mediaItem
    const isEp = !!m && m.type === 'episode' && !!m.showTitle
    const isMusic = !!m && m.type === 'music'
    // Music: "Artist – Title" as the title, album as the sub-title. Episodes:
    // show name as the title, episode name as the sub-title.
    const title = !m
      ? it.title || 'Station ID'
      : isMusic && m.artist
        ? `${m.artist} – ${m.title}`
        : isEp
          ? (m.showTitle as string)
          : m.title
    xml += `  <programme start="${xmltvTime(it.startTime)}" stop="${xmltvTime(it.stopTime)}" channel="${chno}">\n`
    xml += `    <title>${escapeXml(title)}</title>\n`
    if (isEp && m && m.title) xml += `    <sub-title>${escapeXml(m.title)}</sub-title>\n`
    else if (isMusic && m && m.album) xml += `    <sub-title>${escapeXml(m.album)}</sub-title>\n`
    if (isMusic) xml += `    <category>Music</category>\n`
    if (m && m.overview) xml += `    <desc>${escapeXml(m.overview)}</desc>\n`
    const icon = programmeIcon(m)
    if (icon) xml += `    <icon src="${escapeXml(icon)}" />\n`
    if (m && m.type === 'episode' && m.season != null && m.episode != null) {
      xml += `    <episode-num system="onscreen">${episodeCode(m)}</episode-num>\n`
      xml += `    <episode-num system="xmltv_ns">${m.season - 1}.${m.episode - 1}.0</episode-num>\n`
    }
    xml += '  </programme>\n'
    i++
  }
  xml += '</tv>\n'
  res.setHeader('Content-Type', 'application/xml')
  res.send(xml)
})
