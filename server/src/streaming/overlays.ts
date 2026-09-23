// Configuration for the two burned-in overlays: the corner watermark (station
// logo) and the "coming up next" card. Types, defaults, and the parse /
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

// The "up next" card naming the NEXT program (card.ts), shown over the current
// program during a configurable window. Never shown on filler (the schedule
// filler is a separate feature).
export type ComingUpConfig = {
  enabled: boolean
  // Where in the current program the card appears.
  timing: 'middle' | 'beforeEnd' | 'both'
  leadSeconds: number // beforeEnd: how long before the program ends it appears
  holdSeconds: number // how long it stays on screen
  fadeSeconds: number // slide + fade in/out (0 = pop)
  style: CardStyle
  position: CardPosition
  size: CardSize
}

/** Glass: a frosted panel. Broadcast: a cable-network bar with a tab. */
export type CardStyle = 'glass' | 'broadcast'
export const CARD_STYLES: CardStyle[] = ['glass', 'broadcast']

/** Any edge or corner of the picture — clear of wherever the logo sits. */
export type CardPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
export const CARD_POSITIONS: CardPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

export type CardSize = 'small' | 'medium' | 'large'
/** How much a card size scales the 720p design, on top of the frame height. */
export const CARD_SCALE: Record<CardSize, number> = { small: 0.85, medium: 1, large: 1.2 }

export const DEFAULT_COMINGUP: ComingUpConfig = {
  enabled: false,
  timing: 'beforeEnd',
  leadSeconds: 300,
  holdSeconds: 12,
  fadeSeconds: 0.6,
  style: 'glass',
  position: 'bottom-left',
  size: 'medium',
}

/** A position from a config, including the two the first card version had. */
function asPosition(v: unknown): CardPosition {
  if (v === 'top') return 'top-left'
  if (v === 'bottom') return 'bottom-left'
  return CARD_POSITIONS.includes(v as CardPosition) ? (v as CardPosition) : 'bottom-left'
}

/**
 * Parse a stored ComingUpConfig JSON blob, filling gaps from the default. Run
 * through sanitizeComingUp so a config saved by an older version (with the text
 * caption's template and font size) comes back in today's shape.
 */
export function parseComingUp(json: string | null | undefined): ComingUpConfig {
  if (!json) return DEFAULT_COMINGUP
  try {
    return sanitizeComingUp(JSON.parse(json))
  } catch {
    return DEFAULT_COMINGUP
  }
}

/** Clamp an incoming (untrusted) coming-up config to valid ranges/enums. */
export function sanitizeComingUp(input: unknown): ComingUpConfig {
  const c = { ...DEFAULT_COMINGUP, ...((input as Partial<ComingUpConfig>) ?? {}) }
  const timings: ComingUpConfig['timing'][] = ['middle', 'beforeEnd', 'both']
  // Zero is a real value here ("0 = pop" for the fade), so only a missing or
  // unreadable number takes the default — `Number(v) || def` turned 0 into it.
  const num = (v: unknown, def: number, lo: number, hi: number) => {
    const n = v === '' || v == null ? NaN : Number(v)
    return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : def))
  }
  return {
    enabled: !!c.enabled,
    timing: timings.includes(c.timing) ? c.timing : 'beforeEnd',
    leadSeconds: Math.round(num(c.leadSeconds, 300, 5, 3600)),
    holdSeconds: Math.round(num(c.holdSeconds, 12, 2, 120)),
    fadeSeconds: num(c.fadeSeconds, 0.6, 0, 3),
    style: CARD_STYLES.includes(c.style) ? c.style : 'glass',
    position: asPosition(c.position),
    size: typeof c.size === 'string' && Object.hasOwn(CARD_SCALE, c.size) ? c.size : 'medium',
  }
}
