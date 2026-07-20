// Configuration for the two burned-in overlays: the corner watermark (station
// logo) and the "coming up next" caption. Types, defaults, and the parse /
// sanitize helpers the API routes and the stream pipeline share. The filter
// graphs that render them live in filters.ts.

import { prisma } from '../db.js'

export type WatermarkConfig = {
  mode: 'permanent' | 'intermittent' | 'none'
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  widthPercent: number
  horizontalMarginPercent: number
  verticalMarginPercent: number
  opacityPercent: number
  frequencyMinutes: number
  durationSeconds: number
  // One fade length, used wherever the logo appears or disappears: the
  // intermittent cycle, and the hand-off to and from filler.
  fadeSeconds: number
  // Filler usually *is* the logo (logo wall, pulse, frosted), so a corner bug on
  // top is a second one. Off by default.
  showOnFiller: boolean
  // When true, size/position the logo relative to the actual media rectangle
  // (respecting the source aspect, e.g. 4:3 pillarboxed content) instead of the
  // full output canvas — so the watermark stays over the picture.
  constrainToMedia: boolean
}

export const DEFAULT_WATERMARK: WatermarkConfig = {
  mode: 'permanent',
  position: 'bottom-right',
  widthPercent: 10,
  horizontalMarginPercent: 4,
  verticalMarginPercent: 4,
  opacityPercent: 85,
  frequencyMinutes: 5,
  durationSeconds: 30,
  fadeSeconds: 1,
  showOnFiller: false,
  constrainToMedia: false,
}

/** Parse a stored WatermarkConfig JSON blob, filling gaps from `base`. */
export function parseWatermark(json: string | null | undefined, base: WatermarkConfig = DEFAULT_WATERMARK): WatermarkConfig {
  if (!json) return base
  try {
    return { ...base, ...(JSON.parse(json) as Partial<WatermarkConfig>) }
  } catch {
    return base
  }
}

/** Clamp an incoming (untrusted) watermark config to valid ranges/enums. */
export function sanitizeWatermark(input: unknown): WatermarkConfig {
  const wm = { ...DEFAULT_WATERMARK, ...((input as Partial<WatermarkConfig>) ?? {}) }
  const modes: WatermarkConfig['mode'][] = ['permanent', 'intermittent', 'none']
  const positions: WatermarkConfig['position'][] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
  return {
    mode: modes.includes(wm.mode) ? wm.mode : 'permanent',
    position: positions.includes(wm.position) ? wm.position : 'bottom-right',
    widthPercent: Math.max(1, Math.min(50, Number(wm.widthPercent) || 10)),
    horizontalMarginPercent: Math.max(0, Math.min(45, Number(wm.horizontalMarginPercent) || 0)),
    verticalMarginPercent: Math.max(0, Math.min(45, Number(wm.verticalMarginPercent) || 0)),
    opacityPercent: Math.max(0, Math.min(100, Number(wm.opacityPercent) || 85)),
    frequencyMinutes: Math.max(1, Number(wm.frequencyMinutes) || 5),
    durationSeconds: Math.max(1, Number(wm.durationSeconds) || 30),
    fadeSeconds: Math.max(0, Number(wm.fadeSeconds) || 0),
    showOnFiller: !!wm.showOnFiller,
    constrainToMedia: !!wm.constrainToMedia,
  }
}

export async function loadWatermark(): Promise<WatermarkConfig> {
  const s = await prisma.setting.findUnique({ where: { key: 'watermark' } })
  return parseWatermark(s?.value)
}

// ---- "Coming up next" overlay ---------------------------------------------

// A burned-in caption naming the NEXT program, shown over the current program
// during a configurable window. Never shown on filler (the schedule filler is a
// separate feature). Text is drawn with ffmpeg's drawtext, which is
// feature-detected — if unavailable the overlay is silently skipped.
export type ComingUpConfig = {
  enabled: boolean
  // Where in the current program the caption appears.
  timing: 'middle' | 'beforeEnd' | 'both'
  leadSeconds: number // beforeEnd: how long before the program ends it appears
  holdSeconds: number // how long it stays on screen
  fadeSeconds: number // fade in/out (0 = pop)
  position: 'top' | 'bottom'
  // Template with %tokens% filled from the next program:
  // %showtitle% %episodetitle% %movietitle% %title% %season% %episode% %se% %year%
  template: string
  fontSizePercent: number // caption height as a share of the frame height
  opacityPercent: number
}

export const DEFAULT_COMINGUP: ComingUpConfig = {
  enabled: false,
  timing: 'beforeEnd',
  leadSeconds: 300,
  holdSeconds: 12,
  fadeSeconds: 0.5,
  position: 'bottom',
  template: 'Coming up next: %showtitle% — %episodetitle%',
  fontSizePercent: 4,
  opacityPercent: 90,
}

/** Parse a stored ComingUpConfig JSON blob, filling gaps from the default. */
export function parseComingUp(json: string | null | undefined): ComingUpConfig {
  if (!json) return DEFAULT_COMINGUP
  try {
    return { ...DEFAULT_COMINGUP, ...(JSON.parse(json) as Partial<ComingUpConfig>) }
  } catch {
    return DEFAULT_COMINGUP
  }
}

/** Clamp an incoming (untrusted) coming-up config to valid ranges/enums. */
export function sanitizeComingUp(input: unknown): ComingUpConfig {
  const c = { ...DEFAULT_COMINGUP, ...((input as Partial<ComingUpConfig>) ?? {}) }
  const timings: ComingUpConfig['timing'][] = ['middle', 'beforeEnd', 'both']
  const num = (v: unknown, def: number, lo: number, hi: number) =>
    Math.max(lo, Math.min(hi, Number(v) || def))
  return {
    enabled: !!c.enabled,
    timing: timings.includes(c.timing) ? c.timing : 'beforeEnd',
    leadSeconds: Math.round(num(c.leadSeconds, 300, 5, 3600)),
    holdSeconds: Math.round(num(c.holdSeconds, 12, 2, 120)),
    fadeSeconds: num(c.fadeSeconds, 0.5, 0, 10),
    position: c.position === 'top' ? 'top' : 'bottom',
    // Cap length so a pathological template can't blow up the filtergraph.
    template: String(c.template ?? DEFAULT_COMINGUP.template).slice(0, 200),
    fontSizePercent: num(c.fontSizePercent, 4, 1.5, 15),
    opacityPercent: Math.round(num(c.opacityPercent, 90, 0, 100)),
  }
}
