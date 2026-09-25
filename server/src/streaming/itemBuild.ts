// Build the ffmpeg command for ONE on-air item — program, music video, or
// filler — with the full channel look (scale/pad/deinterlace, subtitle burn,
// corner watermark, "up next" / "now playing" cards, GPU decode). This is the
// per-item construction the segmenter (segmenter.ts) drives once per playout
// item; it can terminate as either an MPEG-TS pipe or on-disk HLS segments via
// the `output` argument.
//
// It builds args only — it never spawns ffmpeg or touches the response. The
// caller owns the process and deletes the returned captionFiles (the cards'
// rendered images) once the encode is done.

import fs from 'node:fs'
import path from 'node:path'
import type { Filler, Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { dataDir } from '../paths.js'
import { programLabel } from '../labels.js'
import { log } from '../logs.js'
import { hasSubtitleStream, pickAudioTrack, probeAudioLangs, probeSar } from '../ffprobe.js'
import { effectiveAudioLanguage, globalAudioLanguage } from '../audio.js'
import { nvdecIfReady } from './capabilities.js'
import type { StreamProfile } from './profile.js'
import { CARD_SCALE, DEFAULT_COMINGUP, parseComingUp, type ComingUpConfig, type WatermarkConfig } from './overlays.js'
import { cardAnchor, cardEntry, cardRect, comingUpWindows, ffmpegArgs, placeCard, type CardOverlay, type FfmpegOutput, type Segment } from './filters.js'
import { renderCard, type CardContent } from './card.js'
import { nowPlayingContent, upNextContent } from './cardContent.js'
import { activeBlockAt, activeLogo, localLogo } from './logo.js'
import { FILLER_H, FILLER_W, ensureAnimatedFiller, ensureStationIdent, fillerTurn, resolveFillerClip } from './filler.js'

// The channel shape the builder needs — timeBlocks with their collection +
// ordered filler assignments, the channel-level filler assignments, plus the
// logo/coming-up columns.
export type ChannelForBuild = Prisma.ChannelGetPayload<{
  include: {
    timeBlocks: { include: { collection: true; fillerAssignments: { include: { filler: true } } } }
    fillerAssignments: { include: { filler: true } }
  }
}>

export type PlayoutItemForBuild = Prisma.PlayoutItemGetPayload<{ include: { mediaItem: true } }>

/** The result of building one item: a ready-to-spawn encode, or an instruction
 *  to fill `durSec` with black (missing / exhausted media). The caller renders
 *  the black as an on-disk HLS segment. */
export type BuiltItem =
  | {
      kind: 'encode'
      args: string[]
      label: string
      /** The info cards' rendered images — delete once the encode is done. */
      captionFiles: string[]
      hwDecode: boolean
      mediaWidth: number
      mediaHeight: number
      /** Human-readable watermark state, for the "now airing" log line. */
      wmDesc: string
    }
  | { kind: 'black'; durSec: number; why: string; label: string }

export type BuildItemParams = {
  channelNumber: number
  channel: ChannelForBuild
  profile: StreamProfile
  enc: string
  defaultWm: WatermarkConfig
  logoPath: Map<number, string>
  logoWm: Map<number, WatermarkConfig>
  /** The default station ident: airs in breaks on a channel with no filler of its own. */
  defaultFiller: Filler | null
  item: PlayoutItemForBuild
  next: PlayoutItemForBuild | undefined
  /** The next real program, looking past any filler in between — what the
   *  up-next card names (past the rest of a broadcast episode, which this
   *  resolves itself). */
  nextProgram: PlayoutItemForBuild | undefined
  prevKind: string | undefined
  /** Seek into the media (seconds); 0 for a from-the-top item. */
  offset: number
  /** Cap the output to the item's remaining slot (seconds). */
  segDur: number
  output: FfmpegOutput
  /** Real-time meter for the input, e.g. ['-readrate','1.0', ...burst]. */
  readrate: string[]
  tag?: string
}

/**
 * Build the ffmpeg args for `item`, resuming at `offset` and capped to `segDur`.
 * Handles the full per-item look — filler pools, watermark fades across filler
 * edges, and the up-next and now-playing cards — returning args for the
 * segmenter to spawn rather than streaming them itself.
 */
export async function buildItemArgs(params: BuildItemParams): Promise<BuiltItem> {
  const { channelNumber, channel, profile, enc, defaultWm, logoPath, logoWm, defaultFiller, item, next, nextProgram, prevKind, offset, segDur, output, readrate, tag } = params

  const active = activeLogo(channel, channel.timeBlocks, logoPath, item.startTime)
  const logo = await localLogo(active.raw)
  // Per-logo watermark settings, else the global default.
  const wm = active.id != null ? logoWm.get(active.id) ?? defaultWm : defaultWm
  const midItem = offset > 1

  // The logo is hidden across filler unless asked otherwise, so ramp it down
  // into that boundary and back up out of it rather than popping.
  const thisIsFiller = item.kind === 'filler'
  const hiddenOnFiller = !wm.showOnFiller && wm.mode !== 'none'
  const edgeFade = hiddenOnFiller && !thisIsFiller ? Math.max(0, wm.fadeSeconds) : 0
  const fadeOutSec = edgeFade > 0 && next?.kind === 'filler' ? edgeFade : 0
  // Don't fade in when tuning in mid-program — there was no filler on screen.
  const fadeInSec = edgeFade > 0 && prevKind === 'filler' && !midItem ? edgeFade : 0
  const mi = item.mediaItem
  // Absolute wall-clock start of the frames we're about to emit — anchors the
  // intermittent watermark so it fires on schedule for every viewer.
  const wmEpochSec = item.startTime.getTime() / 1000 + offset

  let seg: Segment | null = null
  let label: string

  if (item.kind === 'filler' || !mi) {
    // Filler pool: the active block's assigned fillers → the channel's → the
    // default station ident → the built-in frosted/animated fallback.
    const poolBlock = activeBlockAt(channel.timeBlocks, item.startTime)
    const blockPool = poolBlock?.fillerAssignments.map((a) => a.filler) ?? []
    const channelPool = channel.fillerAssignments.map((a) => a.filler)
    const pool = blockPool.length > 0 ? blockPool : channelPool.length > 0 ? channelPool : defaultFiller ? [defaultFiller] : []
    const src = blockPool.length > 0 ? ' [block]' : channelPool.length > 0 ? ' [channel]' : defaultFiller ? ' [default]' : ''
    const poolKey = blockPool.length > 0 ? `${channel.id}:b${poolBlock?.id}` : `${channel.id}:ch`
    let clip: string | undefined
    let music: string | undefined
    let standIn = ''
    if (pool.length > 0) {
      const turn = await fillerTurn(poolKey, item.startTime.getTime(), pool.length)
      const f = pool[turn]
      const name = (x: Filler) => x.name || x.style
      // Never wait on a render here — it would eat the stream's lead. A clip
      // that isn't built yet starts building, and this break airs a stand-in
      // under the filler's own music: the next filler in the pool that's
      // already built for this logo (the channel's own look), else the ident.
      const r = await resolveFillerClip(f, logo, { channelHeight: profile.height, wait: false })
      clip = r.clip
      music = r.music
      if (!clip) {
        let by = ''
        for (let i = 1; i < pool.length && !clip; i++) {
          const other = pool[(turn + i) % pool.length]
          clip = (await resolveFillerClip(other, logo, { channelHeight: profile.height, build: false })).clip
          if (clip) by = `“${name(other)}”`
        }
        // …else the station ident, if it happens to be built for this logo.
        if (!clip && logo) clip = await ensureStationIdent(logo, profile.height, { build: false })
        if (clip && !by) by = 'the station ident'
        by ||= 'the animated ident'
        standIn = ` (${by} standing in for “${name(f)}”)`
        log('info', 'stream', `Channel ${channelNumber}: filler “${name(f)}” isn't built for this logo yet — ${by} stands in while it builds`, undefined, tag)
      }
    } else if (logo) {
      // No filler configured: the frosted-glass station ident from the
      // channel/block logo, built in the background if it has to be.
      clip = await ensureStationIdent(logo, profile.height, { wait: false })
    }
    // Last resort: the animated gradient (built at boot — the one clip worth a
    // wait, and only ever on a first boot).
    clip ??= await ensureAnimatedFiller()
    const fillerHw =
      enc === 'h264_nvenc' && clip && path.basename(clip).startsWith('filler-')
        ? await nvdecIfReady('h264')
        : false
    // Ease the sound in at the top of the break and out before the show comes
    // back, rather than cutting it mid-note. A hold airs its ident in 30s
    // chunks, so it's left alone: fading each chunk would dip every 30s.
    const hold = item.id < 0
    const audioFadeInSec = !hold && offset < 0.25 ? Math.min(0.5, segDur / 4) : 0
    const audioFadeOutSec = hold ? 0 : Math.min(1.5, segDur / 3)
    if (clip && segDur > 0.3) {
      seg = { filePath: clip, offsetSec: 0, loop: true, durationSec: segDur, hasAudio: true, logo, wmEpochSec, mediaWidth: FILLER_W, mediaHeight: FILLER_H, musicPath: music, isFiller: true, fadeInSec: 0, fadeOutSec: 0, audioFadeInSec, audioFadeOutSec, hwDecode: fillerHw }
    }
    label = `filler (${Math.round(segDur)}s)${music ? ' +music' : ''}${src}${standIn}`
    if (!clip) log('error', 'stream', `Channel ${channelNumber}: no filler clip — a ${Math.round(segDur)}s gap will play black`, undefined, tag)
  } else if (fs.existsSync(mi.path) && offset >= (mi.durationSec ?? Infinity) - 0.2) {
    // The file is shorter than the slot it was given. Seeking past its end would
    // produce nothing, so fill the rest of the slot with black instead.
    return { kind: 'black', durSec: Math.min(segDur, 10), why: `${mi.title} ran out ${offset.toFixed(1)}s in (file shorter than its slot)`, label: mi.title }
  } else if (fs.existsSync(mi.path)) {
    // Only anamorphic sources need correcting, and only a constrained watermark
    // cares — skip the probe otherwise.
    const sar = wm.constrainToMedia && wm.mode !== 'none' && logo ? await probeSar(mi.path) : 1
    const dispW = Math.round((mi.width ?? FILLER_W) * sar)
    const hwDecode = enc === 'h264_nvenc' && mi.videoCodec ? await nvdecIfReady(mi.videoCodec.toLowerCase()) : false
    const hasSubtitles = profile.burnSubtitles ? await hasSubtitleStream(mi.path) : false
    // Only worth a probe when a language is actually preferred; a file with one
    // audio track (most of them) still answers instantly from the cache.
    const audioLanguage = effectiveAudioLanguage(channel.audioLanguage, await globalAudioLanguage())
    const audioTrack =
      audioLanguage && mi.audioCodec ? pickAudioTrack(await probeAudioLangs(mi.path), audioLanguage) : 0
    seg = { filePath: mi.path, offsetSec: offset, loop: false, durationSec: segDur, hasAudio: !!mi.audioCodec, logo, wmEpochSec, mediaWidth: dispW, mediaHeight: mi.height ?? FILLER_H, isFiller: false, fadeInSec, fadeOutSec, hwDecode, hasSubtitles, audioTrack }
    label = programLabel(mi, { withTitle: true })
  } else {
    log('warn', 'stream', `Channel ${channelNumber}: media file missing, skipping`, mi.path, tag)
    label = mi.title
  }

  if (!seg) {
    return { kind: 'black', durSec: Math.min(segDur, 10), why: `no playable segment for ${label}`, label }
  }

  // Info cards, over programs only (never filler). "Up next" names the next
  // real program — a station break in between doesn't hide what comes after
  // it — and "Now playing" introduces a music video for its first ~12s, in the
  // same style and place (so moving the card off the logo moves both). Each is
  // rendered to a PNG now (deleted by the caller after the encode); one that
  // can't be built is skipped, never allowed to fail the encode.
  const cards: CardOverlay[] = []
  const cardFiles: string[] = []
  const baseScale = profile.height / 720
  const cuBlock = activeBlockAt(channel.timeBlocks, item.startTime)
  const cuJson = cuBlock?.comingUp ?? channel.comingUp
  const cu = cuJson ? parseComingUp(cuJson) : null
  const look: ComingUpConfig = cu ?? DEFAULT_COMINGUP
  const stageCard = async (what: string, content: CardContent | null, windows: { a: number; b: number }[]) => {
    if (!content || !seg || windows.length === 0) return
    try {
      const scale = baseScale * CARD_SCALE[look.size]
      const base = path.join(dataDir(), `card-${channelNumber}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
      const card = await renderCard(content, scale, base, look.style, cardAnchor(look.position))
      cardFiles.push(card.png, ...(card.mask ? [card.mask] : []))
      const at = placeCard(cardRect(seg, profile), profile, card.box, look.position, scale)
      cards.push({ card, x: at.x, y: at.y, windows, fadeSec: look.fadeSeconds, scale, from: cardEntry(look.position) })
      log('debug', 'stream', `Ch ${channelNumber} ${what} card: ${content.title}${content.subtitle ? ' — ' + content.subtitle : ''}`, `${look.style}, ${look.position}, ${windows.length} window(s)`, tag)
    } catch (e) {
      log('warn', 'stream', `Channel ${channelNumber}: could not build the ${what} card`, String((e as Error)?.stack || e), tag)
    }
  }
  if (!thisIsFiller && mi && cu?.enabled) {
    // A broadcast episode airs as several playout rows, but it's one program:
    // time the card against the whole episode (so it shows once, near its
    // end), and announce what follows it rather than its own next segment.
    let start = item.startTime.getTime()
    let stop = item.stopTime.getTime()
    let upNext = nextProgram
    if (item.groupKey) {
      const span = await prisma.playoutItem.aggregate({
        where: { channelId: item.channelId, groupKey: item.groupKey },
        _min: { startTime: true },
        _max: { stopTime: true },
      })
      start = span._min.startTime?.getTime() ?? start
      stop = span._max.stopTime?.getTime() ?? stop
      if (!upNext || upNext.groupKey === item.groupKey) {
        upNext =
          (await prisma.playoutItem.findFirst({
            where: { channelId: item.channelId, kind: 'program', mediaItemId: { not: null }, startTime: { gte: new Date(stop) } },
            orderBy: { startTime: 'asc' },
            include: { mediaItem: true },
          })) ?? undefined
      }
    }
    const encodeStart = item.startTime.getTime() + offset * 1000
    const windows = comingUpWindows(cu, {
      encodeSec: segDur,
      untilEndSec: (stop - encodeStart) / 1000,
      programSec: (stop - start) / 1000,
      intoProgramSec: (encodeStart - start) / 1000,
    })
    if (windows.length > 0 && upNext?.mediaItem) {
      await stageCard('up-next', await upNextContent(upNext).catch(() => null), windows)
    }
  }
  if (!thisIsFiller && mi?.type === 'music' && mi.title) {
    const a = Math.max(0, 1 - offset)
    const b = 13 - offset
    if (b - a > 1) await stageCard('now-playing', await nowPlayingContent(mi).catch(() => null), [{ a, b }])
  }

  const args = ffmpegArgs(seg, enc, wm, profile, cards, readrate, output)

  let wmDesc: string
  if (wm.mode === 'none' || !logo) {
    wmDesc = 'no watermark'
  } else if (wm.mode === 'intermittent') {
    const P = Math.max(1, Math.round(wm.frequencyMinutes * 60))
    const phase = Math.round(wmEpochSec) % P
    const untilOn = phase < wm.durationSeconds ? 0 : P - phase
    wmDesc = `watermark intermittent/${wm.position}${wm.constrainToMedia ? '/media-fit' : ''} — ${wm.durationSeconds}s every ${wm.frequencyMinutes}min, ${untilOn === 0 ? 'visible now' : 'next in ' + untilOn + 's'}`
  } else {
    wmDesc = `watermark ${wm.mode}/${wm.position}${wm.constrainToMedia ? '/media-fit' : ''}`
  }

  const captionFiles = cardFiles
  return { kind: 'encode', args, label, captionFiles, hwDecode: seg.hwDecode ?? false, mediaWidth: seg.mediaWidth, mediaHeight: seg.mediaHeight, wmDesc }
}
