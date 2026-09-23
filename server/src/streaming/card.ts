// The on-screen info card: "Up next" over the end of a program and "Now
// playing" at the start of a music video. A frosted-glass panel with the
// poster on the left and the title, episode and facts beside it.
//
// It's drawn once per encode as SVG and rendered to PNG with resvg, using the
// Inter faces bundled in server/assets/fonts (the web UI's typeface), so it
// looks the same on every host. Text is measured with opentype.js so a long
// title is cut at a word with an ellipsis instead of running off the card.
// ffmpeg then composites it (filters.ts): it blurs the picture behind the card
// for the glass, lays this PNG over that, and slides the whole thing in.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import opentype from 'opentype.js'
import { renderAsync, type ResvgRenderOptions } from '@resvg/resvg-js'
import type { CardStyle } from './overlays.js'

const FONT_DIR = fileURLToPath(new URL('../../assets/fonts/', import.meta.url))
const FACES = { 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold' } as const
type Weight = keyof typeof FACES
// Glyphs Inter lacks (CJK aside, which neither has) fall back to DejaVu when
// it's on disk — the image installs it.
const FALLBACK_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'

let fonts: Record<Weight, opentype.Font> | null = null
function font(w: Weight): opentype.Font {
  fonts ??= Object.fromEntries(
    Object.entries(FACES).map(([k, n]) => [k, opentype.loadSync(path.join(FONT_DIR, `Inter-${n}.ttf`))]),
  ) as Record<Weight, opentype.Font>
  return fonts[w]
}
function fontFiles(): string[] {
  const files = Object.values(FACES).map((n) => path.join(FONT_DIR, `Inter-${n}.ttf`))
  if (fs.existsSync(FALLBACK_FONT)) files.push(FALLBACK_FONT)
  return files
}

/** What the card says. Every field but the title is optional. */
export type CardContent = {
  eyebrow: string // "UP NEXT" / "NOW PLAYING"
  time?: string | null // "8:30 PM"
  title: string
  code?: string | null // "S1 · E4–6"
  subtitle?: string | null // episode title(s), or artist — album
  meta: string[] // year, genres, runtime
  rating?: number | null
  art?: { file: string; shape: 'poster' | 'square' } | null
}

export type RenderedCard = {
  /** The card and its shadow, transparent around them. */
  png: string
  /** Glass only: the panel's shape, white on black, frost-sized. */
  mask: string | null
  width: number
  height: number
  /** The part placed against the frame's edges, inside the PNG. */
  box: { x: number; y: number; w: number; h: number }
  /** Glass only: where the picture behind is frosted, inside the PNG (the box). */
  frost: { x: number; y: number; w: number; h: number } | null
}

const ACCENT = '#a78bfa' // the app's violet
const ACCENT2 = '#22d3ee' // and its cyan
const STAR = '#fbbf24'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const even = (n: number) => 2 * Math.round(n / 2)

export function textWidth(text: string, weight: Weight, size: number, letterSpacing = 0): number {
  return font(weight).getAdvanceWidth(text, size) + Math.max(0, [...text].length - 1) * letterSpacing
}

/** Cut `text` to fit `maxW` with an ellipsis, at a word boundary where one is close. */
export function fitText(text: string, weight: Weight, size: number, maxW: number, letterSpacing = 0): string {
  if (textWidth(text, weight, size, letterSpacing) <= maxW) return text
  const chars = [...text]
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (textWidth(chars.slice(0, mid).join('').trimEnd() + '…', weight, size, letterSpacing) <= maxW) lo = mid
    else hi = mid - 1
  }
  let cut = chars.slice(0, lo).join('')
  const space = cut.lastIndexOf(' ')
  if (space > cut.length * 0.6) cut = cut.slice(0, space)
  // Don't leave a dangling separator before the ellipsis.
  return cut.replace(/[\s,;:·—–\-+/&]+$/u, '') + '…'
}

function star(cx: number, cy: number, r: number): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`)
  }
  return `<polygon points="${pts.join(' ')}" fill="${STAR}"/>`
}

function imageHref(file: string): string | null {
  try {
    const buf = fs.readFileSync(file)
    const mime = buf[0] === 0x89 && buf[1] === 0x50 ? 'image/png' : buf[0] === 0x52 && buf[8] === 0x57 ? 'image/webp' : 'image/jpeg'
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

/** A rectangle inside a drawing. */
export type Box = { x: number; y: number; w: number; h: number }

/**
 * Which side a card is anchored to. A broadcast bar is drawn from that side,
 * poster first, fading away toward the middle of the picture.
 */
export type CardAnchor = 'left' | 'center' | 'right'

// A drawn card: its full size, the part that's positioned against the frame
// edges (`box` — for the bar, everything but its fading tail), whether the
// picture behind that box gets the frosted-glass treatment, and the SVG.
type Drawn = { w: number; h: number; box: Box; glass: boolean; radius: number; defs: string; body: string }

/** "meta · meta · ★ 7.6" starting at x: text plus a drawn star. */
function metaRow(x: number, b: number, lead: string, rating: string | null, size: number, opacity: number): string {
  let out = `<text x="${x}" y="${b}" font-family="Inter" font-weight="500" font-size="${size}" fill="#ffffff" fill-opacity="${opacity}">${esc(lead)}</text>`
  if (rating) {
    const lw = textWidth(lead, 500, size)
    out += star(x + lw + size * 0.45, b - size * 0.36, size * 0.48)
    out += `<text x="${x + lw + size * 1.05}" y="${b}" font-family="Inter" font-weight="600" font-size="${size}" fill="#ffffff" fill-opacity="${Math.min(1, opacity + 0.2)}">${esc(rating)}</text>`
  }
  return out
}
const metaWidth = (lead: string, rating: string | null, size: number) =>
  textWidth(lead, 500, size) + (rating ? size * 1.05 + textWidth(rating, 600, size) : 0)
const ratingText = (c: CardContent) => (c.rating != null && c.rating > 0 ? c.rating.toFixed(1) : null)
const SEP = '  ·  '
const metaLeadText = (c: CardContent, rating: string | null) => c.meta.join(SEP) + (rating && c.meta.length ? SEP : '')

/**
 * Glass: a frosted panel, the poster on the left and four lines beside it —
 * UP NEXT and the time, the title, the episode, the facts.
 */
function glassSvg(c: CardContent, s: number): Drawn {
  const PAD = 14 * s
  const R = 18 * s
  const art = c.art ? imageHref(c.art.file) : null
  const artH = 114 * s
  const artW = c.art?.shape === 'square' ? artH : 76 * s
  const TMAX = 400 * s
  const h = even(artH + PAD * 2)

  // Measure every line to size the card to its text, up to TMAX.
  const eyebrowSize = 11.5 * s
  const eyebrowLs = 1.8 * s
  const titleSize = 26 * s
  const subSize = 16 * s
  const codeSize = 12 * s
  const codeLs = 0.6 * s
  const metaSize = 13 * s

  const eyebrow = c.eyebrow.toUpperCase()
  const timeText = c.time ? `${SEP}${c.time}` : ''
  const eyebrowW = textWidth(eyebrow, 700, eyebrowSize, eyebrowLs) + textWidth(timeText, 600, eyebrowSize, eyebrowLs)
  const title = fitText(c.title, 800, titleSize, TMAX)
  const codeW = c.code ? textWidth(c.code, 700, codeSize, codeLs) + 14 * s : 0
  const subLead = c.code ? codeW + 8 * s : 0
  const subtitle = c.subtitle ? fitText(c.subtitle, 500, subSize, TMAX - subLead) : null
  const rating = ratingText(c)
  const metaLead = metaLeadText(c, rating)
  const textW = Math.min(
    TMAX,
    Math.max(
      180 * s,
      eyebrowW,
      textWidth(title, 800, titleSize),
      subLead + (subtitle ? textWidth(subtitle, 500, subSize) : 0),
      metaWidth(metaLead, rating, metaSize),
    ),
  )
  const tx = PAD + (art ? artW + 16 * s : 4 * s)
  const w = even(tx + textW + PAD + 6 * s)

  // Rows, stacked and centred in the card: [line height, gap before, draw].
  type Row = { lh: number; gap: number; draw: (base: number) => string }
  const rows: Row[] = []
  rows.push({
    lh: 14 * s,
    gap: 0,
    draw: (b) =>
      `<text x="${tx}" y="${b}" font-family="Inter" font-weight="700" font-size="${eyebrowSize}" letter-spacing="${eyebrowLs}" fill="${ACCENT}">${esc(eyebrow)}<tspan fill="#ffffff" fill-opacity="0.58" font-weight="600">${esc(timeText)}</tspan></text>`,
  })
  rows.push({
    lh: 29 * s,
    gap: 8 * s,
    draw: (b) => `<text x="${tx}" y="${b}" font-family="Inter" font-weight="800" font-size="${titleSize}" fill="#ffffff">${esc(title)}</text>`,
  })
  if (c.code || subtitle) {
    rows.push({
      lh: 20 * s,
      gap: 7 * s,
      draw: (b) => {
        let out = ''
        if (c.code) {
          out += `<rect x="${tx}" y="${b - 14 * s}" width="${codeW}" height="${19 * s}" rx="${5 * s}" fill="#ffffff" fill-opacity="0.14"/>`
          out += `<text x="${tx + 7 * s}" y="${b}" font-family="Inter" font-weight="700" font-size="${codeSize}" letter-spacing="${codeLs}" fill="#ffffff" fill-opacity="0.92">${esc(c.code)}</text>`
        }
        if (subtitle) out += `<text x="${tx + subLead}" y="${b}" font-family="Inter" font-weight="500" font-size="${subSize}" fill="#ffffff" fill-opacity="0.88">${esc(subtitle)}</text>`
        return out
      },
    })
  }
  if (metaLead || rating) {
    rows.push({ lh: 16 * s, gap: (c.code || subtitle ? 12 : 9) * s, draw: (b) => metaRow(tx, b, metaLead, rating, metaSize, 0.62) })
  }
  const stack = rows.reduce((a, r) => a + r.gap + r.lh, 0)
  let top = (h - stack) / 2
  const text = rows
    .map((r) => {
      top += r.gap
      const base = top + r.lh * 0.8 // baseline sits ~80% down the line box
      top += r.lh
      return r.draw(base)
    })
    .join('')

  const defs = `
    <linearGradient id="tint" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b1d2e" stop-opacity="0.62"/><stop offset="1" stop-color="#0b0c14" stop-opacity="0.8"/></linearGradient>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ACCENT}"/><stop offset="1" stop-color="${ACCENT2}"/></linearGradient>
    <clipPath id="panel"><rect width="${w}" height="${h}" rx="${R}"/></clipPath>
    <clipPath id="art"><rect x="${PAD}" y="${PAD}" width="${artW}" height="${artH}" rx="${9 * s}"/></clipPath>`
  const body = `
    <g clip-path="url(#panel)">
      <rect width="${w}" height="${h}" fill="url(#tint)"/>
      <rect width="${w}" height="${1.5 * s}" fill="#ffffff" fill-opacity="0.18"/>
      <rect y="${h - 3 * s}" width="${w}" height="${3 * s}" fill="url(#edge)"/>
    </g>
    <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${R - 0.5}" fill="none" stroke="#ffffff" stroke-opacity="0.14"/>
    ${
      art
        ? `<image href="${art}" x="${PAD}" y="${PAD}" width="${artW}" height="${artH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#art)"/>
    <rect x="${PAD + 0.5}" y="${PAD + 0.5}" width="${artW - 1}" height="${artH - 1}" rx="${9 * s - 0.5}" fill="none" stroke="#ffffff" stroke-opacity="0.16"/>`
        : ''
    }
    ${text}`
  return { w, h, box: { x: 0, y: 0, w, h }, glass: true, radius: R, defs, body }
}

/**
 * Broadcast: a cable-network bar. The poster stands up out of the bar, an
 * angled UP NEXT tab and the time sit on its top edge, and the bar fades out
 * toward the middle of the picture. Its outer bottom corner is rounded. On
 * the right of the picture it's mirrored — poster on the right, text set
 * right — while the tab keeps reading left to right.
 */
function broadcastSvg(c: CardContent, s: number, anchor: CardAnchor): Drawn {
  const art = c.art ? imageHref(c.art.file) : null
  const square = c.art?.shape === 'square'
  const PW = art ? (square ? 116 : 92) * s : 0
  const PH = art ? (square ? 116 : 138) * s : 0
  const BAR_H = 86 * s
  const TAB_H = 28 * s
  const LIFT = 14 * s // the poster's foot sits this far above the bar's bottom
  const barTop = Math.max(TAB_H, PH + LIFT - BAR_H)
  const barBot = barTop + BAR_H
  const h = even(barBot)
  const posterX = 18 * s
  const posterY = barBot - LIFT - PH
  const tx = art ? posterX + PW + 22 * s : 26 * s
  const TMAX = 460 * s

  const titleSize = 28 * s
  const subSize = 16 * s
  const tabSize = 13 * s
  const tabLs = 2.2 * s
  const timeLs = 1 * s
  const title = fitText(c.title, 800, titleSize, TMAX)
  // The second line: the episode and its title(s) — or for a movie, its facts.
  const subLine = [c.code, c.subtitle].filter(Boolean).join('   ') || null
  const sub = subLine ? fitText(subLine, 500, subSize, TMAX) : null
  const rating = ratingText(c)
  const metaLead = metaLeadText(c, rating)
  const secondW = sub ? textWidth(sub, 500, subSize) : metaLead || rating ? metaWidth(metaLead, rating, subSize) : 0
  const tab = c.eyebrow.toUpperCase()
  const tabW = textWidth(tab, 800, tabSize, tabLs) + 28 * s
  const timeW = c.time ? textWidth(c.time, 700, tabSize, timeLs) + 24 * s : 0
  const tabsW = tabW + (timeW ? 4 * s + timeW : 0) + 12 * s
  const contentW = Math.min(TMAX, Math.max(textWidth(title, 800, titleSize), secondW, tabsW))
  const solidW = even(tx + contentW + 36 * s)
  const tail = 120 * s
  const w = even(solidW + tail)
  const right = anchor === 'right'
  const X = (x: number) => (right ? w - x : x) // mirror a point for the right side
  const rowX = (rw: number) => (right ? w - tx - rw : tx) // where a text row of width rw starts
  const r = 20 * s
  const solid = (solidW / w).toFixed(3)
  const [gx1, gx2] = right ? [1, 0] : [0, 1]

  // The bar, square at the top (the accent line runs to its edge) and rounded
  // at its outer bottom corner.
  const bar = `M${X(0)} ${barTop} H${X(w)} V${barBot} H${X(r)} A${r} ${r} 0 0 ${right ? 0 : 1} ${X(0)} ${barBot - r} Z`
  // The tab and time chip keep their reading order; on the right they end
  // where the text column does.
  const gx = right ? w - tx - (tabW + (timeW ? 4 * s + timeW : 0)) : tx
  const para = (x0: number, width: number) =>
    `${x0 - 12 * s},${barTop} ${x0 - 12 * s + width},${barTop} ${x0 + width},${barTop - TAB_H} ${x0},${barTop - TAB_H}`
  const titleX = rowX(textWidth(title, 800, titleSize))
  const second = sub
    ? `<text x="${rowX(textWidth(sub, 500, subSize))}" y="${barTop + 66 * s}" font-family="Inter" font-weight="500" font-size="${subSize}" fill="#ffffff" fill-opacity="0.82">${esc(sub)}</text>`
    : metaLead || rating
      ? metaRow(rowX(metaWidth(metaLead, rating, subSize)), barTop + 66 * s, metaLead, rating, subSize, 0.8)
      : ''
  const px = right ? w - posterX - PW : posterX

  const defs = `
    <linearGradient id="bar" x1="${gx1}" y1="0" x2="${gx2}" y2="0"><stop offset="0" stop-color="#15123a" stop-opacity="0.95"/><stop offset="${solid}" stop-color="#171a33" stop-opacity="0.9"/><stop offset="1" stop-color="#171a33" stop-opacity="0"/></linearGradient>
    <linearGradient id="line" x1="${gx1}" y1="0" x2="${gx2}" y2="0"><stop offset="0" stop-color="${ACCENT}"/><stop offset="${solid}" stop-color="${ACCENT2}"/><stop offset="1" stop-color="${ACCENT2}" stop-opacity="0"/></linearGradient>
    <linearGradient id="tab" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${ACCENT}"/><stop offset="1" stop-color="${ACCENT2}"/></linearGradient>
    <clipPath id="bar-shape"><path d="${bar}"/></clipPath>
    <clipPath id="art"><rect x="${px}" y="${posterY}" width="${PW}" height="${PH}" rx="${6 * s}"/></clipPath>
    <filter id="lift" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="${8 * s}" stdDeviation="${10 * s}" flood-color="#000" flood-opacity="0.6"/></filter>`
  const body = `
    <path d="${bar}" fill="url(#bar)"/>
    <g clip-path="url(#bar-shape)"><rect y="${barTop}" width="${w}" height="${3 * s}" fill="url(#line)"/></g>
    <polygon points="${para(gx, tabW)}" fill="url(#tab)"/>
    <text x="${gx - 6 * s + tabW / 2}" y="${barTop - 9 * s}" text-anchor="middle" font-family="Inter" font-weight="800" font-size="${tabSize}" letter-spacing="${tabLs}" fill="#0b0b18">${esc(tab)}</text>
    ${
      timeW
        ? `<polygon points="${para(gx + tabW + 4 * s, timeW)}" fill="#15123a" fill-opacity="0.95"/>
    <text x="${gx + tabW - 2 * s + timeW / 2}" y="${barTop - 9 * s}" text-anchor="middle" font-family="Inter" font-weight="700" font-size="${tabSize}" letter-spacing="${timeLs}" fill="#ffffff" fill-opacity="0.9">${esc(c.time as string)}</text>`
        : ''
    }
    ${
      art
        ? `<rect x="${px}" y="${posterY}" width="${PW}" height="${PH}" rx="${6 * s}" fill="#000" filter="url(#lift)"/>
    <image href="${art}" x="${px}" y="${posterY}" width="${PW}" height="${PH}" preserveAspectRatio="xMidYMid slice" clip-path="url(#art)"/>`
        : ''
    }
    <text x="${titleX}" y="${barTop + 38 * s}" font-family="Inter" font-weight="800" font-size="${titleSize}" fill="#ffffff">${esc(title)}</text>
    ${second}`
  const box = right ? { x: w - solidW, y: 0, w: solidW, h } : { x: 0, y: 0, w: solidW, h }
  return { w, h, box, glass: false, radius: 0, defs, body }
}

function drawCard(c: CardContent, s: number, style: CardStyle, anchor: CardAnchor): Drawn {
  return style === 'broadcast' ? broadcastSvg(c, s, anchor) : glassSvg(c, s)
}

// Rendering takes ~50ms, and it runs at a program boundary: off the main
// thread (resvg's worker), so segment requests aren't held up meanwhile.
async function render(svg: string, extra: Partial<ResvgRenderOptions> = {}): Promise<Buffer> {
  const img = await renderAsync(svg, {
    font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: 'Inter' },
    ...extra,
  })
  return img.asPng()
}

/**
 * Render the card for ffmpeg: `<outBase>.png` (the card and its shadow) and,
 * for glass, `<outBase>-mask.png` (the panel's shape, where the picture behind
 * gets frosted). The caller deletes both after the encode.
 */
export async function renderCard(
  content: CardContent,
  scale: number,
  outBase: string,
  style: CardStyle = 'glass',
  anchor: CardAnchor = 'left',
): Promise<RenderedCard> {
  const d = drawCard(content, scale, style, anchor)
  // Room around the card for its shadow, which falls mostly downward.
  const mx = even(28 * scale)
  const mt = even(18 * scale)
  const mb = even(40 * scale)
  const W = d.w + mx * 2
  const H = d.h + mt + mb
  const box = { x: mx + d.box.x, y: mt + d.box.y, w: d.box.w, h: d.box.h }
  // Glass casts a shadow around the panel, masked out under it so it can't
  // darken the glass. The bar's only shadow is the poster's own.
  const shadow = d.glass
    ? `<mask id="outside" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${d.radius}" fill="#000"/></mask>
    <filter id="shadow" x="-30%" y="-40%" width="160%" height="200%"><feGaussianBlur stdDeviation="${14 * scale}"/></filter>`
    : ''
  const svg = `<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${d.defs}${shadow}</defs>
  ${d.glass ? `<g mask="url(#outside)"><rect x="${box.x}" y="${box.y + 10 * scale}" width="${box.w}" height="${box.h}" rx="${d.radius}" fill="#000" fill-opacity="0.55" filter="url(#shadow)"/></g>` : ''}
  <g transform="translate(${mx} ${mt})">${d.body}</g>
</svg>`
  const png = `${outBase}.png`
  fs.writeFileSync(png, await render(svg))
  if (!d.glass) return { png, mask: null, width: W, height: H, box, frost: null }
  const mask = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.w}" height="${box.h}" viewBox="0 0 ${box.w} ${box.h}"><rect width="${box.w}" height="${box.h}" fill="#000"/><rect width="${box.w}" height="${box.h}" rx="${d.radius}" fill="#fff"/></svg>`
  const maskFile = `${outBase}-mask.png`
  fs.writeFileSync(maskFile, await render(mask))
  return { png, mask: maskFile, width: W, height: H, box, frost: box }
}

/** The channel's logo, drawn where its watermark would sit — for the preview. */
export type PreviewLogo = { file: string; x: number; y: number; w: number; corner: string; opacity: number }

/**
 * The card over a still, as it will air — glass included — for the settings
 * preview, with the channel's logo where its watermark sits so a clash shows.
 * `place` puts the card's box on the WxH frame.
 */
export async function renderCardPreview(
  content: CardContent,
  scale: number,
  frame: { width: number; height: number; backdrop: string | null; outWidth?: number; logo?: PreviewLogo | null },
  style: CardStyle,
  anchor: CardAnchor,
  place: (box: { w: number; h: number }) => { x: number; y: number },
): Promise<Buffer> {
  const d = drawCard(content, scale, style, anchor)
  const at = place(d.box)
  const ox = at.x - d.box.x // where the drawing's origin lands
  const oy = at.y - d.box.y
  const { width: W, height: H } = frame
  const bg = frame.backdrop ? imageHref(frame.backdrop) : null
  const backdrop = bg
    ? `<image href="${bg}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
    : `<rect width="${W}" height="${H}" fill="url(#bgfill)"/>`
  const glass = d.glass
    ? `<rect x="${at.x}" y="${at.y + 10 * scale}" width="${d.box.w}" height="${d.box.h}" rx="${d.radius}" fill="#000" fill-opacity="0.55" filter="url(#shadow)"/>
  <g clip-path="url(#glass)"><g filter="url(#frost)">${backdrop}</g></g>`
    : ''
  // A logo sits in a square box aligned to its corner, so its own aspect
  // needn't be known.
  const lg = frame.logo
  const logoHref = lg ? imageHref(lg.file) : null
  const align = lg ? `x${lg.corner.endsWith('right') ? 'Max' : 'Min'}Y${lg.corner.startsWith('bottom') ? 'Max' : 'Min'}` : ''
  const logo =
    lg && logoHref
      ? `<image href="${logoHref}" x="${lg.x}" y="${lg.y}" width="${lg.w}" height="${lg.w}" opacity="${lg.opacity}" preserveAspectRatio="${align} meet"/>`
      : ''
  const svg = `<svg xml:space="preserve" xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${d.defs}
    <linearGradient id="bgfill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#312e81"/><stop offset="1" stop-color="#0e7490"/></linearGradient>
    <clipPath id="glass"><rect x="${at.x}" y="${at.y}" width="${d.box.w}" height="${d.box.h}" rx="${d.radius}"/></clipPath>
    <filter id="frost" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="${16 * scale}"/></filter>
    <filter id="shadow" x="-30%" y="-40%" width="160%" height="200%"><feGaussianBlur stdDeviation="${14 * scale}"/></filter>
  </defs>
  ${backdrop}
  ${logo}
  ${glass}
  <g transform="translate(${ox} ${oy})">${d.body}</g>
</svg>`
  return render(svg, frame.outWidth ? { fitTo: { mode: 'width', value: frame.outWidth } } : {})
}
