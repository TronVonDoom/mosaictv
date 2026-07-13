import { Router } from 'express'
import type { Request } from 'express'
import { prisma } from '../db.js'

export const iptvRouter = Router()

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
  const fallback = `${base}/mesatztv-icon.png`
  let out = '#EXTM3U\n'
  for (const c of channels) {
    const logo = c.logoUrl || fallback
    out +=
      `#EXTINF:-1 tvg-id="${c.number}" tvg-chno="${c.number}" ` +
      `tvg-name="${escapeXml(c.name)}" tvg-logo="${escapeXml(logo)}" ` +
      `group-title="${escapeXml(c.group || 'MeSatzTV')}",${c.name}\n`
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
        select: { title: true, showTitle: true, season: true, episode: true, type: true, overview: true },
      },
    },
  })

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="MeSatzTV">\n'
  for (const c of channels) {
    xml += `  <channel id="${c.number}">\n`
    xml += `    <display-name>${escapeXml(c.name)}</display-name>\n`
    xml += `    <icon src="${escapeXml(c.logoUrl || `${base}/mesatztv-icon.png`)}" />\n`
    xml += '  </channel>\n'
  }
  for (const it of items) {
    const chno = numById.get(it.channelId)
    if (chno == null) continue
    const m = it.mediaItem
    const isEp = m.type === 'episode' && m.showTitle
    const title = isEp ? (m.showTitle as string) : m.title
    xml += `  <programme start="${xmltvTime(it.startTime)}" stop="${xmltvTime(it.stopTime)}" channel="${chno}">\n`
    xml += `    <title>${escapeXml(title)}</title>\n`
    if (isEp && m.title) xml += `    <sub-title>${escapeXml(m.title)}</sub-title>\n`
    if (m.overview) xml += `    <desc>${escapeXml(m.overview)}</desc>\n`
    if (m.type === 'episode' && m.season != null && m.episode != null) {
      xml += `    <episode-num system="onscreen">S${String(m.season).padStart(2, '0')}E${String(m.episode).padStart(2, '0')}</episode-num>\n`
      xml += `    <episode-num system="xmltv_ns">${m.season - 1}.${m.episode - 1}.0</episode-num>\n`
    }
    xml += '  </programme>\n'
  }
  xml += '</tv>\n'
  res.setHeader('Content-Type', 'application/xml')
  res.send(xml)
})
