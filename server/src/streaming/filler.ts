// Station-ID filler: the generated ident styles (frosted glass, spotlight, and
// the retired animated / logo wall / pulse / retro / vintage looks), the on-disk
// cache that keeps a gap from ever waiting on generation, resolution of a Filler
// row to a playable clip, and single-frame still previews.

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { prisma } from '../db.js'
import { assetsDir, dataDir, previewsDir } from '../paths.js'
import { log } from '../logs.js'
import { probeDuration } from '../ffprobe.js'
import { runFfmpeg, type ProgressCb } from './run.js'
import { logoFileById } from './logo.js'

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
export const dimsFor = (resolution: string | null | undefined): Dims => RESOLUTIONS[resolution ?? ''] ?? RESOLUTIONS['1080p']

const clampDur = (d: number) => Math.max(5, Math.min(600, Math.round(d) || 30))
const clampScale = (s: number) => Math.max(0.4, Math.min(2, Number.isFinite(s) ? s : 1))

// Single-frame preview timing: build a few seconds of the graph and grab a
// frame once the animation has settled.
const STILL_DUR = 4
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
  tone: number // fallback sine frequency when no audio is chosen
  vol: number
}

// `rate` defaults to the source's 25 fps (which the 30 fps output duplicates up
// to); a style that scrolls passes FPS so its motion doesn't stutter.
function gradientInput(dims: Dims, dur: number, speed: string, colors: string, rate?: number): string[] {
  return ['-f', 'lavfi', '-i', `gradients=s=${dims.w}x${dims.h}${rate ? `:r=${rate}` : ''}:d=${dur}:speed=${speed}:${colors}:nb_colors=4`]
}

// Preferred generic look: a drifting color gradient with a slow hue sway,
// animated grain and a vignette. Loops smoothly (hue returns to 0 at the end).
function animatedBuild(dims: Dims, dur: number): StyleBuild {
  return {
    inputs: gradientInput(dims, dur, '0.05', 'c0=0x0b1020:c1=0x3b1d60:c2=0x1e3a8a:c3=0x0e7490'),
    filter: `[0:v]hue=H='0.5*sin(2*PI*t/${dur})':s='1.05+0.05*sin(2*PI*t/${dur})',noise=alls=6:allf=t,vignette=PI/4.5,fps=${FPS},format=yuv420p[v]`,
    tone: 110,
    vol: 0.05,
  }
}

// Proven fallback (the original) in case a filter isn't available on this build.
function basicBuild(dims: Dims, dur: number): StyleBuild {
  return {
    inputs: gradientInput(dims, dur, '0.02', 'c0=0x111827:c1=0x4c1d95:c2=0x1e3a8a:c3=0x0e7490'),
    filter: `[0:v]fps=${FPS},format=yuv420p[v]`,
    tone: 98,
    vol: 0.06,
  }
}

// Retro test bars: classic SMPTE color bars with soft analog grain + vignette.
function retroBuild(dims: Dims, dur: number): StyleBuild {
  return {
    inputs: ['-f', 'lavfi', '-i', `smptehdbars=s=${dims.w}x${dims.h}:d=${dur}`],
    filter: `[0:v]noise=alls=10:allf=t,vignette=PI/5,fps=${FPS},format=yuv420p[v]`,
    tone: 440,
    vol: 0.04,
  }
}

// Vintage film: warm sepia drift with heavy grain and a strong vignette.
function vintageBuild(dims: Dims, dur: number): StyleBuild {
  return {
    inputs: gradientInput(dims, dur, '0.03', 'c0=0x2b1a0c:c1=0x4a3018:c2=0x1c1108:c3=0x5a4526'),
    filter: `[0:v]hue=s=0.35,noise=alls=16:allf=t+u,vignette=PI/3.8,fps=${FPS},format=yuv420p[v]`,
    tone: 82,
    vol: 0.05,
  }
}

// Logo wall: dim rows of the logo scrolling in alternating directions over a
// dark gradient, with a sharp logo centered in front. Geometry scales with the
// canvas height (k) so it looks the same at any resolution.
function logowallGraph(dims: Dims, scale: number): string {
  const { w: W, h: H } = dims
  const k = H / 720
  const rowH = Math.round(90 * k)
  const cellW = Math.round(260 * k)
  const speed = Math.round(40 * k)
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
function pulseGraph(dims: Dims, scale: number): string {
  const { w: W, h: H } = dims
  const k = H / 720
  return [
    `[0:v]eq=brightness='0.07*sin(2*PI*t/6)':eval=frame,fps=${FPS}[bg]`,
    `[1:v]${logoBox(W, 220 * k * scale)},format=rgba[fg]`,
    `[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2,format=yuv420p[v]`,
  ].join(';')
}

// The frosted scene is built at half size (see frostedGraph).
const frostedBackDims = (dims: Dims): Dims => ({ w: Math.round(dims.w / 4) * 2, h: Math.round(dims.h / 4) * 2 })

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
function frostedGraph(dims: Dims, scale: number, divider: boolean): string {
  const { w: W, h: H } = dims
  const k = H / 720
  const f = (n: number) => n.toFixed(2)

  // The scene behind the glass is built at half size: it's frosted anyway, so
  // the upscale is invisible, and it's a quarter of the work per frame. The
  // seam, grain and foreground logos are drawn at full size.
  //
  // It's composited in 4:4:4. In 4:2:0 the overlay filter rounds every position
  // to an even pixel, so a row moving one pixel a frame stood still one frame
  // and jumped two the next: the scroll looked jagged.
  const { w, h } = frostedBackDims(dims)
  const kh = h / 720
  const rowH = Math.round(90 * kh)
  const cellW = Math.round(260 * kh)
  const nTile = 8 // strip wide enough to cover the screen + one cell while scrolling
  // A whole number of pixels per frame, so the rows glide evenly instead of in
  // the uneven 1-2-1-2 steps a fractional speed rounds to.
  const step = Math.max(1, Math.round((55 * kh) / FPS))
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
      const rise = f(between(depth.rise) * kh)
      const sway = f((8 + rnd() * 14) * kh)
      const period = f(9 + rnd() * 8)
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

  // A soft glint that sweeps across the glass, ~2.8 s to cross, every 8 s.
  const gs = W * 0.05
  const gw = Math.round((0.55 * H + 6 * gs) / 2) * 2
  const v = Math.round((W + gw) / 2.8)
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
    `[g2][glint]overlay=x='-${gw}+mod(t*${v},${v * 8})':y=0[g3]`,
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
function spotlightGraph(dims: Dims, dur: number, scale: number): string {
  const { w: W, h: H } = dims
  const k = H / 720
  const CW = Math.round(W * 0.64)
  const CH = Math.round(H * 0.62)
  const CX = Math.round((W - CW) / 2)
  const CY = Math.round((H - CH) / 2)
  const seamY = CY + Math.round(CH * 0.68) // divider between the two logos
  const border = Math.max(1, Math.round(2 * k))
  const sweepW = Math.round(W * 0.14)
  const sweepSpeed = Math.round((CW + sweepW) / 6) // one pass every ~6s
  const blur = Math.max(4, Math.round(24 * k))
  const chW = W * 0.42 * scale
  const chH = H * 0.3 * scale
  const chCenter = Math.round((CY + seamY) / 2)
  const mzCenter = Math.round((seamY + CY + CH) / 2)
  const pad = Math.round(CW * 0.08)
  return [
    // Background: a gently breathing gradient behind a vignette.
    `[0:v]eq=brightness='0.06*sin(2*PI*t/9)':eval=frame,vignette=PI/5,format=rgba[bg]`,
    // The glass card: soft fill, a hairline border, and a faint divider rule.
    `[bg]drawbox=x=${CX}:y=${CY}:w=${CW}:h=${CH}:color=white@0.05:t=fill,` +
      `drawbox=x=${CX}:y=${CY}:w=${CW}:h=${CH}:color=white@0.16:t=${border},` +
      `drawbox=x=${CX + pad}:y=${seamY}:w=${CW - 2 * pad}:h=${Math.max(1, Math.round(k))}:color=white@0.12:t=fill[card]`,
    // A translucent, blurred vertical bar swept across the card and looping off
    // its edges (invisible at the wrap).
    `color=c=white:s=${sweepW}x${CH}:r=${FPS}:d=${dur},format=rgba,colorchannelmixer=aa=0.12,boxblur=${blur}:1[sweep]`,
    `[card][sweep]overlay=x='${CX - sweepW}+mod(t*${sweepSpeed},${CW + sweepW})':y=${CY}[lit]`,
    // Channel logo centered above the divider; MosaicTV wordmark centered below.
    `[1:v]${logoBox(chW, chH)},format=rgba[chfg]`,
    `[2:v]${logoBox(W * 0.24, H * 0.1)},format=rgba[mzfg]`,
    `[lit][chfg]overlay=x=(W-w)/2:y=${chCenter}-h/2[o1]`,
    `[o1][mzfg]overlay=x=(W-w)/2:y=${mzCenter}-h/2,format=yuv420p[v]`,
  ].join(';')
}

// Build the StyleBuild for a generated style. `logoFile` brands the logo styles;
// `mzLogo` is the bundled MosaicTV mark (required by frosted/spotlight).
// `divider` draws the seam between frosted's two halves.
function buildStyle(
  style: string,
  dims: Dims,
  dur: number,
  scale: number,
  logoFile: string | undefined,
  mzLogo: string | undefined,
  divider = false,
): StyleBuild | null {
  if (style === 'retro') return retroBuild(dims, dur)
  if (style === 'vintage') return vintageBuild(dims, dur)
  if (style === 'animated') return animatedBuild(dims, dur)
  if (style === 'logowall' && logoFile) {
    return { inputs: [...gradientInput(dims, dur, '0.02', 'c0=0x0a0f1e:c1=0x141b2e:c2=0x0c1526:c3=0x1a2338'), '-loop', '1', '-i', logoFile], filter: logowallGraph(dims, scale), tone: 104, vol: 0.05 }
  }
  if (style === 'pulse' && logoFile) {
    return { inputs: [...gradientInput(dims, dur, '0.03', 'c0=0x120a24:c1=0x1e1140:c2=0x0b1530:c3=0x241448'), '-loop', '1', '-i', logoFile], filter: pulseGraph(dims, scale), tone: 96, vol: 0.05 }
  }
  if (style === 'frosted' && logoFile && mzLogo) {
    // The logos go in as single frames — the graph draws them once and repeats.
    return { inputs: [...gradientInput(frostedBackDims(dims), dur, '0.04', 'c0=0x0b1020:c1=0x2a1150:c2=0x10233f:c3=0x0e2f3a', FPS), '-i', logoFile, '-i', mzLogo], filter: frostedGraph(dims, scale, divider), tone: 90, vol: 0.04 }
  }
  if (style === 'spotlight' && logoFile && mzLogo) {
    return { inputs: [...gradientInput(dims, dur, '0.035', 'c0=0x0a0e1c:c1=0x1b1436:c2=0x0c1a2e:c3=0x141026'), '-loop', '1', '-i', logoFile, '-loop', '1', '-i', mzLogo], filter: spotlightGraph(dims, dur, scale), tone: 92, vol: 0.04 }
  }
  return null
}

// Audio input for a generated clip: a chosen track (looped) baked in, else a
// soft tone at the style's frequency.
function audioInput(audioFile: string | undefined, dur: number, toneHz: number, vol: number): string[] {
  return audioFile
    ? ['-stream_loop', '-1', '-i', audioFile]
    : ['-f', 'lavfi', '-i', `sine=f=${toneHz}:d=${dur},volume=${vol}`]
}

const videoInputCount = (inputs: string[]) => inputs.filter((a) => a === '-i').length

// Assemble a full clip: video inputs + audio, mapped and capped to `dur`.
function assembleVideo(build: StyleBuild, dur: number, audioFile: string | undefined, out: string): string[] {
  const n = videoInputCount(build.inputs)
  return [
    '-y',
    ...build.inputs,
    ...audioInput(audioFile, dur, build.tone, build.vol),
    '-filter_complex', build.filter,
    '-map', '[v]', '-map', `${n}:a`, '-t', String(dur),
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

// Bump these when the generators change so persisted clips regenerate.
const FILLER_VERSION = 5
const FROSTED_VERSION = 8
const THEME_VERSION = 2

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

// Generate `out` via `gen(tmp)`, writing to a unique temp file and atomically
// renaming to `out` only on success — so `out` never exists half-written (a
// concurrent build would otherwise be picked up as a truncated clip).
async function generateToCache(out: string, gen: (tmp: string) => Promise<void>): Promise<string | undefined> {
  if (fs.existsSync(out)) return out
  const tmp = `${out}.${process.pid}.${Date.now()}.tmp.mp4`
  try {
    await gen(tmp)
    if (fs.existsSync(tmp)) fs.renameSync(tmp, out)
  } catch (e) {
    log('warn', 'system', 'Filler generation failed', String(e))
  } finally {
    fs.rmSync(tmp, { force: true }) // no-op once renamed
  }
  return fs.existsSync(out) ? out : undefined
}

// Cache filename for a filler's generated clip. The filler id is baked into the
// name so every variant a filler produces (one per branding logo, duration,
// resolution…) can be swept in one glob when the filler is edited or deleted.
// A shared/default ident (channel fallback, no filler row) uses id 0.
function cacheName(style: string, fillerId: number, keyParts: string): string {
  const hash = createHash('md5').update(keyParts).digest('hex')
  return path.join(dataDir(), `filler-${style}-f${fillerId}-${hash}.mp4`)
}

/** Animated filler for a given loop length + optional baked-in audio (persisted). */
export async function ensureAnimatedFiller(
  dur = 30,
  audioFile?: string,
  onProgress?: ProgressCb,
  dims: Dims = RESOLUTIONS['1080p'],
  fillerId = 0,
): Promise<string | undefined> {
  const d = clampDur(dur)
  const out = cacheName('anim', fillerId, `${d}:${dimKey(dims)}:${fileKey(audioFile)}:v${FILLER_VERSION}`)
  if (fs.existsSync(out)) return out
  log('info', 'system', `Generating animated filler (${d}s ${dimKey(dims)}${audioFile ? ' + audio' : ''})…`)
  return generateToCache(out, async (tmp) => {
    try {
      await runFfmpeg(assembleVideo(animatedBuild(dims, d), d, audioFile, tmp), onProgress, d)
    } catch (e) {
      log('warn', 'system', 'Animated filler failed, using basic gradient fallback', String(e))
      await runFfmpeg(assembleVideo(basicBuild(dims, d), d, audioFile, tmp), onProgress, d)
    }
  })
}

/** Frosted-glass filler, cached by logo + duration + resolution + logo scale + divider + baked audio. */
export async function ensureFrostedFiller(
  logoFile: string,
  dur = 30,
  audioFile?: string,
  onProgress?: ProgressCb,
  dims: Dims = RESOLUTIONS['1080p'],
  scale = 1,
  fillerId = 0,
  divider = false,
): Promise<string | undefined> {
  const d = clampDur(dur)
  const s = clampScale(scale)
  const mzLogo = mosaictvLogoFile()
  if (!mzLogo) {
    log('warn', 'system', 'Frosted filler unavailable (bundled MosaicTV logo not found — expected in production only) — falling back to animated')
    return undefined
  }
  const out = cacheName('frosted', fillerId, `${fileKey(logoFile)}:${d}:${dimKey(dims)}:${s}:${divider ? 'div' : ''}:${fileKey(audioFile)}:v${FROSTED_VERSION}`)
  if (fs.existsSync(out)) return out
  log('info', 'system', `Generating frosted-glass filler for ${path.basename(logoFile)} (${d}s ${dimKey(dims)}${audioFile ? ' + audio' : ''})…`)
  const build = buildStyle('frosted', dims, d, s, logoFile, mzLogo, divider)!
  const clip = await generateToCache(out, (tmp) => runFfmpeg(assembleVideo(build, d, audioFile, tmp), onProgress, d))
  if (!clip) log('warn', 'system', 'Frosted filler generation failed — falling back to animated')
  return clip
}

// The logo-branded (frosted/spotlight/logowall/pulse) and logo-free
// (retro/vintage) generated styles besides plain animated.
async function ensureThemedFiller(
  style: string,
  logoFile: string | undefined,
  dur: number,
  audioFile: string | undefined,
  dims: Dims,
  scale: number,
  fillerId: number,
  onProgress?: ProgressCb,
): Promise<string | undefined> {
  const d = clampDur(dur)
  const s = clampScale(scale)
  const mzLogo = mosaictvLogoFile()
  const build = buildStyle(style, dims, d, s, logoFile, mzLogo)
  if (!build) {
    log('warn', 'system', `${style} filler unavailable (missing logo?) — falling back to animated`)
    return undefined
  }
  const brandKey = ['frosted', 'spotlight', 'logowall', 'pulse'].includes(style) ? `${fileKey(logoFile)}:${s}` : ''
  const out = cacheName(style, fillerId, `${brandKey}:${d}:${dimKey(dims)}:${fileKey(audioFile)}:v${THEME_VERSION}`)
  if (fs.existsSync(out)) return out
  log('info', 'system', `Generating ${style} filler (${d}s ${dimKey(dims)}${audioFile ? ' + audio' : ''})…`)
  const clip = await generateToCache(out, (tmp) => runFfmpeg(assembleVideo(build, d, audioFile, tmp), onProgress, d))
  if (!clip) log('warn', 'system', `${style} filler generation failed — falling back to animated`)
  return clip
}

// Remove every cached clip a filler produced (all branding/duration/resolution
// variants), keyed by the id baked into the filenames. Called when a filler is
// deleted or restyled so old renders don't pile up in the data dir.
export function removeFillerCache(fillerId: number): void {
  if (!fillerId) return
  try {
    const dir = dataDir()
    const re = new RegExp(`^filler-.*-f${fillerId}-.*\\.mp4`)
    for (const f of fs.readdirSync(dir)) if (re.test(f)) fs.rmSync(path.join(dir, f), { force: true })
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
  durationMode: string
  durationSec: number
  logoId: number | null
  resolution: string
  logoScale: number
  divider: boolean
}

const THEMED = new Set(['frosted', 'spotlight', 'logowall', 'pulse', 'retro', 'vintage'])

// A filler's effective loop length: the fixed seconds, or the chosen track's
// length in "match audio" mode.
async function fillerDuration(f: FillerRow, audioFile: string | undefined): Promise<number> {
  let dur = clampDur(f.durationSec)
  if (f.durationMode === 'audio' && audioFile) {
    const probed = await probeDuration(audioFile)
    if (probed > 1) dur = clampDur(probed)
  }
  return dur
}

/**
 * Resolve a Filler to a playable clip (+ music overlaid at playback for custom
 * clips). Generated styles bake the chosen audio in and match its length. Falls
 * back to animated on any failure. `onProgress` reports generation progress.
 *
 * `logoFile` is the logo of wherever this filler is airing; if the filler pins
 * its own brand logo (`logoId`), that wins so it looks the same on every
 * channel it's assigned to.
 */
export async function resolveFillerClip(f: FillerRow, logoFile: string | undefined, onProgress?: ProgressCb): Promise<{ clip?: string; music?: string }> {
  const audioFile = await assetFilePath(f.audioAssetId)
  if (f.logoId != null) logoFile = (await logoFileById(f.logoId, null)) ?? logoFile
  const dims = dimsFor(f.resolution)
  const scale = clampScale(f.logoScale)
  const dur = await fillerDuration(f, audioFile)

  if (f.style === 'custom') {
    const clip = await assetFilePath(f.assetId)
    // A real custom clip plays as-is with the chosen audio overlaid; if missing,
    // fall back to a generated clip with the audio baked in.
    if (clip) return { clip, music: audioFile }
    return { clip: await ensureAnimatedFiller(dur, audioFile, onProgress, dims, f.id) }
  }
  if (f.style === 'frosted' && logoFile) {
    const clip = await ensureFrostedFiller(logoFile, dur, audioFile, onProgress, dims, scale, f.id, f.divider)
    return { clip: clip ?? (await ensureAnimatedFiller(dur, audioFile, onProgress, dims, f.id)) }
  }
  if (THEMED.has(f.style)) {
    const clip = await ensureThemedFiller(f.style, logoFile, dur, audioFile, dims, scale, f.id, onProgress)
    return { clip: clip ?? (await ensureAnimatedFiller(dur, audioFile, onProgress, dims, f.id)) }
  }
  return { clip: await ensureAnimatedFiller(dur, audioFile, onProgress, dims, f.id) }
}

/**
 * Render a single still frame of a filler to `out` (a JPEG). Uses the exact
 * graph the full clip would, so it's a faithful preview of the branded look
 * without the wait — for custom clips it grabs a frame from the source video.
 */
export async function generateFillerStill(f: FillerRow, logoFile: string | undefined, out: string): Promise<void> {
  if (f.logoId != null) logoFile = (await logoFileById(f.logoId, null)) ?? logoFile
  const dims = dimsFor(f.resolution)
  const scale = clampScale(f.logoScale)

  if (f.style === 'custom') {
    const clip = await assetFilePath(f.assetId)
    if (clip) {
      await runFfmpeg(['-y', '-ss', '1', '-i', clip, '-frames:v', '1', '-update', '1', '-q:v', '3', out])
      return
    }
  }
  const mzLogo = mosaictvLogoFile()
  const build =
    (f.style !== 'custom' ? buildStyle(f.style, dims, STILL_DUR, scale, logoFile, mzLogo, f.divider) : null) ??
    animatedBuild(dims, STILL_DUR)
  await runFfmpeg(assembleStill(build, out))
}

/** Where a preview should take its branding from. */
export type FillerLogoContext = { channelId?: number | null; timeBlockId?: number | null }

/**
 * Which logo brands this filler's generated clip. A filler is a global library
 * item, so one definition renders differently everywhere it's assigned: use the
 * requested owner, else the first place it's assigned, so a preview matches what
 * actually airs somewhere rather than the bundled fallback mark.
 */
async function fillerLogoFile(fillerId: number, ctx: FillerLogoContext): Promise<string | undefined> {
  const blockOf = (id: number) =>
    prisma.timeBlock.findUnique({ where: { id }, include: { channel: true, collection: true } })

  let block = ctx.timeBlockId != null ? await blockOf(ctx.timeBlockId) : null
  let channel = !block && ctx.channelId != null ? await prisma.channel.findUnique({ where: { id: ctx.channelId } }) : null

  if (!block && !channel) {
    const a = await prisma.fillerAssignment.findFirst({
      where: { fillerId },
      orderBy: { order: 'asc' },
      include: { channel: true, timeBlock: { include: { channel: true, collection: true } } },
    })
    block = a?.timeBlock ?? null
    channel = a?.channel ?? null
  }

  if (block) {
    return logoFileById(
      block.logoId ?? block.collection.logoId ?? block.channel.logoId,
      block.logoUrl ?? block.channel.logoUrl,
    )
  }
  if (channel) return logoFileById(channel.logoId, channel.logoUrl)
  return logoFileById(null, null) // unassigned: the bundled mark is all we have
}

/**
 * Build (if needed) and return a Filler's branded clip — used by the generate
 * endpoint. `ctx` picks whose logo to brand it with. `onProgress` reports
 * 0..99% during generation.
 */
export async function resolveFillerClipById(
  id: number,
  ctx: FillerLogoContext = {},
  onProgress?: ProgressCb,
): Promise<{ clip?: string; music?: string } | null> {
  const f = await prisma.filler.findUnique({ where: { id } })
  if (!f) return null
  return resolveFillerClip(f, await fillerLogoFile(id, ctx), onProgress)
}

/**
 * Render a still preview from a draft (unsaved) filler definition, branded with
 * the given owner's logo. Returns the on-disk JPEG path (caller streams + deletes
 * it). Nothing is persisted, so previews never accumulate.
 */
export async function generateDraftStill(f: FillerRow, ctx: FillerLogoContext): Promise<string> {
  const logoFile = f.logoId != null ? await logoFileById(f.logoId, null) : await fillerLogoFile(f.id, ctx)
  const out = path.join(previewsDir(), `still-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`)
  await generateFillerStill(f, logoFile, out)
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

/**
 * Pre-build filler at boot so an intermission never blocks on generation: the
 * animated fallback plus every channel/block filler.
 */
export async function warmFiller(): Promise<void> {
  // Sweep any caption files a hard crash left behind (a clean exit removes each
  // after its segment), plus any orphaned still previews (never meant to last).
  try {
    for (const f of fs.readdirSync(dataDir())) {
      if (/^caption-.*\.txt$/.test(f)) fs.rmSync(path.join(dataDir(), f), { force: true })
    }
    for (const f of fs.readdirSync(previewsDir())) fs.rmSync(path.join(previewsDir(), f), { force: true })
  } catch {
    /* best-effort */
  }

  const animated = await ensureAnimatedFiller(30).catch(() => undefined)
  if (animated) log('info', 'system', `Animated filler ready: ${animated}`)
  else log('warn', 'system', 'No filler clip available — gaps will play black')

  const assign = { include: { filler: true }, orderBy: { order: 'asc' as const } }
  const channels = await prisma.channel.findMany({
    include: {
      fillerAssignments: assign,
      timeBlocks: { include: { fillerAssignments: assign, collection: true } },
    },
  })
  const defaultFiller = await loadDefaultFiller()
  for (const ch of channels) {
    const chLogo = await logoFileById(ch.logoId, ch.logoUrl)
    const chFillers = ch.fillerAssignments.map((a) => a.filler)
    // No assigned filler ⇒ the channel falls back to the default station ident,
    // else the frosted-glass ident from its logo — pre-build whichever it gets
    // (else the first gap stalls on it).
    if (chFillers.length === 0 && defaultFiller) await resolveFillerClip(defaultFiller, chLogo).catch(() => {})
    else if (chFillers.length === 0 && chLogo) await ensureFrostedFiller(chLogo).catch(() => {})
    for (const f of chFillers) await resolveFillerClip(f, chLogo).catch(() => {})
    for (const b of ch.timeBlocks) {
      if (b.fillerAssignments.length === 0) continue
      const bLogo = await logoFileById(b.logoId ?? b.collection.logoId ?? ch.logoId, b.logoUrl ?? ch.logoUrl)
      for (const a of b.fillerAssignments) await resolveFillerClip(a.filler, bLogo).catch(() => {})
    }
  }
}
