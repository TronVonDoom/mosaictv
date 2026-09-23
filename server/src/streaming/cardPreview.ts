// The up-next card's settings preview: the card a channel's next program would
// get, rendered as it airs — glass and all — over a still from what's on now,
// with the channel's logo where its watermark sits, so a card placed on top of
// the logo shows up before it's saved.

import path from 'node:path'
import { prisma } from '../db.js'
import { logosDir } from '../paths.js'
import { backdropFileFor } from '../artworkFiles.js'
import { renderCardPreview, type CardContent, type PreviewLogo } from './card.js'
import { clockLabel, upNextContent } from './cardContent.js'
import { cardAnchor, placeCard } from './filters.js'
import { activeLogo, localLogo } from './logo.js'
import { CARD_SCALE, loadWatermark, parseWatermark, type ComingUpConfig } from './overlays.js'

const W = 1280
const H = 720

/** The channel's on-screen logo right now, placed as its watermark would be. */
async function watermarkLogo(channelId: number, now: Date): Promise<PreviewLogo | null> {
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: { timeBlocks: { include: { collection: true } } },
  })
  if (!channel) return null
  const logos = await prisma.logo.findMany()
  const logoPath = new Map<number, string>(logos.map((l) => [l.id, path.join(logosDir(), l.filename)]))
  const active = activeLogo(channel, channel.timeBlocks, logoPath, now)
  const file = await localLogo(active.raw)
  if (!file) return null
  const defaultWm = await loadWatermark()
  const wm = active.id != null ? parseWatermark(logos.find((l) => l.id === active.id)?.watermark, defaultWm) : defaultWm
  if (wm.mode === 'none') return null
  // The same geometry as the stream's (filters.ts watermarkGraph), on the full
  // 16:9 frame: a box as wide as the logo, set in from the chosen corner.
  const w = Math.round((W * wm.widthPercent) / 100)
  const mx = Math.round((W * wm.horizontalMarginPercent) / 100)
  const my = Math.round((H * wm.verticalMarginPercent) / 100)
  const right = wm.position.endsWith('right')
  const bottom = wm.position.startsWith('bottom')
  return {
    file,
    x: right ? W - mx - w : mx,
    y: bottom ? H - my - w : my,
    w,
    corner: wm.position,
    opacity: Math.max(0, Math.min(1, wm.opacityPercent / 100)),
  }
}

export async function comingUpPreview(channelId: number, cfg: ComingUpConfig): Promise<Buffer> {
  const now = new Date()
  const upcoming = await prisma.playoutItem.findMany({
    where: { channelId, stopTime: { gt: now }, kind: 'program', mediaItemId: { not: null } },
    orderBy: { startTime: 'asc' },
    take: 8,
    include: { mediaItem: true },
  })
  const current = upcoming[0]
  // The program after what's on — past the rest of a broadcast episode on air.
  const next = upcoming.find((p, i) => i > 0 && (!current?.groupKey || p.groupKey !== current.groupKey))
  let content: CardContent | null = next ? await upNextContent(next).catch(() => null) : null

  // Nothing scheduled yet: any episode from the library, so the card still has
  // something real to show.
  let still = current?.mediaItem ?? null
  if (!content) {
    const n = await prisma.mediaItem.count({ where: { type: 'episode', missing: false } })
    const sample = n
      ? await prisma.mediaItem.findFirst({ where: { type: 'episode', missing: false }, skip: Math.floor(Math.random() * n) })
      : null
    if (sample) {
      content = await upNextContent({ channelId, startTime: new Date(now.getTime() + 30 * 60_000), groupKey: null, mediaItem: sample }).catch(() => null)
      still ??= sample
    }
  }
  content ??= { eyebrow: 'Up next', time: clockLabel(new Date(now.getTime() + 30 * 60_000)), title: 'Your next program', meta: [] }

  const backdrop = still ? await backdropFileFor(still).catch(() => null) : null
  const logo = await watermarkLogo(channelId, now).catch(() => null)
  const scale = CARD_SCALE[cfg.size]
  return renderCardPreview(
    content,
    scale,
    { width: W, height: H, backdrop, outWidth: 960, logo },
    cfg.style,
    cardAnchor(cfg.position),
    (box) => placeCard({ x0: 0, y0: 0, mw: W, mh: H }, { width: W, height: H }, box, cfg.position, scale),
  )
}
