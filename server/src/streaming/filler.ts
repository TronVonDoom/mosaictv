// Station-ID filler: the generated ident styles (animated, frosted, logo wall,
// pulse, retro, vintage), the on-disk cache that keeps a gap from ever waiting
// on generation, and resolution of a Filler row to a playable clip.

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { prisma } from '../db.js'
import { assetsDir, dataDir } from '../paths.js'
import { log } from '../logs.js'
import { probeDuration } from '../ffprobe.js'
import { runFfmpeg, type ProgressCb } from './run.js'
import { logoFileById } from './logo.js'

export type { ProgressCb }

// Fixed canvas for generated filler clips (playback scales them to the channel's
// profile, so filler needn't match the channel resolution).
export const FILLER_W = 1280
export const FILLER_H = 720
const W = FILLER_W
const H = FILLER_H
const FPS = 30

const clampDur = (d: number) => Math.max(5, Math.min(600, Math.round(d) || 30))

// Audio input for a generated clip: a chosen track (looped) baked in, else a
// soft tone. `-shortest`/`-t` cap the output to the video length.
function audioInput(audioFile: string | undefined, dur: number, toneHz: number, vol: number): string[] {
  return audioFile
    ? ['-stream_loop', '-1', '-i', audioFile]
    : ['-f', 'lavfi', '-i', `sine=f=${toneHz}:d=${dur},volume=${vol}`]
}

// Preferred look: a drifting color gradient with a slow hue sway, animated
// grain and a vignette (visible motion to keep viewers hanging tight). Loops
// smoothly (hue uses a sine that returns to 0 at the end).
function fillerArgsAnimated(out: string, dur: number, audioFile?: string): string[] {
  return [
    '-y',
    '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:d=${dur}:speed=0.05:c0=0x0b1020:c1=0x3b1d60:c2=0x1e3a8a:c3=0x0e7490:nb_colors=4`,
    ...audioInput(audioFile, dur, 110, 0.05),
    '-filter_complex',
    `[0:v]hue=H='0.5*sin(2*PI*t/${dur})':s='1.05+0.05*sin(2*PI*t/${dur})',noise=alls=6:allf=t,vignette=PI/4.5,fps=${FPS},format=yuv420p[v]`,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-shortest', out,
  ]
}

// Proven fallback (the original) in case a filter isn't available on this build.
function fillerArgsBasic(out: string, dur: number, audioFile?: string): string[] {
  return [
    '-y',
    '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:d=${dur}:speed=0.02:c0=0x111827:c1=0x4c1d95:c2=0x1e3a8a:c3=0x0e7490:nb_colors=4`,
    ...audioInput(audioFile, dur, 98, 0.06),
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-shortest', out,
  ]
}

/** Generate a loopable ambient "please stand by" clip (animated, with a fallback). */
export async function generateFiller(out: string, dur = 30, audioFile?: string, onProgress?: ProgressCb): Promise<void> {
  const d = clampDur(dur)
  try {
    await runFfmpeg(fillerArgsAnimated(out, d, audioFile), onProgress, d)
  } catch (e) {
    log('warn', 'system', 'Animated filler failed, using basic gradient fallback', String(e))
    await runFfmpeg(fillerArgsBasic(out, d, audioFile), onProgress, d)
  }
}

// ---- Themed filler presets ------------------------------------------------

// Retro test bars: classic SMPTE color bars with soft analog grain + vignette
// (and the traditional test tone unless audio is chosen).
function fillerArgsRetro(out: string, dur: number, audioFile?: string): string[] {
  return [
    '-y',
    '-f', 'lavfi', '-i', `smptehdbars=s=${W}x${H}:d=${dur}`,
    ...audioInput(audioFile, dur, 440, 0.04),
    '-filter_complex',
    `[0:v]noise=alls=10:allf=t,vignette=PI/5,fps=${FPS},format=yuv420p[v]`,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-shortest', out,
  ]
}

// Vintage film: warm sepia drift with heavy grain and a strong vignette.
function fillerArgsVintage(out: string, dur: number, audioFile?: string): string[] {
  return [
    '-y',
    '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:d=${dur}:speed=0.03:c0=0x2b1a0c:c1=0x4a3018:c2=0x1c1108:c3=0x5a4526:nb_colors=4`,
    ...audioInput(audioFile, dur, 82, 0.05),
    '-filter_complex',
    `[0:v]hue=s=0.35,noise=alls=16:allf=t+u,vignette=PI/3.8,fps=${FPS},format=yuv420p[v]`,
    '-map', '[v]', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-shortest', out,
  ]
}

// Logo wall: dim rows of the logo scrolling in alternating directions over a
// dark gradient, with a sharp logo centered in front. (Frosted's machinery,
// without the glass blur.)
function fillerArgsLogowall(out: string, logoFile: string, dur: number, audioFile?: string): string[] {
  const rowH = 90
  const cellW = 260
  const speed = 40
  const y = (r: number) => r * 180 + 45 // 4 rows across 720
  const leftX = `x='-mod(t*${speed},${cellW})'`
  const rightX = `x='mod(t*${speed},${cellW})-${cellW}'`
  const fc = [
    `[0:v]format=rgba[bg]`,
    `[1:v]split=2[wall][fgin]`,
    `[wall]scale=${cellW}:${rowH}:force_original_aspect_ratio=decrease,pad=${cellW}:${rowH}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,colorchannelmixer=aa=0.16,tile=8x1,split=4[t0][t1][t2][t3]`,
    `[bg][t0]overlay=${leftX}:y=${y(0)}[o0]`,
    `[o0][t1]overlay=${rightX}:y=${y(1)}[o1]`,
    `[o1][t2]overlay=${leftX}:y=${y(2)}[o2]`,
    `[o2][t3]overlay=${rightX}:y=${y(3)}[o3]`,
    `[fgin]scale=-1:200:force_original_aspect_ratio=decrease,format=rgba[fg]`,
    `[o3][fg]overlay=x=(W-w)/2:y=(H-h)/2,fps=${FPS},format=yuv420p[v]`,
  ].join(';')
  return [
    '-y',
    '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:d=${dur}:speed=0.02:c0=0x0a0f1e:c1=0x141b2e:c2=0x0c1526:c3=0x1a2338:nb_colors=4`,
    '-loop', '1', '-i', logoFile,
    ...audioInput(audioFile, dur, 104, 0.05),
    '-filter_complex', fc,
    '-map', '[v]', '-map', '2:a', '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', out,
  ]
}

// Logo pulse: the logo centered on a dark gradient whose brightness slowly
// breathes.
function fillerArgsPulse(out: string, logoFile: string, dur: number, audioFile?: string): string[] {
  const fc = [
    `[0:v]eq=brightness='0.07*sin(2*PI*t/6)':eval=frame,fps=${FPS}[bg]`,
    `[1:v]scale=-1:220:force_original_aspect_ratio=decrease,format=rgba[fg]`,
    `[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2,format=yuv420p[v]`,
  ].join(';')
  return [
    '-y',
    '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:d=${dur}:speed=0.03:c0=0x120a24:c1=0x1e1140:c2=0x0b1530:c3=0x241448:nb_colors=4`,
    '-loop', '1', '-i', logoFile,
    ...audioInput(audioFile, dur, 96, 0.05),
    '-filter_complex', fc,
    '-map', '[v]', '-map', '2:a', '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', out,
  ]
}

// Frosted-glass scene: rows of the channel + MosaicTV logos scrolling opposite
// ways behind a blurred glass panel. In front, the screen is split into two
// equal halves — the channel logo centered in the left half, the MosaicTV logo
// centered in the right — divided by a faint glass seam. Composed per channel.
function frostedArgs(out: string, channelLogo: string, mzLogo: string, D: number, audioFile?: string): string[] {
  const rowH = 90
  const cellW = 260
  const nTile = 8 // strip wide enough to cover the screen + one cell while scrolling
  const speed = 55 // px/sec
  const nRows = 5
  const spacing = Math.floor(H / nRows)
  const y = (r: number) => r * spacing + Math.floor((spacing - rowH) / 2)
  const leftX = `x='-mod(t*${speed},${cellW})'`
  const rightX = `x='mod(t*${speed},${cellW})-${cellW}'`
  const cellChain = `scale=${cellW}:${rowH}:force_original_aspect_ratio=decrease,pad=${cellW}:${rowH}:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba,tile=${nTile}x1`
  const fc = [
    `[0:v]format=rgba[bg]`,
    `[1:v]split=2[chA][chFg]`,
    `[2:v]split=2[mzA][mzFg]`,
    `[chA]${cellChain},split=3[ch0][ch1][ch2]`,
    `[mzA]${cellChain},split=2[mz0][mz1]`,
    `[bg][ch0]overlay=${leftX}:y=${y(0)}[r0]`,
    `[r0][mz0]overlay=${rightX}:y=${y(1)}[r1]`,
    `[r1][ch1]overlay=${leftX}:y=${y(2)}[r2]`,
    `[r2][mz1]overlay=${rightX}:y=${y(3)}[r3]`,
    `[r3][ch2]overlay=${leftX}:y=${y(4)}[rows]`,
    // Frost: blur the scrolling layer, tint it like glass, and draw a faint
    // vertical seam down the middle so the two halves read as side-by-side panes.
    `[rows]boxblur=14:2,drawbox=x=0:y=0:w=iw:h=ih:color=white@0.07:t=fill,drawbox=x=(iw-2)/2:y=0:w=2:h=ih:color=white@0.10:t=fill[frost]`,
    // Sharp foreground logos in front of the glass. Each is capped to ~40% of
    // the frame width so a wide logo stays inside its own half.
    `[chFg]scale='min(iw,${Math.floor(W * 0.4)})':180:force_original_aspect_ratio=decrease,format=rgba[chfg]`,
    `[mzFg]scale='min(iw,${Math.floor(W * 0.4)})':120:force_original_aspect_ratio=decrease,format=rgba[mzfg]`,
    // Channel logo centered in the left half; MosaicTV logo centered in the right.
    `[frost][chfg]overlay=x=(W/2-w)/2:y=(H-h)/2[f1]`,
    `[f1][mzfg]overlay=x=W/2+(W/2-w)/2:y=(H-h)/2,format=yuv420p[v]`,
  ].join(';')
  return [
    '-y',
    '-f', 'lavfi', '-i', `gradients=s=${W}x${H}:d=${D}:speed=0.04:c0=0x0b1020:c1=0x2a1150:c2=0x10233f:c3=0x0e2f3a:nb_colors=4`,
    '-loop', '1', '-i', channelLogo,
    '-loop', '1', '-i', mzLogo,
    ...audioInput(audioFile, D, 90, 0.04),
    '-filter_complex', fc,
    '-map', '[v]', '-map', '3:a', '-t', String(D),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', out,
  ]
}

export function generateFrostedFiller(out: string, channelLogo: string, mzLogo: string, dur = 30, audioFile?: string, onProgress?: ProgressCb): Promise<void> {
  const d = clampDur(dur)
  return runFfmpeg(frostedArgs(out, channelLogo, mzLogo, d, audioFile), onProgress, d)
}

// Bundled MosaicTV brand mark used in the frosted-glass filler. Only present
// when process.cwd()/public exists (production, or local dev after copying
// the built frontend there) — undefined in plain local dev, in which case
// callers skip frosted generation instead of handing ffmpeg a missing file.
function mosaictvLogoFile(): string | undefined {
  const wide = path.join(process.cwd(), 'public', 'logo-wide.png')
  if (fs.existsSync(wide)) return wide
  const icon = path.join(process.cwd(), 'public', 'mosaictv-icon.png')
  return fs.existsSync(icon) ? icon : undefined
}

// ---- On-disk cache ----------------------------------------------------------

// Bump these when the generators change so persisted clips regenerate.
const FILLER_VERSION = 4
const FROSTED_VERSION = 4
const THEME_VERSION = 1

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

/** Animated filler for a given loop length + optional baked-in audio (persisted). */
export async function ensureAnimatedFiller(dur = 30, audioFile?: string, onProgress?: ProgressCb): Promise<string | undefined> {
  const d = clampDur(dur)
  const suffix = audioFile ? createHash('md5').update(`${d}:${fileKey(audioFile)}`).digest('hex') : `d${d}`
  const out = path.join(dataDir(), `filler-anim-v${FILLER_VERSION}-${suffix}.mp4`)
  if (fs.existsSync(out)) return out
  log('info', 'system', `Generating animated filler (${d}s${audioFile ? ' + audio' : ''})…`)
  return generateToCache(out, (tmp) => generateFiller(tmp, d, audioFile, onProgress))
}

/** Frosted-glass filler, cached by logo + duration + baked audio. */
export async function ensureFrostedFiller(logoFile: string, dur = 30, audioFile?: string, onProgress?: ProgressCb): Promise<string | undefined> {
  const d = clampDur(dur)
  const mzLogo = mosaictvLogoFile()
  if (!mzLogo) {
    log('warn', 'system', 'Frosted filler unavailable (bundled MosaicTV logo not found — expected in production only) — falling back to animated')
    return undefined
  }
  const key = createHash('md5').update(`${fileKey(logoFile)}:${d}:${fileKey(audioFile)}:v${FROSTED_VERSION}`).digest('hex')
  const out = path.join(dataDir(), `filler-frosted-${key}.mp4`)
  if (fs.existsSync(out)) return out
  log('info', 'system', `Generating frosted-glass filler for logo ${path.basename(logoFile)} (${d}s${audioFile ? ' + audio' : ''})…`)
  const clip = await generateToCache(out, (tmp) => generateFrostedFiller(tmp, logoFile, mzLogo, d, audioFile, onProgress))
  if (!clip) log('warn', 'system', 'Frosted filler generation failed — falling back to animated')
  return clip
}

// Themed presets besides animated/frosted. "logowall"/"pulse" brand with the
// active logo; "retro"/"vintage" are logo-free (the live watermark still
// overlays during playback).
async function ensureThemedFiller(
  style: string,
  logoFile: string | undefined,
  dur = 30,
  audioFile?: string,
  onProgress?: ProgressCb,
): Promise<string | undefined> {
  const d = clampDur(dur)
  const key = createHash('md5')
    .update(`${style}:${logoFile ? fileKey(logoFile) : ''}:${d}:${fileKey(audioFile)}:v${THEME_VERSION}`)
    .digest('hex')
  const out = path.join(dataDir(), `filler-${style}-${key}.mp4`)
  if (fs.existsSync(out)) return out
  log('info', 'system', `Generating ${style} filler (${d}s${audioFile ? ' + audio' : ''})…`)
  const clip = await generateToCache(out, async (tmp) => {
    let args: string[] | null = null
    if (style === 'retro') args = fillerArgsRetro(tmp, d, audioFile)
    else if (style === 'vintage') args = fillerArgsVintage(tmp, d, audioFile)
    else if (style === 'logowall' && logoFile) args = fillerArgsLogowall(tmp, logoFile, d, audioFile)
    else if (style === 'pulse' && logoFile) args = fillerArgsPulse(tmp, logoFile, d, audioFile)
    if (!args) throw new Error(`theme "${style}" unavailable (missing logo?)`)
    await runFfmpeg(args, onProgress, d)
  })
  if (!clip) log('warn', 'system', `${style} filler generation failed — falling back to animated`)
  return clip
}

// ---- Resolution -------------------------------------------------------------

type FillerRow = { style: string; assetId: number | null; audioAssetId: number | null; durationMode: string; durationSec: number }

/**
 * Resolve a Filler to a playable clip (+ music overlaid at playback for custom
 * clips). Generated styles bake the chosen audio in and match its length. Falls
 * back to animated on any failure. `onProgress` reports generation progress.
 */
export async function resolveFillerClip(f: FillerRow, logoFile: string | undefined, onProgress?: ProgressCb): Promise<{ clip?: string; music?: string }> {
  const audioFile = await assetFilePath(f.audioAssetId)
  let dur = clampDur(f.durationSec)
  if (f.durationMode === 'audio' && audioFile) {
    const probed = await probeDuration(audioFile)
    if (probed > 1) dur = clampDur(probed)
  }
  if (f.style === 'custom') {
    const clip = await assetFilePath(f.assetId)
    // A real custom clip plays as-is with the chosen audio overlaid; if missing,
    // fall back to a generated clip with the audio baked in.
    if (clip) return { clip, music: audioFile }
    return { clip: await ensureAnimatedFiller(dur, audioFile, onProgress) }
  }
  if (f.style === 'frosted' && logoFile) {
    const clip = await ensureFrostedFiller(logoFile, dur, audioFile, onProgress)
    return { clip: clip ?? (await ensureAnimatedFiller(dur, audioFile, onProgress)) }
  }
  if (['logowall', 'pulse', 'retro', 'vintage'].includes(f.style)) {
    const clip = await ensureThemedFiller(f.style, logoFile, dur, audioFile, onProgress)
    return { clip: clip ?? (await ensureAnimatedFiller(dur, audioFile, onProgress)) }
  }
  return { clip: await ensureAnimatedFiller(dur, audioFile, onProgress) }
}

/**
 * Build (if needed) and return a Filler's branded clip — used by the generate
 * endpoint. `onProgress` reports 0..99% during generation.
 */
export async function resolveFillerClipById(id: number, onProgress?: ProgressCb): Promise<{ clip?: string; music?: string } | null> {
  const f = await prisma.filler.findUnique({
    where: { id },
    include: { channel: true, timeBlock: { include: { channel: true, collection: true } } },
  })
  if (!f) return null
  let logoId: number | null = null
  let logoUrl: string | null = null
  if (f.timeBlock) {
    logoId = f.timeBlock.logoId ?? f.timeBlock.collection.logoId ?? f.timeBlock.channel.logoId
    logoUrl = f.timeBlock.logoUrl ?? f.timeBlock.channel.logoUrl
  } else if (f.channel) {
    logoId = f.channel.logoId
    logoUrl = f.channel.logoUrl
  }
  return resolveFillerClip(f, await logoFileById(logoId, logoUrl), onProgress)
}

/**
 * Pre-build filler at boot so an intermission never blocks on generation: the
 * animated fallback plus every channel/block filler.
 */
export async function warmFiller(): Promise<void> {
  // Sweep any caption files left behind by a hard crash (a clean exit removes
  // each after its segment).
  try {
    for (const f of fs.readdirSync(dataDir())) {
      if (/^caption-.*\.txt$/.test(f)) fs.rmSync(path.join(dataDir(), f), { force: true })
    }
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
  for (const ch of channels) {
    const chLogo = await logoFileById(ch.logoId, ch.logoUrl)
    const chFillers = ch.fillerAssignments.map((a) => a.filler)
    // No assigned filler ⇒ the channel falls back to the frosted-glass ident,
    // so pre-build that from its logo too (else the first gap stalls on it).
    if (chFillers.length === 0 && chLogo) await ensureFrostedFiller(chLogo).catch(() => {})
    for (const f of chFillers) await resolveFillerClip(f, chLogo).catch(() => {})
    for (const b of ch.timeBlocks) {
      if (b.fillerAssignments.length === 0) continue
      const bLogo = await logoFileById(b.logoId ?? b.collection.logoId ?? ch.logoId, b.logoUrl ?? ch.logoUrl)
      for (const a of b.fillerAssignments) await resolveFillerClip(a.filler, bLogo).catch(() => {})
    }
  }
}
