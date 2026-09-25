// Station-ID filler: the generated ident styles (frosted glass, spotlight, and
// the retired animated / logo wall / pulse / retro / vintage looks), the on-disk
// cache that keeps a break from ever waiting on generation, resolution of a
// Filler row to a playable clip, which filler a break airs, and single-frame
// still previews.

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { prisma } from '../db.js'
import { assetsDir, dataDir, logosDir, previewsDir } from '../paths.js'
import { log } from '../logs.js'
import { runFfmpeg, type ProgressCb } from './run.js'
import { localLogo, logoFileById, logoFor } from './logo.js'
import { resolveProfile } from './profile.js'

export type { ProgressCb }

// Nominal 16:9 canvas. The stream reports these as the filler's source dims for
// its aspect-relative watermark math (see channel.ts) regardless of the actual
// render resolution — every option below is 16:9, so the aspect is unchanged.
export const FILLER_W = 1280
export const FILLER_H = 720
const FPS = 30

// Pixel dimensions per resolution choice. Playback scales the clip to the
// channel profile, so a higher source is only about staying crisp — 1080p keeps
// a filler sharp on a Full-HD channel where a 720p clip would upscale and soften.
export type Dims = { w: number; h: number }
const RESOLUTIONS: Record<string, Dims> = {
  '720p': { w: 1280, h: 720 },
  '1080p': { w: 1920, h: 1080 },
  '1440p': { w: 2560, h: 1440 },
}
/** Every resolution a filler can ask for; "auto" is Match channel. */
export const FILLER_RESOLUTIONS = ['auto', ...Object.keys(RESOLUTIONS)]

/**
 * A filler's render size. "auto" matches the channel it airs on: the smallest
 * size at least as tall as the channel's picture (1440p at most), so a 720p
 * channel doesn't pay for a 1080p render it scales straight back down.
 * `channelHeight` is unknown only for a preview with no channel to go by.
 */
export function dimsFor(resolution: string | null | undefined, channelHeight?: number): Dims {
  if (resolution !== 'auto') return RESOLUTIONS[resolution ?? ''] ?? RESOLUTIONS['1080p']
  if (!channelHeight) return RESOLUTIONS['1080p']
  return Object.values(RESOLUTIONS).find((d) => d.h >= channelHeight) ?? RESOLUTIONS['1440p']
}

const clampScale = (s: number) => Math.max(0.4, Math.min(2, Number.isFinite(s) ? s : 1))

// ── Seamless loops ──────────────────────────────────────────────────────────
// A break lasts as long as the schedule leaves, so the stream loops the clip to
// fill it. Every moving part of a generated style therefore completes a whole
// number of cycles over the clip: its last frame runs straight into its first,
// and a long break never shows a jump. (Music isn't part of the clip at all —
// it's laid over the break as it airs, so a song plays straight through.)

// The loop every style but frosted uses. Frosted's far lights drift too slowly
// to come back round in 30s, so it takes the length they need.
const LOOP_SEC = 30

// The nearest period to `period` that repeats a whole number of times in `loop`.
const fitPeriod = (period: number, loop: number) => loop / Math.max(1, Math.round(loop / period))

// Single-frame preview timing: grab a frame once the animation has settled.
const STILL_AT = 1.5

// Fit a foreground logo inside a maxW×maxH box, preserving aspect and never
// upscaling past its native size (both dims are min'd against the source, so a
// tiny logo stays crisp). Capping the WIDTH — not just the height — is what
// keeps a short, wide wordmark from ballooning to fill its half of the frame:
// with only a height cap, a wide logo hits the frame edge long before that
// height and reads as huge. Width leads; height is the ceiling for tall marks.
function logoBox(maxW: number, maxH: number): string {
  return `scale='min(iw,${Math.round(maxW)})':'min(ih,${Math.round(maxH)})':force_original_aspect_ratio=decrease`
}

// ── Style builds ────────────────────────────────────────────────────────────
// Each style returns the VIDEO inputs and the filter graph that produces the
// final [v]. Audio and the output leg are added by the assemblers, so the exact
// same graph backs both the full clip and its single-frame still preview.

type StyleBuild = {
  inputs: string[] // ffmpeg -i groups for video sources, in order ([0:v], [1:v], …)
  filter: string // -filter_complex producing [v]
  tone: number // the soft sine a clip carries when the filler has no music
  vol: number
}

// The gradients source turns its colour points `speed` radians a frame. The
// speed is nudged so they make whole turns over the loop. `rate` defaults to the
// source's 25 fps (which the 30 fps output duplicates up to); a style that
// scrolls passes FPS so its motion doesn't stutter.
function gradientInput(dims: Dims, loop: number, speed: number, colors: string, rate = 25): string[] {
  const frames = Math.round(loop * rate)
  const turns = Math.max(1, Math.round((speed * frames) / (2 * Math.PI)))
  const s = ((2 * Math.PI * turns) / frames).toFixed(6)
  return ['-f', 'lavfi', '-i', `gradients=s=${dims.w}x${dims.h}:r=${rate}:d=${loop}:speed=${s}:${colors}:nb_colors=4`]
}

// Preferred generic look: a drifting color gradient with a slow hue sway,
// animated grain and a vignette. The hue sways once over the loop.
function animatedBuild(dims: Dims, loop: number): StyleBuild {
  return {
    inputs: gradientInput(dims, loop, 0.05, 'c0=0x0b1020:c1=0x3b1d60:c2=0x1e3a8a:c3=0x0e7490'),
    filter: `[0:v]hue=H='0.5*sin(2*PI*t/${loop})':s='1.05+0.05*sin(2*PI*t/${loop})',noise=alls=6:allf=t,vignette=PI/4.5,fps=${FPS},format=yuv420p[v]`,
    tone: 110,
    vol: 0.05,
  }
}

// Proven fallback (the original) in case a filter isn't available on this build.
function basicBuild(dims: Dims, loop: number): StyleBuild {
  return {
    inputs: gradientInput(dims, loop, 0.02, 'c0=0x111827:c1=0x4c1d95:c2=0x1e3a8a:c3=0x0e7490'),
    filter: `[0:v]fps=${FPS},format=yuv420p[v]`,
    tone: 98,
    vol: 0.06,
  }
}

// Retro test bars: classic SMPTE color bars with soft analog grain + vignette.
function retroBuild(dims: Dims, loop: number): StyleBuild {
  return {
    inputs: ['-f', 'lavfi', '-i', `smptehdbars=s=${dims.w}x${dims.h}:d=${loop}`],
    filter: `[0:v]noise=alls=10:allf=t,vignette=PI/5,fps=${FPS},format=yuv420p[v]`,
    tone: 440,
    vol: 0.04,
  }
}

// Vintage film: warm sepia drift with heavy grain and a strong vignette.
function vintageBuild(dims: Dims, loop: number): StyleBuild {
  return {
    inputs: gradientInput(dims, loop, 0.03, 'c0=0x2b1a0c:c1=0x4a3018:c2=0x1c1108:c3=0x5a4526'),
    filter: `[0:v]hue=s=0.35,noise=alls=16:allf=t+u,vignette=PI/3.8,fps=${FPS},format=yuv420p[v]`,
    tone: 82,
    vol: 0.05,
  }
}

// Logo wall: dim rows of the logo scrolling in alternating directions over a
// dark gradient, with a sharp logo centered in front. Geometry scales with the
// canvas height (k) so it looks the same at any resolution.
function logowallGraph(dims: Dims, scale: number, loop: number): string {
  const { w: W, h: H } = dims
  const k = H / 720
  const rowH = Math.round(90 * k)
  const cellW = Math.round(260 * k)
  // Whole cells over the loop, near 40px/s at 720p.
  const speed = ((cellW * Math.max(1, Math.round((40 * k * loop) / cellW))) / loop).toFixed(4)
  const y = (r: number) => Math.round(r * 180 * k + 45 * k) // 4 rows across the height
  const leftX = `x='-mod(t*${speed},${cellW})'`
  const rightX = `x='mod(t*${speed},${cellW})-${cellW}'`
  return [
    `[0:v]format=rgba[bg]`,
    `[1:v]split=2[wall][fgin]`,
    `[wall]scale=${cellW}:${rowH}:force_original_aspect_ratio=decrease,pad=${cellW}:${rowH}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,colorchannelmixer=aa=0.16,tile=8x1,split=4[t0][t1][t2][t3]`,
    `[bg][t0]overlay=${leftX}:y=${y(0)}[o0]`,
    `[o0][t1]overlay=${rightX}:y=${y(1)}[o1]`,
    `[o1][t2]overlay=${leftX}:y=${y(2)}[o2]`,
    `[o2][t3]overlay=${rightX}:y=${y(3)}[o3]`,
    `[fgin]${logoBox(W, 200 * k * scale)},format=rgba[fg]`,
    `[o3][fg]overlay=x=(W-w)/2:y=(H-h)/2,fps=${FPS},format=yuv420p[v]`,
  ].join(';')
}

// Logo pulse: the logo centered on a dark gradient whose brightness breathes.
function pulseGraph(dims: Dims, scale: number, loop: number): string {
  const { w: W, h: H } = dims
  const k = H / 720
  return [
    `[0:v]eq=brightness='0.07*sin(2*PI*t/${fitPeriod(6, loop)})':eval=frame,fps=${FPS}[bg]`,
    `[1:v]${logoBox(W, 220 * k * scale)},format=rgba[fg]`,
    `[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2,format=yuv420p[v]`,
  ].join(';')
}

// The frosted scene is built at half size (see frostedGraph).
const frostedBackDims = (dims: Dims): Dims => ({ w: Math.round(dims.w / 4) * 2, h: Math.round(dims.h / 4) * 2 })

// The rows of logos behind the glass: their cell width and the whole number of
// pixels they move a frame (so they glide evenly instead of in the uneven
// 1-2-1-2 steps a fractional speed rounds to), both on the half-size scene.
function frostedRows(dims: Dims) {
  const { w, h } = frostedBackDims(dims)
  const kh = h / 720
  return { w, h, kh, cellW: Math.round(260 * kh), step: Math.max(1, Math.round((55 * kh) / FPS)) }
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

// Frosted loops over about two minutes. The rows come back round every few
// seconds, but the far lights rise slowly enough that anything shorter would
// mean speeding them up. The length is a whole number of row cycles — a cycle
// is fixed, since the rows move a whole number of pixels a frame.
function frostedLoopFrames(dims: Dims): number {
  const { cellW, step } = frostedRows(dims)
  const cycle = cellW / gcd(cellW, step)
  return cycle * Math.max(1, Math.round((120 * FPS) / cycle))
}

// How long a style's clip is: one seamless loop.
const loopSecFor = (style: string, dims: Dims): number => (style === 'frosted' ? frostedLoopFrames(dims) / FPS : LOOP_SEC)

// A fixed pseudo-random sequence, so every render lays the lights out the same.
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

// Out-of-focus lights drifting upward behind the glass, at three depths: far
// ones small, faint and slow; near ones large and quicker, passing in front of
// the logo rows. Their parallax is what gives the scene depth.
const ORB_COLORS = ['0x8b5cf6', '0x6366f1', '0x22d3ee', '0xec4899', '0xa78bfa', '0x38bdf8']
const ORB_DEPTHS = [
  { n: 8, size: [50, 90], alpha: [0.3, 0.45], rise: [5, 8] }, // far
  { n: 5, size: [110, 170], alpha: [0.3, 0.42], rise: [10, 15] }, // mid
  { n: 3, size: [230, 320], alpha: [0.16, 0.24], rise: [18, 26] }, // near, in front of the rows
]

// Frosted-glass scene: rows of the channel + MosaicTV logos scrolling opposite
// ways behind frosted glass, with lights drifting up behind them. In front, the
// channel logo is centered on the left and the MosaicTV logo on the right, each
// floating on a soft shadow; `divider` adds a seam between the two halves.
//
// The glass is what makes it read as glass rather than a blur: a light frost
// that leaves the logos behind recognisable, a more heavily frosted band behind
// the foreground logos (like the etched strip on a glass door), a fixed ripple
// the rows slide through, a glow where bright shapes scatter light, a fine
// grain, reflections and a sweeping glint on the surface.
//
// Inputs: [0] the background gradient at frostedBackDims (only its first frame
// is used), [1] the channel logo and [2] the MosaicTV mark, each a single frame.
//
// `loopSec` is the clip's length (frostedLoopFrames): the rows, the lights, their
// sway and the glint all come back to where they started at the end of it.
function frostedGraph(dims: Dims, scale: number, divider: boolean, loopSec: number): string {
  const { w: W, h: H } = dims
  const k = H / 720
  const f = (n: number) => n.toFixed(2)
  const f4 = (n: number) => n.toFixed(4) // for rates the loop has to land exactly

  // The scene behind the glass is built at half size: it's frosted anyway, so
  // the upscale is invisible, and it's a quarter of the work per frame. The
  // seam, grain and foreground logos are drawn at full size.
  //
  // It's composited in 4:4:4. In 4:2:0 the overlay filter rounds every position
  // to an even pixel, so a row moving one pixel a frame stood still one frame
  // and jumped two the next: the scroll looked jagged.
  const { w, h, kh, cellW, step } = frostedRows(dims)
  const rowH = Math.round(90 * kh)
  const nTile = 8 // strip wide enough to cover the screen + one cell while scrolling
  const nRows = 5
  const spacing = Math.floor(h / nRows)
  const y = (r: number) => r * spacing + Math.floor((spacing - rowH) / 2)
  const leftX = `x='-mod(n*${step},${cellW})'`
  const rightX = `x='mod(n*${step},${cellW})-${cellW}'`
  // The logo arrives as one frame; the tile needs one per cell.
  const cellChain = `scale=${cellW}:${rowH}:force_original_aspect_ratio=decrease,pad=${cellW}:${rowH}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,loop=loop=${nTile - 1}:size=1,tile=${nTile}x1`

  // Everything that doesn't move is drawn once and repeated. Layers are
  // converted to the format they're composited in before they repeat, so the
  // overlays never convert per frame either.
  const loop = `loop=loop=-1:size=1,setpts=N/(${FPS}*TB)`
  const still = (src: string) => `${src},trim=end_frame=1,${loop}`
  const plane = (pw: number, ph: number, c = 'black') => `color=c=${c}:s=${pw}x${ph}:r=${FPS}:d=1`
  const back = 'overlay=format=yuv444'

  // The lights: one soft disc per light, drawn once, drifting up and swaying.
  const rnd = seeded(7)
  const between = ([lo, hi]: number[]) => lo + (hi - lo) * rnd()
  const orbs = ORB_DEPTHS.map((depth, di) =>
    Array.from({ length: depth.n }, (_, i) => {
      const d = Math.round((between(depth.size) * kh) / 2) * 2
      const r = d / 2
      const color = ORB_COLORS[Math.floor(rnd() * ORB_COLORS.length)]
      const a = between(depth.alpha)
      // A soft disc with a slightly brighter rim, like a lens's out-of-focus light.
      const disc =
        `st(0,hypot(X-${r},Y-${r}));` +
        `${Math.round(255 * a)}*min(1,0.8*clip((${r}-ld(0))/${f(r * 0.4)},0,1)+0.35*exp(-pow((ld(0)-${f(r * 0.8)})/${f(r * 0.12)},2)))`
      const [cr, cg, cb] = [2, 4, 6].map((o) => parseInt(color.slice(o, o + 2), 16))
      const sprite = still(`${plane(d, d)},format=rgba,geq=r=${cr}:g=${cg}:b=${cb}:a='${disc}',format=yuva444p`)
      const x0 = Math.round(rnd() * (w - d))
      const y0 = Math.round(rnd() * (h + d))
      // A light rises through the frame and re-enters below: a lap of h + d.
      // Its speed is the nearest to the design that makes whole laps over the
      // loop, and its sway the nearest period that fits it too.
      const lap = h + d
      const rise = f4((lap * Math.max(1, Math.round((between(depth.rise) * kh * loopSec) / lap))) / loopSec)
      const sway = f((8 + rnd() * 14) * kh)
      const period = f4(fitPeriod(9 + rnd() * 8, loopSec))
      const phase = f(rnd() * 6.28)
      return {
        label: `orb${di}_${i}`,
        sprite,
        pos: `x='${x0}+${sway}*sin(2*PI*t/${period}+${phase})':y='mod(${y0}-${rise}*t,H+h)-h'`,
      }
    }),
  )
  const [farOrbs, midOrbs, nearOrbs] = orbs
  // Chain a list of overlays from `from` to `to`.
  const layer = (list: { label: string; pos: string }[], from: string, to: string) =>
    list.map((o, i) => `[${i === 0 ? from : `${to}${i}`}][${o.label}]${back}:${o.pos}[${i === list.length - 1 ? to : `${to}${i + 1}`}]`)

  // Refraction maps: a blurred-noise luma plane around 128 (no shift). Chroma
  // stays at 128, so colour moves with the brightness rather than fringing.
  // Strength is in half-size pixels, and finer noise blurs to a larger swing,
  // hence the (kh/k)² to keep the ripple the same at any resolution.
  const map = (seed: number) =>
    still(
      `${plane(w, h)},format=yuv444p,lutyuv=y=128:u=128:v=128,noise=c0s=100:c0_seed=${seed},` +
        `gblur=sigma=${f(3 * kh)}:planes=1,lutyuv=y='128+(val-128)*${f(0.12 * (kh / k) ** 2)}'`,
    )

  // The heavier frosted band across the middle, in normalised coordinates
  // (geq's X/Y/W/H are per plane).
  const band = `exp(-pow((Y/H-0.5)/0.2,4))`

  // The glass surface as one layer of light (white) over shade (black): a
  // haze, the band's extra milk, a wash from the top-left, two diagonal
  // reflection bars, a pool of light behind each logo, and darker corners.
  // It's smooth, so it's computed at quarter size and scaled up. geq evaluates
  // each channel on its own, so each expression stores its terms and reuses them.
  const u = `(X/W+0.55*(Y/H)*${f(H / W)})` // position across the reflection bars
  const light = [
    `10`,
    `18*${band}`,
    `20*max(0,1-(X/W+Y/H)*0.85)`,
    `12*exp(-pow((${u}-0.34)/0.05,2))`,
    `14*exp(-pow((${u}-0.43)/0.016,2))`,
    `16*exp(-(pow((X/W-0.25)/0.2,2)+pow((Y/H-0.5)/0.32,2)))`,
    `16*exp(-(pow((X/W-0.75)/0.2,2)+pow((Y/H-0.5)/0.32,2)))`,
  ].join('+')
  const shade = `40*pow(max(0,abs(X/W-0.5)*2-0.55)/0.45,2)+34*pow(max(0,abs(Y/H-0.5)*2-0.5)/0.5,2)`
  // Shade first, light over it, folded into one colour + alpha.
  const shaded = (sh: string, li: string) => {
    const pre = `st(0,min(1,(${sh})/255));st(1,min(1,(${li})/255));st(2,1-(1-ld(0))*(1-ld(1)))`
    const lum = `${pre};if(gt(ld(2),0),255*ld(1)/ld(2),0)`
    return `format=rgba,geq=r='${lum}':g='${lum}':b='${lum}':a='${pre};255*ld(2)'`
  }
  // The grain lives in the layer's alpha: a fixed, full-size speckle of light.
  const surface = still(
    `${plane(Math.round(W / 8) * 2, Math.round(H / 8) * 2)},${shaded(shade, light)},` +
      `scale=${W}:${H}:flags=bicubic,format=yuva420p,noise=c3s=5:c3_seed=7`,
  )

  // The divider between the halves, lit from the top-left: a shadowed groove
  // with one bright edge. It only varies across, so it's drawn one pixel tall.
  const sw = Math.round((40 * k) / 2) * 2
  const c = sw / 2
  const seam = still(
    `${plane(sw, 1)},` +
      shaded(
        `110*exp(-pow((X-${c}+${f(2.5 * k)})/${f(2.2 * k)},2))+16*exp(-pow((X-${c})/${f(12 * k)},2))`,
        `120*exp(-pow((X-${c}-${f(0.5 * k)})/${f(0.7 * k)},2))+22*exp(-pow((X-${c}-${f(2 * k)})/${f(3 * k)},2))`,
      ) +
      `,scale=${sw}:${H}:flags=neighbor,format=yuva420p`,
  )

  // A soft glint that sweeps across the glass, ~2.8 s to cross, about every 8 s.
  const gs = W * 0.05
  const gw = Math.round((0.55 * H + 6 * gs) / 2) * 2
  const v = Math.round((W + gw) / 2.8)
  const glintEvery = fitPeriod(8, loopSec)
  const glint = still(
    `${plane(Math.round(gw / 4), Math.round(H / 4), 'white')},format=rgba,` +
      `geq=r=255:g=255:b=255:a='46*exp(-pow((X*4+0.55*Y*4-${f(0.55 * H + 3 * gs)})/${f(gs)},2))',` +
      `scale=${gw}:${H}:flags=bicubic,format=yuva420p`,
  )

  // Foreground logos. Each sits in a box that is a fraction of its own
  // half-panel so a short wide logo is held instead of swelling to the middle,
  // while a tall logo is bounded by the height. `scale` grows the channel
  // logo's box only — the MosaicTV mark stays put.
  const sh = Math.max(3, Math.round(7 * k))
  const shOff = Math.round(6 * k)
  const shadowOf = `colorchannelmixer=rr=0:gg=0:bb=0:aa=0.55,pad=iw+${sh * 6}:ih+${sh * 6}:${sh * 3}:${sh * 3}:color=black@0,gblur=sigma=${sh}`

  return [
    // The backdrop: the gradient's first frame, held still.
    `[0:v]trim=end_frame=1,format=yuv444p,${loop}[base]`,
    ...orbs.flat().map((o) => `${o.sprite}[${o.label}]`),
    ...layer([...farOrbs, ...midOrbs], 'base', 'deep'),
    `[1:v]split=2[chA][chFg]`,
    `[2:v]split=2[mzA][mzFg]`,
    `[chA]${cellChain},format=yuva444p,${loop},split=3[ch0][ch1][ch2]`,
    `[mzA]${cellChain},format=yuva444p,${loop},split=2[mz0][mz1]`,
    `[deep][ch0]${back}:${leftX}:y=${y(0)}[r0]`,
    `[r0][mz0]${back}:${rightX}:y=${y(1)}[r1]`,
    `[r1][ch1]${back}:${leftX}:y=${y(2)}[r2]`,
    `[r2][mz1]${back}:${rightX}:y=${y(3)}[r3]`,
    `[r3][ch2]${back}:${leftX}:y=${y(4)}[r4]`,
    ...layer(nearOrbs, 'r4', 'rows'),
    // The frost: light everywhere, heavy in the band; then the ripple, and a
    // glow from the heavy frost screened over the brightness only.
    `${map(11)}[mx]`,
    `${map(29)}[my]`,
    `${still(`${plane(w, h)},format=yuv444p,geq=lum='255*${band}':cb='255*${band}':cr='255*${band}'`)}[bm]`,
    `[rows]split=2[d0][d1]`,
    `[d0]gblur=sigma=${f(4.2 * kh)}[lite]`,
    `[d1]gblur=sigma=${f(13 * kh)},split=2[heavy][glow]`,
    `[lite][heavy][bm]maskedmerge[f0]`,
    `[f0][mx][my]displace=edge=smear[f1]`,
    `[f1][glow]blend=c0_mode=screen:c0_opacity=0.3:c1_mode=normal:c2_mode=normal,scale=${W}:${H}:flags=bicubic,format=yuv420p[frost]`,
    // The surface, the divider and the glint, at full size.
    `${surface}[surf]`,
    `${glint}[glint]`,
    `[frost][surf]overlay=0:0[g1]`,
    ...(divider ? [`${seam}[seam]`, `[g1][seam]overlay=x=${W / 2 - c}:y=0[g2]`] : [`[g1]null[g2]`]),
    `[g2][glint]overlay=x='-${gw}+mod(t*${v},${f4(v * glintEvery)})':y=0[g3]`,
    `[chFg]${logoBox(W * 0.3 * scale, 180 * k * scale)},format=rgba,split=2[chl][chs0]`,
    `[mzFg]${logoBox(W * 0.28, 120 * k)},format=rgba,split=2[mzl][mzs0]`,
    `[chs0]${shadowOf},format=yuva420p,${loop}[chs]`,
    `[mzs0]${shadowOf},format=yuva420p,${loop}[mzs]`,
    `[chl]format=yuva420p,${loop}[chfg]`,
    `[mzl]format=yuva420p,${loop}[mzfg]`,
    `[g3][chs]overlay=x=(W/2-w)/2:y=(H-h)/2+${shOff}[o1]`,
    `[o1][chfg]overlay=x=(W/2-w)/2:y=(H-h)/2[o2]`,
    `[o2][mzs]overlay=x=W/2+(W/2-w)/2:y=(H-h)/2+${shOff}[o3]`,
    `[o3][mzfg]overlay=x=W/2+(W/2-w)/2:y=(H-h)/2,format=yuv420p[v]`,
  ].join(';')
}

// Spotlight: a centered glass card lit by a soft gleam that sweeps across it.
// The channel logo sits large in the upper card; the MosaicTV wordmark rests
// below a faint divider. A calmer, more "on-air card" counterpart to frosted's
// busy scrolling panes.
function spotlightGraph(dims: Dims, loop: number, scale: number): string {
  const { w: W, h: H } = dims
  const k = H / 720
  const CW = Math.round(W * 0.64)
  const CH = Math.round(H * 0.62)
  const CX = Math.round((W - CW) / 2)
  const CY = Math.round((H - CH) / 2)
  const seamY = CY + Math.round(CH * 0.68) // divider between the two logos
  const border = Math.max(1, Math.round(2 * k))
  const sweepW = Math.round(W * 0.14)
  const sweepSpeed = ((CW + sweepW) / fitPeriod(6, loop)).toFixed(4) // one pass every ~6s
  const blur = Math.max(4, Math.round(24 * k))
  const chW = W * 0.42 * scale
  const chH = H * 0.3 * scale
  const chCenter = Math.round((CY + seamY) / 2)
  const mzCenter = Math.round((seamY + CY + CH) / 2)
  const pad = Math.round(CW * 0.08)
  return [
    // Background: a gently breathing gradient behind a vignette.
    `[0:v]eq=brightness='0.06*sin(2*PI*t/${fitPeriod(9, loop)})':eval=frame,vignette=PI/5,format=rgba[bg]`,
    // The glass card: soft fill, a hairline border, and a faint divider rule.
    `[bg]drawbox=x=${CX}:y=${CY}:w=${CW}:h=${CH}:color=white@0.05:t=fill,` +
      `drawbox=x=${CX}:y=${CY}:w=${CW}:h=${CH}:color=white@0.16:t=${border},` +
      `drawbox=x=${CX + pad}:y=${seamY}:w=${CW - 2 * pad}:h=${Math.max(1, Math.round(k))}:color=white@0.12:t=fill[card]`,
    // A translucent, blurred vertical bar swept across the card. It's drawn on
    // a clear card-sized layer, so it only ever lights the glass: at the wrap
    // it's wholly off that layer, and never shows jumping from one side of the
    // card to the other.
    `color=c=white:s=${sweepW}x${CH}:r=${FPS}:d=${loop},format=rgba,colorchannelmixer=aa=0.12,boxblur=${blur}:1[bar]`,
    `color=c=black@0:s=${CW}x${CH}:r=${FPS}:d=${loop},format=rgba[glass]`,
    `[glass][bar]overlay=x='-${sweepW}+mod(t*${sweepSpeed},${CW + sweepW})':y=0:format=rgb[sweep]`,
    `[card][sweep]overlay=x=${CX}:y=${CY}[lit]`,
    // Channel logo centered above the divider; MosaicTV wordmark centered below.
    `[1:v]${logoBox(chW, chH)},format=rgba[chfg]`,
    `[2:v]${logoBox(W * 0.24, H * 0.1)},format=rgba[mzfg]`,
    `[lit][chfg]overlay=x=(W-w)/2:y=${chCenter}-h/2[o1]`,
    `[o1][mzfg]overlay=x=(W-w)/2:y=${mzCenter}-h/2,format=yuv420p[v]`,
  ].join(';')
}

// Styles whose clip carries a logo (the channel's, or the filler's own).
const BRANDED = new Set(['frosted', 'spotlight', 'logowall', 'pulse'])

// Build the StyleBuild for a generated style, looping over `loop` seconds.
// `logoFile` brands the logo styles; `mzLogo` is the bundled MosaicTV mark
// (required by frosted/spotlight). `divider` draws the seam between frosted's
// two halves.
function buildStyle(
  style: string,
  dims: Dims,
  loop: number,
  scale: number,
  logoFile: string | undefined,
  mzLogo: string | undefined,
  divider = false,
): StyleBuild | null {
  if (style === 'retro') return retroBuild(dims, loop)
  if (style === 'vintage') return vintageBuild(dims, loop)
  if (style === 'animated') return animatedBuild(dims, loop)
  if (style === 'logowall' && logoFile) {
    return { inputs: [...gradientInput(dims, loop, 0.02, 'c0=0x0a0f1e:c1=0x141b2e:c2=0x0c1526:c3=0x1a2338'), '-loop', '1', '-i', logoFile], filter: logowallGraph(dims, scale, loop), tone: 104, vol: 0.05 }
  }
  if (style === 'pulse' && logoFile) {
    return { inputs: [...gradientInput(dims, loop, 0.03, 'c0=0x120a24:c1=0x1e1140:c2=0x0b1530:c3=0x241448'), '-loop', '1', '-i', logoFile], filter: pulseGraph(dims, scale, loop), tone: 96, vol: 0.05 }
  }
  if (style === 'frosted' && logoFile && mzLogo) {
    // The logos go in as single frames — the graph draws them once and repeats.
    return { inputs: [...gradientInput(frostedBackDims(dims), loop, 0.04, 'c0=0x0b1020:c1=0x2a1150:c2=0x10233f:c3=0x0e2f3a', FPS), '-i', logoFile, '-i', mzLogo], filter: frostedGraph(dims, scale, divider, loop), tone: 90, vol: 0.04 }
  }
  if (style === 'spotlight' && logoFile && mzLogo) {
    return { inputs: [...gradientInput(dims, loop, 0.035, 'c0=0x0a0e1c:c1=0x1b1436:c2=0x0c1a2e:c3=0x141026'), '-loop', '1', '-i', logoFile, '-loop', '1', '-i', mzLogo], filter: spotlightGraph(dims, loop, scale), tone: 92, vol: 0.04 }
  }
  return null
}

// The clip's own sound: a soft tone at the style's frequency, nudged to a whole
// number of cycles over the loop so it doesn't click where the clip repeats.
// It airs only when the filler has no music, which replaces it on air.
function toneInput(loop: number, toneHz: number, vol: number): string[] {
  const hz = Math.round(toneHz * loop) / loop
  return ['-f', 'lavfi', '-i', `sine=f=${hz.toFixed(6)}:d=${loop},volume=${vol}`]
}

const videoInputCount = (inputs: string[]) => inputs.filter((a) => a === '-i').length

// Assemble a full clip: video inputs + tone, mapped and capped to one loop.
function assembleVideo(build: StyleBuild, loop: number, out: string): string[] {
  const n = videoInputCount(build.inputs)
  return [
    '-y',
    ...build.inputs,
    ...toneInput(loop, build.tone, build.vol),
    '-filter_complex', build.filter,
    '-map', '[v]', '-map', `${n}:a`, '-t', loop.toFixed(6),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', out,
  ]
}

// Assemble a single still: the same graph, no audio, one frame at STILL_AT.
function assembleStill(build: StyleBuild, out: string): string[] {
  return [
    '-y',
    ...build.inputs,
    '-filter_complex', build.filter,
    '-map', '[v]', '-an', '-ss', String(STILL_AT), '-frames:v', '1', '-update', '1', '-q:v', '3', out,
  ]
}

// ---- Bundled brand mark -----------------------------------------------------

// MosaicTV brand mark used in frosted/spotlight. Only present when
// process.cwd()/public exists (production, or local dev after copying the built
// frontend there) — undefined in plain local dev, in which case callers skip
// those styles instead of handing ffmpeg a missing file.
function mosaictvLogoFile(): string | undefined {
  const wide = path.join(process.cwd(), 'public', 'logo-wide.png')
  if (fs.existsSync(wide)) return wide
  const icon = path.join(process.cwd(), 'public', 'mosaictv-icon.png')
  return fs.existsSync(icon) ? icon : undefined
}


// ---- On-disk cache ----------------------------------------------------------

// Bump a style's version when its generator changes, so clips already on disk
// are rebuilt (and the old ones swept away, see sweepUnused).
const STYLE_VERSION: Record<string, number> = { animated: 6, frosted: 9 }
const THEME_VERSION = 3 // every other style

// Resolve an Asset id to its on-disk file (or undefined).
async function assetFilePath(id: number | null | undefined): Promise<string | undefined> {
  if (id == null) return undefined
  const a = await prisma.asset.findUnique({ where: { id } })
  if (!a) return undefined
  const f = path.join(assetsDir(), a.filename)
  return fs.existsSync(f) ? f : undefined
}

// Cache-busting fingerprint for a file (path + mtime).
function fileKey(f?: string): string {
  if (!f) return ''
  try {
    return `${f}:${Math.round(fs.statSync(f).mtimeMs)}`
  } catch {
    return f
  }
}

const dimKey = (d: Dims) => `${d.w}x${d.h}`

// Cache filename for a generated clip. The filler id is baked into the name so
// every version a filler produces (one per branding logo, resolution…) can be
// swept in one go when the filler is edited or deleted. A station ident with no
// filler row behind it (a channel's frosted fallback) uses id 0.
function cacheName(style: string, fillerId: number, keyParts: string): string {
  const hash = createHash('md5').update(keyParts).digest('hex')
  return path.join(dataDir(), `filler-${style}-f${fillerId}-${hash}.mp4`)
}

// A generated clip in the data dir — never a render in progress, whose temp
// file ends .tmp.mp4.
const CLIP_FILE = /^filler-[a-z]+-f\d+-[0-9a-f]{32}\.mp4$/

/** One generated clip: where it lives, and how to build it. */
type ClipPlan = { out: string; loop: number; build: StyleBuild; label: string }

/**
 * Plan the clip for a generated style, or null when the style can't be drawn
 * here (a logo style with no logo, or frosted/spotlight without the bundled
 * MosaicTV mark). Everything that changes the picture is in the file name, so
 * a clip on disk is always the right one for its inputs.
 */
function planClip(style: string, fillerId: number, logoFile: string | undefined, dims: Dims, scale = 1, divider = false): ClipPlan | null {
  const s = clampScale(scale)
  const loop = loopSecFor(style, dims)
  const build = buildStyle(style, dims, loop, s, logoFile, mosaictvLogoFile(), divider)
  if (!build) return null
  const brand = BRANDED.has(style) ? `${fileKey(logoFile)}:${s}` : ''
  const key = `${brand}:${style === 'frosted' && divider ? 'div' : ''}:${dimKey(dims)}:v${STYLE_VERSION[style] ?? THEME_VERSION}`
  const label = `${style} filler (${dimKey(dims)}${BRANDED.has(style) && logoFile ? `, ${path.basename(logoFile)}` : ''})`
  return { out: cacheName(style, fillerId, key), loop, build, label }
}

// ---- Rendering --------------------------------------------------------------
// One render at a time, at low priority: a render is a batch job, and the
// channels encoding live come first. Asking for a clip that's already being
// built joins that render instead of starting a second copy of it.

type Render = { promise: Promise<string | undefined>; listeners: Set<ProgressCb> }
const renders = new Map<string, Render>()
let renderQueue: Promise<unknown> = Promise.resolve()

// A render that just failed isn't retried on every break that asks for it.
const failedAt = new Map<string, number>()
const RETRY_FAILED_MS = 10 * 60_000

function render(plan: ClipPlan, onProgress?: ProgressCb): Promise<string | undefined> {
  let r = renders.get(plan.out)
  if (!r) {
    const listeners = new Set<ProgressCb>()
    const run = async (): Promise<string | undefined> => {
      if (fs.existsSync(plan.out)) return plan.out // built while this waited its turn
      log('info', 'system', `Generating the ${plan.label}…`)
      // Written under a temp name and renamed once complete, so the clip never
      // exists half-written for a break to pick up.
      const tmp = `${plan.out}.${process.pid}.${Date.now()}.tmp.mp4`
      try {
        const progress = (pct: number) => listeners.forEach((l) => l(pct))
        await runFfmpeg(assembleVideo(plan.build, plan.loop, tmp), progress, plan.loop, { background: true })
        fs.renameSync(tmp, plan.out)
        failedAt.delete(plan.out)
        return plan.out
      } catch (e) {
        failedAt.set(plan.out, Date.now())
        log('warn', 'system', `Couldn't generate the ${plan.label}`, String(e))
        return undefined
      } finally {
        fs.rmSync(tmp, { force: true }) // no-op once renamed
      }
    }
    const promise = renderQueue.then(run, run).finally(() => renders.delete(plan.out))
    renderQueue = promise.catch(() => {})
    r = { promise, listeners }
    renders.set(plan.out, r)
  }
  if (onProgress) r.listeners.add(onProgress)
  return r.promise
}

type GetOpts = {
  /** false: don't wait for a render — start it and come back empty-handed. */
  wait?: boolean
  /** false: only a clip that's already built; never start a render. */
  build?: boolean
  onProgress?: ProgressCb
}

/**
 * A planned clip's file. Built already → its path. Otherwise the render starts
 * (or joins the one in progress) and this waits for it — or, with
 * `wait: false`, returns undefined straight away so the clip is ready for a
 * later break. That's also the case that doesn't retry a render which just
 * failed: it's asked on every break.
 */
async function obtain(plan: ClipPlan, opts: GetOpts = {}): Promise<string | undefined> {
  if (fs.existsSync(plan.out)) return plan.out
  if (opts.build === false) return undefined
  if (opts.wait === false) {
    const failed = failedAt.get(plan.out)
    if (!failed || Date.now() - failed > RETRY_FAILED_MS) render(plan).catch(() => {})
    return undefined
  }
  return render(plan, opts.onProgress)
}

/** The plain animated clip: the last resort when nothing else is built. */
export function ensureAnimatedFiller(opts: GetOpts = {}): Promise<string | undefined> {
  return obtain(planClip('animated', 0, undefined, RESOLUTIONS['1080p'])!, opts)
}

/**
 * The station ident a channel airs when it has no filler of its own and no
 * default ident is set: frosted glass from its logo, at the channel's size.
 * Undefined without the bundled MosaicTV mark (plain local dev only).
 */
export async function ensureStationIdent(logoFile: string, channelHeight?: number, opts: GetOpts = {}): Promise<string | undefined> {
  const plan = planClip('frosted', 0, logoFile, dimsFor('auto', channelHeight))
  return plan ? obtain(plan, opts) : undefined
}

// Remove every cached clip a filler produced (all its logo and resolution
// versions), keyed by the id baked into the file names. Called when a filler
// is deleted or restyled, so its old look is gone at once.
export function removeFillerCache(fillerId: number): void {
  if (!fillerId) return
  try {
    const dir = dataDir()
    for (const f of fs.readdirSync(dir)) {
      if (!CLIP_FILE.test(f) || !f.includes(`-f${fillerId}-`)) continue
      fs.rmSync(path.join(dir, f), { force: true })
      failedAt.delete(path.join(dir, f))
    }
  } catch {
    /* best-effort */
  }
}

// ---- Resolution -------------------------------------------------------------

type FillerRow = {
  id: number
  style: string
  assetId: number | null
  audioAssetId: number | null
  logoId: number | null
  resolution: string
  logoScale: number
  divider: boolean
}

export type FillerClip = { clip?: string; music?: string }

/**
 * Resolve a Filler to its clip and music. The music (if any) isn't in the clip:
 * it's laid over the break as it airs, from the top, so a song plays straight
 * through however many times the clip loops (and changing it rebuilds nothing).
 * A custom filler's clip is its upload; a generated one is built for this logo
 * and size, falling back to the animated look if its style can't be built.
 *
 * `logoFile` is the logo of wherever this filler is airing; a filler that pins
 * its own logo (`logoId`) uses that everywhere instead. `channelHeight` sizes a
 * Match-channel filler. With `wait: false` a clip that isn't built yet comes
 * back missing (and starts building) rather than holding the caller up; with
 * `build: false` it just comes back missing.
 */
export async function resolveFillerClip(
  f: FillerRow,
  logoFile: string | undefined,
  opts: GetOpts & { channelHeight?: number } = {},
): Promise<FillerClip> {
  const music = await assetFilePath(f.audioAssetId)
  if (f.style === 'custom') {
    const clip = await assetFilePath(f.assetId)
    if (clip) return { clip, music }
  }
  if (f.logoId != null) logoFile = (await logoFileById(f.logoId, null)) ?? logoFile
  const dims = dimsFor(f.resolution, opts.channelHeight)
  const plan = f.style === 'custom' ? null : planClip(f.style, f.id, logoFile, dims, f.logoScale, f.divider)
  const clip = plan ? await obtain(plan, opts) : undefined
  if (clip || (plan && (opts.wait === false || opts.build === false))) return { clip, music }
  // The style can't be drawn here or its render failed — or it's a custom
  // filler whose upload is gone: the animated look instead.
  return { clip: await obtain(planClip('animated', f.id, undefined, dims)!, opts), music }
}

/**
 * Render a single still frame of a filler to `out` (a JPEG). Uses the exact
 * graph the full clip would, so it's a faithful preview of the branded look
 * without the wait — for custom clips it grabs a frame from the source video.
 */
export async function generateFillerStill(f: FillerRow, logoFile: string | undefined, out: string, channelHeight?: number): Promise<void> {
  if (f.logoId != null) logoFile = (await logoFileById(f.logoId, null)) ?? logoFile
  const dims = dimsFor(f.resolution, channelHeight)

  if (f.style === 'custom') {
    const clip = await assetFilePath(f.assetId)
    if (clip) {
      await runFfmpeg(['-y', '-ss', '1', '-i', clip, '-frames:v', '1', '-update', '1', '-q:v', '3', out])
      return
    }
  }
  const style = f.style === 'custom' ? 'animated' : f.style
  const build =
    buildStyle(style, dims, loopSecFor(style, dims), clampScale(f.logoScale), logoFile, mosaictvLogoFile(), f.divider) ??
    animatedBuild(dims, LOOP_SEC)
  await runFfmpeg(assembleStill(build, out))
}

/** Where a preview should take its branding from. */
export type FillerLogoContext = { channelId?: number | null; timeBlockId?: number | null }

// Every logo's file, by id — what the stream resolves a logo id against.
async function logoPaths(): Promise<Map<number, string>> {
  const logos = await prisma.logo.findMany({ select: { id: true, filename: true } })
  return new Map(logos.map((l) => [l.id, path.join(logosDir(), l.filename)]))
}

/**
 * The logo and channel size a filler is built with outside a break (the
 * Studio's preview and still). A filler is a global library item, so one
 * definition renders differently everywhere it's assigned: use the requested
 * channel or block, else the first place it's assigned, so a preview matches
 * what actually airs somewhere rather than the bundled fallback mark.
 */
async function fillerSetting(fillerId: number, ctx: FillerLogoContext): Promise<{ logoFile?: string; channelHeight?: number }> {
  const withChannel = { include: { channel: { include: { profile: true } }, collection: true } }
  let block = ctx.timeBlockId != null ? await prisma.timeBlock.findUnique({ where: { id: ctx.timeBlockId }, ...withChannel }) : null
  let channel =
    !block && ctx.channelId != null ? await prisma.channel.findUnique({ where: { id: ctx.channelId }, include: { profile: true } }) : null

  if (!block && !channel && fillerId) {
    const a = await prisma.fillerAssignment.findFirst({
      where: { fillerId },
      orderBy: { order: 'asc' },
      include: { channel: { include: { profile: true } }, timeBlock: withChannel },
    })
    block = a?.timeBlock ?? null
    channel = a?.channel ?? null
  }

  const ch = block?.channel ?? channel
  if (!ch) return { logoFile: await localLogo(null) } // unassigned: the bundled mark is all we have
  return {
    logoFile: await localLogo(logoFor(ch, block, await logoPaths()).raw),
    channelHeight: resolveProfile(ch.profile).height,
  }
}

/**
 * Build (if needed) and return a Filler's clip and music — used by the Studio's
 * generate. `ctx` picks whose logo to brand it with. `onProgress` reports
 * 0..99% during generation.
 */
export async function resolveFillerClipById(id: number, ctx: FillerLogoContext = {}, onProgress?: ProgressCb): Promise<FillerClip | null> {
  const f = await prisma.filler.findUnique({ where: { id } })
  if (!f) return null
  const { logoFile, channelHeight } = await fillerSetting(id, ctx)
  return resolveFillerClip(f, logoFile, { channelHeight, onProgress })
}

/**
 * Render a still preview from a draft (unsaved) filler definition, branded with
 * the given owner's logo. Returns the on-disk JPEG path (caller streams + deletes
 * it). Nothing is persisted, so previews never accumulate.
 */
export async function generateDraftStill(f: FillerRow, ctx: FillerLogoContext): Promise<string> {
  const { logoFile, channelHeight } = await fillerSetting(f.id, ctx)
  const out = path.join(previewsDir(), `still-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`)
  await generateFillerStill(f, logoFile, out, channelHeight)
  return out
}

// The Setting holding the default station ident's filler id.
export const DEFAULT_FILLER_KEY = 'defaultFillerId'

/**
 * The default station ident: the filler a channel with none of its own airs in
 * its breaks, and in any slot the stream has to hold. Null when unset (or its
 * filler was deleted) — the frosted-glass ident built from the channel's logo.
 */
export async function loadDefaultFiller() {
  const row = await prisma.setting.findUnique({ where: { key: DEFAULT_FILLER_KEY } })
  const id = Number(row?.value)
  if (!Number.isInteger(id)) return null
  return prisma.filler.findUnique({ where: { id } })
}

// ---- Taking turns -----------------------------------------------------------
// Breaks take turns through a pool of fillers in its order (a block's, or a
// channel's), so two fillers alternate instead of landing on the same one half
// the time. The last pick per pool is kept in the database: a restart carries
// on the order, and the same break built again (a retry, a restart mid-break)
// keeps the filler it had.

const TURNS_KEY = 'fillerTurns'
const TURN_TTL_MS = 7 * 24 * 3600_000 // forget a pool not heard from in a week (a deleted block)
type Turn = { at: number; idx: number }
let turns: Promise<Map<string, Turn>> | null = null
let savingTurns: Promise<unknown> = Promise.resolve()

function loadTurns(): Promise<Map<string, Turn>> {
  turns ??= prisma.setting
    .findUnique({ where: { key: TURNS_KEY } })
    .then((row) => new Map(Object.entries(JSON.parse(row?.value ?? '{}') as Record<string, Turn>)))
    .catch(() => new Map<string, Turn>())
  return turns
}

/**
 * Which of a pool's `size` fillers airs in the break starting at `at` (epoch
 * ms). `pool` names the pool (channel + block); the first break a pool ever
 * has gets its first filler.
 */
export async function fillerTurn(pool: string, at: number, size: number): Promise<number> {
  if (size <= 1) return 0
  const m = await loadTurns()
  const last = m.get(pool)
  if (last?.at === at) return last.idx % size
  const idx = last ? (last.idx + 1) % size : 0
  m.set(pool, { at, idx })
  for (const [k, t] of m) if (at - t.at > TURN_TTL_MS) m.delete(k)
  const value = JSON.stringify(Object.fromEntries(m))
  // One write at a time, so an older pick can never land after a newer one.
  savingTurns = savingTurns
    .then(() => prisma.setting.upsert({ where: { key: TURNS_KEY }, create: { key: TURNS_KEY, value }, update: { value } }))
    .catch(() => {})
  return idx
}

// ---- Building ahead ---------------------------------------------------------

// Clear what a hard crash left behind: caption and info-card images (a clean
// exit removes each after its segment), still previews, and half-written
// renders and Studio preview copies. Only at boot — later, any of them could
// belong to something running.
function sweepScratch(): void {
  try {
    for (const f of fs.readdirSync(dataDir())) {
      if (/^caption-.*\.txt$|^card-.*\.png$|^filler-.*\.tmp\.mp4$/.test(f)) fs.rmSync(path.join(dataDir(), f), { force: true })
    }
    for (const f of fs.readdirSync(assetsDir())) if (f.endsWith('.tmp.mp4')) fs.rmSync(path.join(assetsDir(), f), { force: true })
    for (const f of fs.readdirSync(previewsDir())) fs.rmSync(path.join(previewsDir(), f), { force: true })
  } catch {
    /* best-effort */
  }
}

// A clip written in the last few minutes is left alone even if nothing seems
// to want it: a render the stream started for a break, or one the Studio is
// still copying into its preview.
const SWEEP_GRACE_MS = 15 * 60_000

// Delete generated clips no break would use any more — an edited filler's old
// look, a replaced logo's, a clip from before a style's generator changed. The
// Studio's previews are Media assets, not these, and stay.
function sweepUnused(wanted: Set<string>): void {
  let n = 0
  let bytes = 0
  let dir: string
  let files: string[]
  try {
    dir = dataDir()
    files = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const f of files) {
    if (!CLIP_FILE.test(f) || wanted.has(f)) continue
    const file = path.join(dir, f)
    if (renders.has(file)) continue
    try {
      const st = fs.statSync(file)
      if (Date.now() - st.mtimeMs < SWEEP_GRACE_MS) continue
      fs.rmSync(file)
      n++
      bytes += st.size
    } catch {
      /* in use (Windows) or already gone — try again next pass */
    }
  }
  if (n) log('info', 'system', `Removed ${n} filler clip${n === 1 ? '' : 's'} nothing airs any more (${(bytes / 1e6).toFixed(0)} MB)`)
}

/**
 * Build every clip a break could need, so no break waits on a render. For each
 * channel that's every place a break can fall — outside its blocks, and in
 * each block — with the fillers that break would pick from (the block's, else
 * the channel's, else the default ident; else the frosted ident), the logo on
 * screen there, and the channel's size. Then sweep away clips nothing uses.
 */
async function warmPass(): Promise<void> {
  const wanted = new Set<string>()
  const keep = (clip: string | undefined) => {
    if (clip) wanted.add(path.basename(clip))
  }

  const animated = await ensureAnimatedFiller()
  if (animated) keep(animated)
  else log('warn', 'system', 'No filler clip available — gaps will play black')

  const assign = { include: { filler: true }, orderBy: { order: 'asc' as const } }
  const channels = await prisma.channel.findMany({
    include: {
      profile: true,
      fillerAssignments: assign,
      timeBlocks: { include: { fillerAssignments: assign, collection: true } },
    },
  })
  const logos = await logoPaths()
  const defaultFiller = await loadDefaultFiller()
  for (const ch of channels) {
    const channelHeight = resolveProfile(ch.profile).height
    const chFillers = ch.fillerAssignments.map((a) => a.filler)
    for (const block of [null, ...ch.timeBlocks]) {
      const blockFillers = block?.fillerAssignments.map((a) => a.filler) ?? []
      const pool = blockFillers.length > 0 ? blockFillers : chFillers.length > 0 ? chFillers : defaultFiller ? [defaultFiller] : []
      const logo = await localLogo(logoFor(ch, block, logos).raw)
      if (pool.length === 0 && logo) keep(await ensureStationIdent(logo, channelHeight))
      for (const f of pool) keep((await resolveFillerClip(f, logo, { channelHeight })).clip)
    }
  }
  sweepUnused(wanted)
}

let warming: Promise<void> | null = null
let warmAgain = false
let booted = false

/**
 * Build ahead (warmPass) — at boot, and after any change that could change a
 * clip: a filler edited or assigned, a channel's or block's logo or profile, a
 * replaced logo. Calls while a pass is running fold into one more pass after
 * it, so a burst of edits costs one extra pass, not one each.
 */
export function warmFiller(): Promise<void> {
  if (warming) {
    warmAgain = true
    return warming
  }
  warming = (async () => {
    try {
      if (!booted) {
        booted = true
        sweepScratch()
      }
      do {
        warmAgain = false
        await warmPass().catch((e) => log('warn', 'system', 'Building fillers ahead failed', String(e)))
      } while (warmAgain)
    } finally {
      warming = null
    }
  })()
  return warming
}
