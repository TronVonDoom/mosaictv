import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { prisma } from '../db.js'
import { baseUrl } from '../http.js'

export const hdhrRouter = Router()

// Plex's Live TV & DVR setup (and Emby's HDHomeRun tuner type) speak this small
// HTTP protocol — the same one Threadfin/xTeVe implement — to treat MosaicTV as
// a network tuner. There's no SSDP/UDP responder here, so MosaicTV never shows
// up in a broadcast scan; adding it means entering its address by hand.

async function tunerCount(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: 'tunerCount' } })
  const n = Number(row?.value)
  return Number.isFinite(n) && n > 0 ? n : 4
}

/**
 * Plex keys a tuner on its DeviceID and treats two devices sharing one as the
 * same tuner, so this is generated once per instance and then kept: a value
 * that changed on restart would re-register the tuner and orphan the channel
 * mapping. Eight uppercase hex digits is the shape real HDHomeRuns use.
 */
async function deviceId(): Promise<string> {
  const existing = await prisma.setting.findUnique({ where: { key: 'hdhrDeviceId' } })
  if (existing?.value) return existing.value
  const id = randomBytes(4).toString('hex').toUpperCase()
  // Concurrent first requests can race here; upsert so the first one wins and
  // the loser returns the stored value rather than a second, conflicting ID.
  const row = await prisma.setting.upsert({
    where: { key: 'hdhrDeviceId' },
    create: { key: 'hdhrDeviceId', value: id },
    update: {},
  })
  return row.value
}

hdhrRouter.get('/discover.json', async (req, res) => {
  const base = baseUrl(req)
  res.json({
    FriendlyName: 'MosaicTV',
    Manufacturer: 'Silicondust',
    ModelNumber: 'HDTC-2US',
    FirmwareName: 'hdhomeruntc_atsc',
    FirmwareVersion: '20170612',
    DeviceID: await deviceId(),
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
