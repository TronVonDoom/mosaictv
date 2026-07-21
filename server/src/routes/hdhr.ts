import { Router } from 'express'
import type { Request } from 'express'
import { prisma } from '../db.js'

export const hdhrRouter = Router()

// Plex's Live TV & DVR setup (and Emby/Jellyfin's HDHomeRun tuner type) speak
// this small HTTP protocol — the same one Threadfin/xTeVe implement — to
// treat MosaicTV as a network tuner. No UDP/SSDP broadcast is needed: Plex's
// "enter the IP manually" option is enough once these three endpoints exist.
function baseUrl(req: Request): string {
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0] || req.protocol || 'http'
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host
  return `${proto}://${host}`
}

async function tunerCount(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: 'tunerCount' } })
  const n = Number(row?.value)
  return Number.isFinite(n) && n > 0 ? n : 4
}

hdhrRouter.get('/discover.json', async (req, res) => {
  const base = baseUrl(req)
  res.json({
    FriendlyName: 'MosaicTV',
    Manufacturer: 'Silicondust',
    ModelNumber: 'HDTC-2US',
    FirmwareName: 'hdhomeruntc_atsc',
    FirmwareVersion: '20170612',
    DeviceID: '5344544D',
    DeviceAuth: 'mosaictv',
    BaseURL: base,
    LineupURL: `${base}/lineup.json`,
    TunerCount: await tunerCount(),
  })
})

hdhrRouter.get('/lineup_status.json', (_req, res) => {
  res.json({ ScanInProgress: 0, ScanPossible: 0, Source: 'Cable', SourceList: ['Cable'] })
})

// Real tuners scan for channels on POST; there's nothing to scan here since
// the lineup always reflects the current channel list. Just acknowledge it.
hdhrRouter.post('/lineup.post', (_req, res) => {
  res.status(200).end()
})

hdhrRouter.get('/lineup.json', async (req, res) => {
  const base = baseUrl(req)
  const channels = await prisma.channel.findMany({ orderBy: { number: 'asc' } })
  const modeRow = await prisma.setting.findUnique({ where: { key: 'streamMode' } })
  const hls = modeRow?.value === 'hls'
  res.json(
    channels
      .filter((c) => c.number != null)
      .map((c) => ({
        GuideNumber: String(c.number),
        GuideName: c.name,
        URL: hls ? `${base}/iptv/channel/${c.number}/index.m3u8` : `${base}/iptv/channel/${c.number}.ts`,
      })),
  )
})
