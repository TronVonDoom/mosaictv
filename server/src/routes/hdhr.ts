import { Router } from 'express'
import { prisma } from '../db.js'
import { baseUrl } from '../http.js'
import { deviceId, friendlyName, tunerCount } from '../tuner.js'

export const hdhrRouter = Router()

// Plex's Live TV & DVR setup (and Emby's HDHomeRun tuner type) speak this small
// HTTP protocol — the same one Threadfin/xTeVe implement — to treat MosaicTV as
// a network tuner. There's no SSDP/UDP responder here, so MosaicTV never shows
// up in a broadcast scan; adding it means entering its address by hand.

hdhrRouter.get('/discover.json', async (req, res) => {
  const base = baseUrl(req)
  res.json({
    FriendlyName: await friendlyName(),
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

// Always MPEG-TS, regardless of the global stream mode. A tuner URL is a raw
// transport stream by contract — Plex GETs it and expects TS bytes, so handing
// it the shared-HLS playlist makes tuning fail with "check your antenna". The
// stream-mode setting stays a choice for the M3U, where players negotiate both.
hdhrRouter.get('/lineup.json', async (req, res) => {
  const base = baseUrl(req)
  const channels = await prisma.channel.findMany({ orderBy: { number: 'asc' } })
  res.json(
    channels
      .filter((c) => c.number != null)
      .map((c) => ({
        GuideNumber: String(c.number),
        GuideName: c.name,
        URL: `${base}/iptv/channel/${c.number}.ts`,
      })),
  )
})
