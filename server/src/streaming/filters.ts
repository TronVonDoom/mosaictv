// Building the ffmpeg command for one on-air segment: the video/audio filter
// chains (scale, deinterlace, subtitles, watermark, captions, song chyron) and
// the argument list that wraps them. Pure string construction — nothing here
// spawns a process or touches the database.

import { encoderArgs } from './capabilities.js'
import { VAAPI_DEVICE, type StreamProfile } from './profile.js'
import type { ComingUpConfig, WatermarkConfig } from './overlays.js'

export type Segment = {
  filePath: string
  offsetSec: number // seek into the file (first item only)
  durationSec?: number // cap output length (filler loop); undefined = play to EOF
  loop: boolean // loop the input (filler)
  hasAudio: boolean
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

// ---- "Coming up next" caption -----------------------------------------------

// The fields of a media item a coming-up caption can reference.
type CaptionItem = { title: string; showTitle: string | null; season: number | null; episode: number | null; year: number | null }

/**
 * Fill a coming-up template from the next program, dropping empty tokens and any
 * separators they leave dangling (so a movie with no episode title doesn't emit
 * a trailing " — "). Returns '' when nothing meaningful is left.
 */
export function renderComingUpText(template: string, mi: CaptionItem): string {
  const se =
    mi.season != null && mi.episode != null
      ? `S${String(mi.season).padStart(2, '0')}E${String(mi.episode).padStart(2, '0')}`
      : ''
  const vars: Record<string, string> = {
    showtitle: mi.showTitle ?? '',
    episodetitle: mi.showTitle ? mi.title : '', // only an "episode title" when it's a show
    movietitle: mi.showTitle ? '' : mi.title,
    title: mi.title ?? '',
    season: mi.season != null ? String(mi.season) : '',
    episode: mi.episode != null ? String(mi.episode) : '',
    se,
    year: mi.year != null ? String(mi.year) : '',
  }
  let s = template.replace(/%(\w+)%/g, (m, k: string) => (k.toLowerCase() in vars ? vars[k.toLowerCase()] : m))
  // Tidy up separators orphaned by an empty token.
  s = s
    .replace(/\s*[—–-]\s*[—–-]\s*/g, ' — ') // doubled dash -> single
    .replace(/^\s*[—–-]+\s*/g, '') // leading dash
    .replace(/\s*[:—–-]+\s*$/g, '') // trailing colon/dash
    .replace(/\s{2,}/g, ' ')
    .trim()
  return s
}

/** Segment-relative windows (seconds) in which the caption should be visible. */
export function comingUpWindows(cfg: ComingUpConfig, segDur: number, itemDur: number, offset: number): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = []
  const clampWin = (a: number, b: number) => {
    const A = Math.max(0, a)
    const B = Math.min(segDur, b)
    if (B - A > 0.5) out.push({ a: A, b: B })
  }
  if (cfg.timing === 'beforeEnd' || cfg.timing === 'both') {
    const start = segDur - cfg.leadSeconds
    clampWin(start, start + cfg.holdSeconds)
  }
  if (cfg.timing === 'middle' || cfg.timing === 'both') {
    // Midpoint of the whole item, expressed in this segment's clock (a mid-item
    // tune-in has offset>0, so the midpoint may already be behind us — then the
    // clamp drops it, which is correct).
    const mid = itemDur / 2 - offset
    clampWin(mid - cfg.holdSeconds / 2, mid + cfg.holdSeconds / 2)
  }
  return out
}

/**
 * Build the drawtext filter for the coming-up caption. Expression option values
 * are single-quoted so their commas aren't parsed as filtergraph separators
 * (the same trick the watermark graph uses). Text comes from a file
 * (expansion=none) so titles with quotes/colons/percent signs can't break the
 * graph. Returns null when there are no visible windows.
 */
export function comingUpFilter(cfg: ComingUpConfig, font: string, textFile: string, windows: { a: number; b: number }[], p: StreamProfile): string | null {
  if (windows.length === 0) return null
  const fontsize = Math.max(10, Math.round((p.height * cfg.fontSizePercent) / 100))
  const margin = Math.round(p.height * 0.06)
  const y = cfg.position === 'top' ? String(margin) : `h-text_h-${margin}`
  const opacity = Math.max(0, Math.min(1, cfg.opacityPercent / 100))
  const F = Math.max(0.05, cfg.fadeSeconds)
  const enable = windows.map((w) => `between(t,${w.a.toFixed(2)},${w.b.toFixed(2)})`).join('+')
  const fades = windows.map((w) => `clip(min((t-${w.a.toFixed(2)})/${F},(${w.b.toFixed(2)}-t)/${F}),0,1)`)
  const fade = fades.length === 1 ? fades[0] : `max(${fades[0]},${fades[1]})`
  const alpha = `${opacity.toFixed(3)}*(${fade})`
  const box = Math.round(fontsize * 0.45)
  return (
    `drawtext=fontfile=${font}:textfile=${textFile}:expansion=none` +
    `:fontsize=${fontsize}:fontcolor=white:borderw=2:bordercolor=black@0.85` +
    `:box=1:boxcolor=black@0.5:boxborderw=${box}` +
    `:x=(w-text_w)/2:y=${y}:enable='${enable}':alpha='${alpha}'`
  )
}

// ---- Music-video song chyron ------------------------------------------------

// A music video's on-screen info: title line + "Artist — Album" line. Two
// separate strings (rendered as two stacked drawtexts) so we never rely on an
// in-file newline, whose glyph rendering varies by ffmpeg/font build.
export function renderSongText(mi: { title: string; artist: string | null; album: string | null }): { title: string; sub: string } {
  return { title: mi.title, sub: [mi.artist, mi.album].filter(Boolean).join(' — ') }
}

// Lower-third "now playing" chyron for a music video: bottom-left, title over
// "Artist — Album", fading in/out across [a,b] (segment-relative seconds).
// Two stacked drawtexts (sub on the bottom line, title above). Returns null
// when the window is too small (e.g. a mid-song tune-in past the intro).
export function songChyronFilter(
  font: string,
  titleFile: string,
  subFile: string | null,
  a: number,
  b: number,
  p: StreamProfile,
): string | null {
  if (b - a < 0.5) return null
  const fontsize = Math.max(12, Math.round(p.height * 0.045))
  const margin = Math.round(p.height * 0.07)
  const lineH = Math.round(fontsize * 1.7) // vertical step between the two lines
  const F = 0.5
  const enable = `between(t,${a.toFixed(2)},${b.toFixed(2)})`
  const alpha = `clip(min((t-${a.toFixed(2)})/${F},(${b.toFixed(2)}-t)/${F}),0,1)`
  const box = Math.round(fontsize * 0.4)
  const draw = (file: string, y: string, size: number) =>
    `drawtext=fontfile=${font}:textfile=${file}:expansion=none` +
    `:fontsize=${size}:fontcolor=white:borderw=2:bordercolor=black@0.85` +
    `:box=1:boxcolor=black@0.55:boxborderw=${box}` +
    `:x=${margin}:y=${y}:enable='${enable}':alpha='${alpha}'`
  const parts: string[] = []
  if (subFile) {
    parts.push(draw(subFile, `h-text_h-${margin}`, Math.round(fontsize * 0.82)))
    parts.push(draw(titleFile, `h-text_h-${margin + lineH}`, fontsize))
  } else {
    parts.push(draw(titleFile, `h-text_h-${margin}`, fontsize))
  }
  return parts.join(',')
}

// ---- Full command construction ----------------------------------------------

/** The ffmpeg command that encodes one on-air segment to MPEG-TS on stdout. */
export function ffmpegArgs(seg: Segment, enc: string, wm: WatermarkConfig, p: StreamProfile, textFilter?: string): string[] {
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
  // Deliberately NOT -re: the outer concat process meters the session at real
  // time, and two pacers in series just starve each other. Unpaced, this races
  // ahead until the pipe backs up, which keeps a little of the item buffered
  // and ready the moment the previous one ends.
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
    vf = `${base}[bg];${wg.logoChain};[bg][lg]overlay=${wg.overlayPos}${wg.overlayExtra}${textFilter ? '[vpre]' : '[v]'}`
  } else {
    vf = `${base}${textFilter ? '[vpre]' : '[v]'}`
  }
  // The coming-up caption goes last, on top of everything else.
  if (textFilter) vf += `;[vpre]${textFilter}[v]`
  // VAAPI: upload the finished software frame to a GPU surface for the encoder.
  if (enc === 'h264_vaapi') vf = vf.replace(/\[v\]$/, '[vsw]') + ';[vsw]format=nv12,hwupload[v]'
  const aIn = audioIdx >= 0 ? `${audioIdx}:a:0` : '0:a:0'
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
  // Each item starts at timestamp 0 (setpts above) and is stitched to the
  // previous one by the outer concat process. We deliberately do NOT offset
  // timestamps here any more: doing it by hand is what put DTS backwards at
  // every seam.
  a.push('-mpegts_flags', '+resend_headers', '-f', 'mpegts', '-muxpreload', '0', '-muxdelay', '0', 'pipe:1')
  return a
}

/**
 * Valid black+silence in the channel's format. The concat demuxer treats an
 * empty or unreadable entry as a broken input and gives up on the whole
 * session, so every /internal/stream request must answer with real TS — even
 * when there is nothing to play.
 */
export function blackArgs(p: StreamProfile, enc: string, durSec: number): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 'lavfi', '-i', `color=c=black:s=${p.width}x${p.height}:r=${p.fps}`,
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-t', Math.max(0.5, durSec).toFixed(3),
    ...encoderArgs(enc, p),
    '-c:a', 'aac', '-ar', '48000', '-ac', String(p.audioChannels), '-b:a', `${p.audioBitrate}k`,
    '-mpegts_flags', '+resend_headers', '-f', 'mpegts', '-muxpreload', '0', '-muxdelay', '0', 'pipe:1',
  ]
}
