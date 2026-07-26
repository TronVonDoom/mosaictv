// Build the ffmpeg command for ONE on-air item — program, music video, or
// filler — with the full channel look (scale/pad/deinterlace, subtitle burn,
// corner watermark, coming-up caption, song chyron, GPU decode). This is the
// per-item construction the segmenter (segmenter.ts) drives once per playout
// item; it can terminate as either an MPEG-TS pipe or on-disk HLS segments via
// the `output` argument.
//
// It builds args only — it never spawns ffmpeg or touches the response. The
// caller owns the process and (for captions) deletes the returned captionFiles
// once ffmpeg has read them.

import fs from 'node:fs'
import path from 'node:path'
import type { Prisma } from '@prisma/client'
import { dataDir } from '../paths.js'
import { programLabel } from '../labels.js'
import { log } from '../logs.js'
import { hasSubtitleStream, probeSar } from '../ffprobe.js'
import { detectTextOverlay, nvdecIfReady } from './capabilities.js'
import type { StreamProfile } from './profile.js'
import { parseComingUp, type WatermarkConfig } from './overlays.js'
import {
  comingUpFilter,
  comingUpWindows,
  ffmpegArgs,
  renderComingUpText,
  renderSongText,
  songChyronFilter,
  type FfmpegOutput,
  type Segment,
} from './filters.js'
import { activeBlockAt, activeLogo, localLogo } from './logo.js'
import { FILLER_H, FILLER_W, ensureAnimatedFiller, ensureFrostedFiller, resolveFillerClip } from './filler.js'

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
      /** Per-segment caption/chyron text files — delete after ffmpeg has started. */
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
  item: PlayoutItemForBuild
  next: PlayoutItemForBuild | undefined
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
 * edges, coming-up caption, and the music-video chyron — returning args for the
 * segmenter to spawn rather than streaming them itself.
 */
export async function buildItemArgs(params: BuildItemParams): Promise<BuiltItem> {
  const { channelNumber, channel, profile, enc, defaultWm, logoPath, logoWm, item, next, prevKind, offset, segDur, output, readrate, tag } = params

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
    const genStart = Date.now()
    // Filler pool: the active block's assigned fillers → the channel's → the
    // built-in frosted/animated fallback.
    const poolBlock = activeBlockAt(channel.timeBlocks, item.startTime)
    const blockPool = poolBlock?.fillerAssignments.map((a) => a.filler) ?? []
    const channelPool = channel.fillerAssignments.map((a) => a.filler)
    const pool = blockPool.length > 0 ? blockPool : channelPool
    const src = blockPool.length > 0 ? ' [block]' : channelPool.length > 0 ? ' [channel]' : ''
    let clip: string | undefined
    let music: string | undefined
    if (pool.length > 0) {
      const f = pool[Math.floor(item.startTime.getTime() / 1000) % pool.length]
      const r = await resolveFillerClip(f, logo)
      clip = r.clip
      music = r.music
    } else {
      // No filler configured: default to the frosted-glass station ident built
      // from the channel/block logo, falling back to the animated gradient.
      clip =
        (logo ? await ensureFrostedFiller(logo).catch(() => undefined) : undefined) ??
        (await ensureAnimatedFiller())
    }
    const genMs = Date.now() - genStart
    if (genMs > 500) log('warn', 'system', `Channel ${channelNumber}: filler resolve blocked ${genMs}ms (should be pre-warmed)`, undefined, tag)
    const fillerHw =
      enc === 'h264_nvenc' && clip && path.basename(clip).startsWith('filler-')
        ? await nvdecIfReady('h264')
        : false
    if (clip && segDur > 0.3) {
      seg = { filePath: clip, offsetSec: 0, loop: true, durationSec: segDur, hasAudio: true, logo, wmEpochSec, mediaWidth: FILLER_W, mediaHeight: FILLER_H, musicPath: music, isFiller: true, fadeInSec: 0, fadeOutSec: 0, hwDecode: fillerHw }
    }
    label = `filler (${Math.round(segDur)}s)${music ? ' +music' : ''}${src}`
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
    seg = { filePath: mi.path, offsetSec: offset, loop: false, durationSec: segDur, hasAudio: !!mi.audioCodec, logo, wmEpochSec, mediaWidth: dispW, mediaHeight: mi.height ?? FILLER_H, isFiller: false, fadeInSec, fadeOutSec, hwDecode, hasSubtitles }
    label = programLabel(mi, { withTitle: true })
  } else {
    log('warn', 'stream', `Channel ${channelNumber}: media file missing, skipping`, mi.path, tag)
    label = mi.title
  }

  if (!seg) {
    return { kind: 'black', durSec: Math.min(segDur, 10), why: `no playable segment for ${label}`, label }
  }

  // Coming-up-next caption: over a program (never filler), only when the next
  // item is a real program with metadata. Text is written to a per-segment file
  // (cleaned up by the caller) so titles with quotes/colons/% can't break the
  // filtergraph.
  let textFilter: string | undefined
  let captionFile: string | undefined
  const songFiles: string[] = []
  if (!thisIsFiller && next?.kind === 'program' && next.mediaItem) {
    const cuBlock = activeBlockAt(channel.timeBlocks, item.startTime)
    const cuJson = cuBlock?.comingUp ?? channel.comingUp
    const cu = cuJson ? parseComingUp(cuJson) : null
    const support = cu?.enabled ? await detectTextOverlay() : null
    if (cu && support) {
      const text = renderComingUpText(cu.template, next.mediaItem)
      const itemDur = (item.stopTime.getTime() - item.startTime.getTime()) / 1000
      const windows = comingUpWindows(cu, segDur, itemDur, offset)
      if (text && windows.length > 0) {
        captionFile = path.join(dataDir(), `caption-${channelNumber}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
        try {
          fs.writeFileSync(captionFile, text)
          textFilter = comingUpFilter(cu, support.font, captionFile, windows, profile) ?? undefined
          if (textFilter) log('debug', 'stream', `Ch ${channelNumber} coming-up caption: "${text}"`, `${windows.length} window(s)`, tag)
        } catch (e) {
          log('warn', 'stream', `Channel ${channelNumber}: could not stage coming-up caption`, String(e), tag)
          captionFile = undefined
        }
      }
    }
  }
  // Song chyron: while a music video plays, show a lower-third with its
  // title/artist for the item's first ~12s (relative to item start).
  if (!thisIsFiller && mi?.type === 'music') {
    const support = await detectTextOverlay()
    const a = Math.max(0, 1 - offset)
    const b = 13 - offset
    if (support && mi.title && b - a > 0.5) {
      const { title, sub } = renderSongText(mi)
      const stage = (kind: string, text: string) => {
        const f = path.join(dataDir(), `caption-song-${kind}-${channelNumber}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
        fs.writeFileSync(f, text)
        songFiles.push(f)
        return f
      }
      try {
        const titleFile = stage('t', title)
        const subFile = sub ? stage('s', sub) : null
        const chyron = songChyronFilter(support.font, titleFile, subFile, a, b, profile)
        if (chyron) {
          textFilter = textFilter ? `${textFilter},${chyron}` : chyron
          log('debug', 'stream', `Ch ${channelNumber} song chyron: "${title}${sub ? ' — ' + sub : ''}"`, undefined, tag)
        }
      } catch (e) {
        log('warn', 'stream', `Channel ${channelNumber}: could not stage song chyron`, String(e), tag)
      }
    }
  }

  const args = ffmpegArgs(seg, enc, wm, profile, textFilter, readrate, output)

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

  const captionFiles = [captionFile, ...songFiles].filter((f): f is string => !!f)
  return { kind: 'encode', args, label, captionFiles, hwDecode: seg.hwDecode ?? false, mediaWidth: seg.mediaWidth, mediaHeight: seg.mediaHeight, wmDesc }
}
