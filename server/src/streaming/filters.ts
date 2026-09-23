// Building the ffmpeg command for one on-air segment: the video/audio filter
// chains (scale, deinterlace, subtitles, watermark, info cards) and
// the argument list that wraps them. Pure string construction — nothing here
// spawns a process or touches the database.

import { encoderArgs } from './capabilities.js'
import { VAAPI_DEVICE, type StreamProfile } from './profile.js'
import type { CardPosition, ComingUpConfig, WatermarkConfig } from './overlays.js'
import type { RenderedCard } from './card.js'

export type Segment = {
  filePath: string
  offsetSec: number // seek into the file (first item only)
  durationSec?: number // cap output length (filler loop); undefined = play to EOF
  loop: boolean // loop the input (filler)
  hasAudio: boolean
  // Which of the file's audio tracks to air, as an `a:N` index. 0 unless the
  // channel prefers a language the file carries on a later track.
  audioTrack?: number
  logo?: string // logo file path or http url
  wmEpochSec: number // segment's absolute start time (s) — aligns intermittent watermark to wall clock
  mediaWidth: number // source pixel dims (for constrain-to-media watermark)
  mediaHeight: number
  musicPath?: string // looped ambient audio (filler only) — overrides clip audio
  isFiller: boolean
  // Ramp the watermark up/down across a boundary where it is about to appear or
  // disappear (i.e. next to filler that isn't showing it). 0 = no ramp.
  fadeInSec: number
  fadeOutSec: number
  // Decode this input on the GPU (-hwaccel cuda). Set only when the probe says
  // the GPU handles this file's codec; ffmpeg still soft-falls-back to CPU
  // decode if a particular file trips it up.
  hwDecode?: boolean
  // Burn the source's first subtitle stream into the picture (programs only,
  // set when the profile asks for it and the file actually has subtitles).
  hasSubtitles?: boolean
}

// Escape a file path for use inside an ffmpeg filter argument (the subtitles
// filter's filename): backslashes, colons, and single quotes are special.
function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

// ---- Watermark --------------------------------------------------------------

// The rectangle the picture occupies inside the WxH output canvas after
// aspect-preserving fit (pillar/letterbox). Used to constrain the watermark to
// the media. When not constraining, this is the whole canvas.
type Rect = { x0: number; y0: number; mw: number; mh: number }
function mediaRect(mediaW: number, mediaH: number, constrain: boolean, cw: number, ch: number): Rect {
  if (!constrain || !mediaW || !mediaH) return { x0: 0, y0: 0, mw: cw, mh: ch }
  const ar = mediaW / mediaH
  const canvasAR = cw / ch
  let mw: number
  let mh: number
  if (ar >= canvasAR) {
    mw = cw
    mh = Math.round(cw / ar)
  } else {
    mh = ch
    mw = Math.round(ch * ar)
  }
  return { x0: Math.round((cw - mw) / 2), y0: Math.round((ch - mh) / 2), mw, mh }
}

/**
 * Whether the watermark needs a per-frame alpha ramp (vs a cheap static alpha):
 * either the intermittent cycle fades, or it has to ramp across a filler edge.
 */
function wantsFade(wm: WatermarkConfig, seg?: Pick<Segment, 'fadeInSec' | 'fadeOutSec'>): boolean {
  const cycleFades = wm.mode === 'intermittent' && Math.min(wm.fadeSeconds, wm.durationSeconds / 2) > 0
  const edgeFades = (seg?.fadeInSec ?? 0) > 0 || (seg?.fadeOutSec ?? 0) > 0
  return cycleFades || edgeFades
}

// Build the logo scale + opacity chain, overlay position, and (for intermittent
// mode) a timeline `enable` expression that shows the logo for `durationSeconds`
// every `frequencyMinutes`, aligned to wall-clock time so every viewer sees it
// at the same moment. `wmEpochSec` is the segment's absolute start time in
// seconds; `t` inside the expression is the segment-relative time.
function watermarkGraph(
  wm: WatermarkConfig,
  logoIdx: number,
  wmEpochSec: number,
  rect: Rect,
  fps: number,
  fading: boolean,
  fadeInSec: number,
  fadeOutSec: number,
  totalFrames: number,
): { logoChain: string; overlayPos: string; overlayExtra: string } {
  const LW = Math.max(2, Math.round((rect.mw * wm.widthPercent) / 100))
  const MX = Math.round((rect.mw * wm.horizontalMarginPercent) / 100)
  const MY = Math.round((rect.mh * wm.verticalMarginPercent) / 100)
  const left = rect.x0 + MX
  const top = rect.y0 + MY
  const right = rect.x0 + rect.mw - MX // right edge of the logo box
  const bottom = rect.y0 + rect.mh - MY // bottom edge of the logo box
  const positions: Record<string, string> = {
    'top-left': `${left}:${top}`,
    'top-right': `${right}-w:${top}`,
    'bottom-left': `${left}:${bottom}-h`,
    'bottom-right': `${right}-w:${bottom}-h`,
  }
  const overlayPos = positions[wm.position] ?? positions['bottom-right']
  const opacity = Math.max(0, Math.min(1, wm.opacityPercent / 100))
  const BO = opacity.toFixed(3)
  const scale = `[${logoIdx}:v]scale=${LW}:-2`

  const P = Math.max(1, Math.round(wm.frequencyMinutes * 60)) // period, seconds
  const D = Math.max(1, Math.round(wm.durationSeconds)) // visible window, seconds

  if (!fading) {
    // Static alpha via colorchannelmixer — cheap and reliable. Intermittent
    // still gates on a wall-clock-aligned window; permanent just stays on.
    return {
      logoChain: `${scale},format=rgba,colorchannelmixer=aa=${BO}[lg]`,
      overlayPos,
      // Single-quoted so the commas aren't parsed as filtergraph separators.
      overlayExtra:
        wm.mode === 'intermittent' ? `:enable='lt(mod(t+${wmEpochSec.toFixed(1)},${P}),${D})'` : '',
    }
  }

  // Per-frame alpha, which `enable` (a hard on/off) can't express and
  // colorchannelmixer (one static value) can't either — so drive it with geq.
  //
  // Two constraints, both learned the hard way:
  //  - geq must get PLANAR rgba (gbrap); on packed rgba it silently corrupts.
  //  - geq's `T` is broken in ffmpeg 8.1, but frame number `N` works, so the
  //    envelope is expressed in frames. N counts from this segment's first
  //    frame, which is what the edge ramps below want anyway.
  const terms: string[] = []

  if (wm.mode === 'intermittent') {
    const fade = Math.max(0, Math.min(wm.fadeSeconds, D / 2)) // can't fade longer than half the window
    const PF = Math.max(1, Math.round(P * fps))
    const DF = Math.max(1, Math.round(D * fps))
    // Phase-shift by the segment's wall-clock start so the cycle stays
    // continuous across segments and every viewer sees it at the same moment.
    const PH = Math.round(wmEpochSec * fps) % PF
    const n = `mod(N+${PH},${PF})` // frames since the window opened
    if (fade > 0) {
      const FF = Math.max(1, Math.round(fade * fps))
      // Ramp up over FF, hold, ramp down to zero at DF, dark until the period wraps.
      terms.push(`clip(min(${n}/${FF},(${DF}-${n})/${FF}),0,1)`)
    } else {
      terms.push(`lt(${n},${DF})`) // hard on/off window
    }
  }

  // Edge ramps for a boundary with filler that isn't showing the logo.
  if (fadeInSec > 0) {
    terms.push(`clip(N/${Math.max(1, Math.round(fadeInSec * fps))},0,1)`)
  }
  if (fadeOutSec > 0 && totalFrames > 0) {
    terms.push(`clip((${totalFrames}-N)/${Math.max(1, Math.round(fadeOutSec * fps))},0,1)`)
  }

  // Scale the logo's OWN alpha — never replace it. A constant here would make
  // every pixel opaque, turning the transparent surround (which is transparent
  // *black*) into a solid box behind the logo.
  const env = terms.length ? terms.join('*') : '1'
  const alpha = `alpha(X,Y)*${opacity.toFixed(3)}*${env}`
  const logoChain = `${scale},format=gbrap,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'[lg]`
  return { logoChain, overlayPos, overlayExtra: '' }
}

// ---- Info cards ("Up next", "Now playing") --------------------------------

/**
 * Encode-relative windows (seconds) in which the up-next card is visible. The
 * program can outlast this encode — a broadcast episode is several playout
 * rows, and the card belongs to the whole episode — so the timings are
 * measured on the program and clamped to this encode; a window that falls in
 * another of its segments is dropped here and drawn there.
 */
export function comingUpWindows(
  cfg: ComingUpConfig,
  t: {
    encodeSec: number // how long this encode runs
    untilEndSec: number // from this encode's start to the program's end
    programSec: number // the whole program's length
    intoProgramSec: number // how far into the program this encode starts
  },
): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = []
  const clampWin = (a: number, b: number) => {
    const A = Math.max(0, a)
    const B = Math.min(t.encodeSec, b)
    if (B - A > 0.5) out.push({ a: A, b: B })
  }
  if (cfg.timing === 'beforeEnd' || cfg.timing === 'both') {
    const start = t.untilEndSec - cfg.leadSeconds
    clampWin(start, start + cfg.holdSeconds)
  }
  if (cfg.timing === 'middle' || cfg.timing === 'both') {
    // The program's midpoint on this encode's clock. Tuned in past it, or in
    // another segment, it lands outside the encode and the clamp drops it.
    const mid = t.programSec / 2 - t.intoProgramSec
    clampWin(mid - cfg.holdSeconds / 2, mid + cfg.holdSeconds / 2)
  }
  return out
}

/**
 * An info card to composite: the PNG card.ts rendered (plus, for glass, its
 * shape mask), where its box lands on the frame, when it's up, and which edge
 * it slides in from.
 */
export type CardOverlay = {
  card: RenderedCard
  x: number
  y: number
  windows: { a: number; b: number }[]
  fadeSec: number
  scale: number
  /** The direction it enters from, e.g. [-1, 0] = from the left. */
  from: [number, number]
}

/** The side a card at `position` is drawn from (card.ts CardAnchor). */
export function cardAnchor(position: CardPosition): 'left' | 'center' | 'right' {
  return position.endsWith('left') ? 'left' : position.endsWith('right') ? 'right' : 'center'
}

/**
 * The edge a card slides in from: its own side for the left and right
 * columns, the top or bottom edge for the middle of either.
 */
export function cardEntry(position: CardPosition): [number, number] {
  if (position.endsWith('left')) return [-1, 0]
  if (position.endsWith('right')) return [1, 0]
  return position.startsWith('top') ? [0, -1] : [0, 1]
}

/**
 * Where a card's box sits: against any edge or corner of the picture, clear of
 * it by a margin (or centred along it). On a pillarboxed 4:3 show `rect` is the
 * picture, so the card lands on the image rather than out on the black bars.
 */
export function placeCard(
  rect: { x0: number; y0: number; mw: number; mh: number },
  frame: { width: number; height: number },
  box: { w: number; h: number },
  position: CardPosition,
  scale: number,
): { x: number; y: number } {
  const mx = Math.max(24 * scale, rect.mw * 0.04)
  const my = Math.max(24 * scale, rect.mh * 0.06)
  const [v, hz] = position.split('-') as ['top' | 'middle' | 'bottom', 'left' | 'center' | 'right']
  const x = hz === 'left' ? rect.x0 + mx : hz === 'right' ? rect.x0 + rect.mw - mx - box.w : rect.x0 + (rect.mw - box.w) / 2
  const y = v === 'top' ? rect.y0 + my : v === 'bottom' ? rect.y0 + rect.mh - my - box.h : rect.y0 + (rect.mh - box.h) / 2
  const even = (n: number, max: number) => Math.max(0, Math.min(max, 2 * Math.floor(n / 2)))
  return { x: even(x, frame.width - box.w), y: even(y, frame.height - box.h) }
}

/** The picture's rectangle on the output canvas for a card (the whole canvas unless padded). */
export function cardRect(seg: Pick<Segment, 'mediaWidth' | 'mediaHeight'>, p: StreamProfile): Rect {
  return mediaRect(seg.mediaWidth, seg.mediaHeight, p.scalingMode === 'pad', p.width, p.height)
}

/**
 * Composite `cards` over the frame labelled `input`, ending at `output`. For a
 * glass card the picture behind it is blurred and cut to its shape (the
 * frosted glass); the rendered card goes over that — or over a transparent
 * layer for a card with no glass — and the whole layer slides in from its edge
 * as it fades in, and back out. `inputIdx` maps each card to its [png, mask]
 * ffmpeg input indexes (mask -1 without glass).
 */
function cardsGraph(cards: CardOverlay[], inputIdx: [number, number][], input: string, output: string, fps: number): string {
  const parts: string[] = []
  let cur = input
  cards.forEach((c, k) => {
    const { card } = c
    const L = `ic${k}`
    const on = c.windows.map((w) => `between(t,${w.a.toFixed(2)},${w.b.toFixed(2)})`).join('+')
    const [pngIdx, maskIdx] = inputIdx[k]
    // Where the PNG's top-left lands on the frame.
    const lx = c.x - card.box.x
    const ly = c.y - card.box.y
    // This branch sees every frame of the program, and the card is up for
    // seconds of it, so everything that can idle does — the blur, the mask, the
    // compositing and the fades are all switched on only while the card is up —
    // and it stays in the video's own YUV (with alpha): an RGB round trip here
    // cost a quarter more CPU on the whole encode. The card PNG is converted
    // once; overlay repeats its single frame.
    let base = cur
    if (card.frost && maskIdx >= 0) {
      const f = card.frost
      base = `${L}m`
      parts.push(`[${cur}]split=2[${L}m][${L}s]`)
      parts.push(`[${L}s]crop=${f.w}:${f.h}:${lx + f.x}:${ly + f.y},gblur=sigma=${(16 * c.scale).toFixed(1)}:enable='${on}'[${L}b]`)
      parts.push(`[${L}b][${maskIdx}:v]alphamerge=enable='${on}',pad=${card.width}:${card.height}:${f.x}:${f.y}:color=black@0[${L}g]`)
    } else {
      parts.push(`color=c=black@0:s=${card.width}x${card.height}:r=${fps},format=yuva420p[${L}g]`)
    }
    parts.push(`[${L}g][${pngIdx}:v]overlay=0:0:enable='${on}'[${L}l]`)
    const n = c.windows.length
    if (n > 1) parts.push(`[${L}l]split=${n}${c.windows.map((_, i) => `[${L}l${i}]`).join('')}`)
    const F = c.fadeSec
    const D = 56 * c.scale
    const [dx, dy] = c.from
    c.windows.forEach((w, i) => {
      const src = n > 1 ? `${L}l${i}` : `${L}l`
      const a = w.a.toFixed(2)
      const b = w.b.toFixed(2)
      // The slide takes the whole fade time; the opacity settles in the first
      // 60% of it, so the card is plainly visible while it glides into place
      // (and the same in reverse on the way out).
      const move = F > 0 ? Math.min(F, (w.b - w.a) / 2) : 0
      const op = (move * 0.6).toFixed(2)
      const fade =
        move > 0
          ? `fade=t=in:st=${a}:d=${op}:alpha=1:enable='between(t,${a},${b})',fade=t=out:st=${(w.b - move * 0.6).toFixed(2)}:d=${op}:alpha=1:enable='between(t,${a},${b})'`
          : 'null'
      parts.push(`[${src}]${fade}[${L}f${i}]`)
      // Eased: out on the way in, in on the way out.
      const offset = `(pow(1-clip((t-${a})/${move.toFixed(2)},0,1),3)+pow(clip((t-${(w.b - move).toFixed(2)})/${move.toFixed(2)},0,1),3))`
      const along = (pos: number, dir: number) => (move > 0 && dir ? `${pos}${dir > 0 ? '+' : '-'}${D.toFixed(1)}*${offset}` : String(pos))
      const out = k === cards.length - 1 && i === n - 1 ? output : `${L}o${i}`
      parts.push(`[${base}][${L}f${i}]overlay=x='${along(lx, dx)}':y='${along(ly, dy)}':enable='between(t,${a},${b})'[${out}]`)
      base = out
    })
    cur = base
  })
  return parts.join(';')
}

// ---- Full command construction ----------------------------------------------

/**
 * Where the encoded segment goes. `hls` writes a child HLS playlist + mpegts
 * segments to disk, which the segmenter ingests into a channel-wide playlist —
 * one encode stage, no second ffmpeg (see segmenter.ts); this is what the
 * pipeline uses. `mpegts-pipe` writes a raw MPEG-TS stream to stdout instead,
 * kept as a general-purpose output option.
 */
export type FfmpegOutput =
  | { kind: 'mpegts-pipe' }
  | { kind: 'hls'; playlist: string; segmentFilename: string; hlsTimeSec: number }

// The output stanza for a finished command. mpegts-pipe writes the muxed TS to
// stdout; hls writes each finalized segment to disk and lists it in a child
// playlist (list_size 0 = keep them all, so the segmenter sees every one).
// `temp_file` makes ffmpeg write each segment to a .tmp and rename on close, so
// a reader never catches a half-written file.
function outputArgs(output: FfmpegOutput): string[] {
  if (output.kind === 'hls') {
    return [
      '-f', 'hls',
      '-hls_time', String(output.hlsTimeSec),
      '-hls_list_size', '0',
      '-hls_flags', 'independent_segments+temp_file',
      '-hls_segment_type', 'mpegts',
      '-hls_segment_filename', output.segmentFilename,
      output.playlist,
    ]
  }
  return ['-mpegts_flags', '+resend_headers', '-f', 'mpegts', '-muxpreload', '0', '-muxdelay', '0', 'pipe:1']
}

/** The ffmpeg command that encodes one on-air segment — to MPEG-TS on stdout by
 *  default, or to on-disk HLS segments when `output` says so (the v2 segmenter). */
export function ffmpegArgs(seg: Segment, enc: string, wm: WatermarkConfig, p: StreamProfile, cards: CardOverlay[] = [], readrate?: string[], output: FfmpegOutput = { kind: 'mpegts-pipe' }): string[] {
  // Filler is usually built out of the logo already, so the bug goes on top of
  // it only if explicitly asked for.
  const useWatermark = wm.mode !== 'none' && !!seg.logo && (!seg.isFiller || wm.showOnFiller)
  // Fading loops the still logo into an endless stream, which only terminates
  // because `-t` caps the output — so require a known positive duration and
  // fall back to a hard cut otherwise rather than risk a stream that never ends.
  const fading = useWatermark && wantsFade(wm, seg) && (seg.durationSec ?? 0) > 0
  const a: string[] = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-fflags', '+genpts']
  // GPU decode: frames come back to system memory (no -hwaccel_output_format),
  // so the CPU filter graph below works unchanged — only the decode moves.
  if (seg.hwDecode) a.push('-hwaccel', 'cuda')
  // VAAPI encodes from a hardware surface; init the render node up front so the
  // hwupload filter (appended below) has a device to use.
  if (enc === 'h264_vaapi') a.push('-vaapi_device', VAAPI_DEVICE)
  if (seg.offsetSec > 0.1) a.push('-ss', seg.offsetSec.toFixed(3))
  if (seg.loop) a.push('-stream_loop', '-1')
  // Meter the read at real time (`readrate` = -readrate 1.0 + a connect burst) so
  // a cheap-to-decode source can't race minutes ahead of the wall clock. The
  // burst still front-loads a few seconds, so a little of the item stays buffered
  // and ready the moment the previous one ends. NOT bare -re: with no burst this
  // pacer and the outer concat's would have no slack to absorb a seam and could
  // starve each other — the trap the old unpaced design was avoiding. Without the
  // cap the outer meter is the only brake, and the shared-HLS path (segments to
  // disk, no consumer backpressure) has nothing behind it: a 480p source outran
  // by ~20x, finished its slot early, and tripped the replay guard's hold.
  if (readrate) a.push(...readrate)
  a.push('-i', seg.filePath) // input 0 = main video

  let idx = 1
  let logoIdx = -1
  if (useWatermark) {
    logoIdx = idx++
    // A still logo decodes to a single frame, which overlay just repeats — fine
    // for a static alpha, but the fade envelope is driven by the logo's own
    // frame counter, so it needs a real stream ticking at the profile's rate.
    if (fading) a.push('-loop', '1', '-framerate', String(p.fps))
    a.push('-i', seg.logo as string)
  }
  // Audio source: ambient music (looped) overrides the clip's own audio; else
  // silence when the source has none.
  let audioIdx = -1 // -1 = use the main input's audio (0:a)
  if (seg.musicPath) {
    audioIdx = idx++
    a.push('-stream_loop', '-1', '-i', seg.musicPath)
  } else if (!seg.hasAudio) {
    audioIdx = idx++
    a.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
  }
  // Info cards: each a still PNG and its shape mask, read once — overlay and
  // alphamerge repeat a single frame. They must come before -t, which after
  // them would bind to the last input instead of the output.
  const cardInputs: [number, number][] = cards.map((c) => {
    a.push('-i', c.card.png)
    const png = idx++
    if (!c.card.mask) return [png, -1]
    a.push('-i', c.card.mask)
    return [png, idx++]
  })
  if (seg.durationSec) a.push('-t', seg.durationSec.toFixed(3))

  // Deinterlace before scaling, or the comb artifacts get resampled into the
  // output. `deint=interlaced` only touches frames actually flagged interlaced,
  // so progressive material passes through untouched — that's the "auto" part.
  const deint = p.deinterlace ? 'yadif=deint=interlaced,' : ''
  // De-anamorphize (scale=iw*sar:ih) so non-square-pixel sources (e.g. 720x480
  // DVD content) aren't horizontally stretched, then fit to the profile
  // resolution. Reset per-segment timestamps so concatenated segments stay in sync.
  const fit =
    p.scalingMode === 'stretch'
      ? `scale=${p.width}:${p.height}`
      : p.scalingMode === 'crop'
        ? `scale=${p.width}:${p.height}:force_original_aspect_ratio=increase,crop=${p.width}:${p.height}`
        : `scale=${p.width}:${p.height}:force_original_aspect_ratio=decrease,pad=${p.width}:${p.height}:(ow-iw)/2:(oh-ih)/2`
  // Burn the source's subtitles onto the scaled frame (programs only). The
  // subtitles filter re-opens the file for its own subtitle stream; it renders
  // scaled to the frame it's applied to, so it goes after the fit-to-output.
  const subs = seg.hasSubtitles && !seg.isFiller ? `subtitles=filename='${escapeFilterPath(seg.filePath)}',` : ''
  const base = `[0:v]${deint}scale=iw*sar:ih,${fit},setsar=1,${subs}fps=${p.fps},format=yuv420p,setpts=PTS-STARTPTS`
  let vf: string
  if (useWatermark) {
    // Only "pad" leaves bars to stay clear of; stretch and crop fill the canvas.
    const constrain = wm.constrainToMedia && p.scalingMode === 'pad'
    const rect = mediaRect(seg.mediaWidth, seg.mediaHeight, constrain, p.width, p.height)
    const totalFrames = Math.round((seg.durationSec ?? 0) * p.fps)
    const wg = watermarkGraph(wm, logoIdx, seg.wmEpochSec, rect, p.fps, fading, seg.fadeInSec, seg.fadeOutSec, totalFrames)
    vf = `${base}[bg];${wg.logoChain};[bg][lg]overlay=${wg.overlayPos}${wg.overlayExtra}${cards.length ? '[vpre]' : '[v]'}`
  } else {
    vf = `${base}${cards.length ? '[vpre]' : '[v]'}`
  }
  // The info cards go last, on top of everything else.
  if (cards.length) vf += ';' + cardsGraph(cards, cardInputs, 'vpre', 'v', p.fps)
  // VAAPI: upload the finished software frame to a GPU surface for the encoder.
  if (enc === 'h264_vaapi') vf = vf.replace(/\[v\]$/, '[vsw]') + ';[vsw]format=nv12,hwupload[v]'
  // A generated audio input (ambient music, silence) is always its own stream
  // 0; only the clip's own audio has tracks to choose between.
  const aIn = audioIdx >= 0 ? `${audioIdx}:a:0` : `0:a:${seg.audioTrack ?? 0}`
  const layout = p.audioChannels === 6 ? '5.1' : 'stereo'
  // Evens out the jump between a 1970s sitcom and a modern show. dynaudnorm,
  // not loudnorm: loudnorm looks 3s ahead, and since the muxer can't interleave
  // without audio, that became 3s of dead air at every single transition
  // (measured: 1.0s -> 3.0s to first byte). dynaudnorm adapts continuously and
  // costs nothing at startup — less exact than R128, but this is live TV.
  const loud = p.normalizeLoudness ? 'dynaudnorm=f=150:g=5,' : ''
  const af = `[${aIn}]asetpts=PTS-STARTPTS,${loud}aresample=48000,aformat=channel_layouts=${layout}[a]`

  a.push('-filter_complex', `${vf};${af}`, '-map', '[v]', '-map', '[a]')
  if (p.threads > 0) a.push('-threads', String(p.threads))
  a.push(...encoderArgs(enc, p))
  a.push('-c:a', 'aac', '-ar', '48000', '-ac', String(p.audioChannels), '-b:a', `${p.audioBitrate}k`)
  // Each item starts at timestamp 0 (setpts above). Each item is its own HLS
  // child and the boundary becomes an EXT-X-DISCONTINUITY the player resets on,
  // so we deliberately do NOT offset timestamps here (doing it by hand is what
  // put DTS backwards at every seam).
  a.push(...outputArgs(output))
  return a
}

/**
 * Valid black+silence in the channel's format, for filling dead air or a
 * short-file remainder. It must be real, playable output — an empty or
 * unreadable segment would break the playlist's continuity — even when there is
 * nothing to play. `readrate` meters it like any other item: a generated source
 * is otherwise produced dozens of times faster than real time.
 */
export function blackArgs(p: StreamProfile, enc: string, durSec: number, output: FfmpegOutput = { kind: 'mpegts-pipe' }, readrate: string[] = []): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    ...readrate,
    '-f', 'lavfi', '-i', `color=c=black:s=${p.width}x${p.height}:r=${p.fps}`,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-t', Math.max(0.5, durSec).toFixed(3),
    ...encoderArgs(enc, p),
    '-c:a', 'aac', '-ar', '48000', '-ac', String(p.audioChannels), '-b:a', `${p.audioBitrate}k`,
    ...outputArgs(output),
  ]
}
