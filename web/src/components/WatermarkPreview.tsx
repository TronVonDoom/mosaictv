import { useEffect, useState } from 'react'
import { ART, artworkUrl, type WatermarkConfig } from '../lib/api'
import { Segmented, cx } from './ui'

// One random backdrop per page load, shared by every preview on screen.
let backdropReq: Promise<number | null> | null = null
function sampleBackdrop(): Promise<number | null> {
  backdropReq ??= fetch('/api/artwork/random/backdrop')
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { id: number | null } | null) => j?.id ?? null)
    .catch(() => null)
  return backdropReq
}

/**
 * A 16:9 frame showing where a watermark lands, over a real backdrop from the
 * library — the same geometry the encoder uses (filters.ts watermarkGraph):
 * width as a share of the picture, margins from the chosen corner, and with
 * "keep on the picture" the rectangle is the 4:3 image inside its pillarbox
 * rather than the whole frame. Intermittent logos pulse to say so.
 */
export default function WatermarkPreview({
  wm,
  logoSrc,
  className,
}: {
  wm: WatermarkConfig
  logoSrc: string | null
  className?: string
}) {
  const [backdropId, setBackdropId] = useState<number | null>(null)
  const [content, setContent] = useState<'wide' | 'classic'>('wide')
  useEffect(() => {
    sampleBackdrop().then(setBackdropId)
  }, [])

  const classic = content === 'classic'
  // The picture inside the 16:9 frame, as fractions of the frame. A 4:3 image
  // fills the height and 75% of the width, pillarboxed.
  const pic = classic ? { x: 0.125, w: 0.75 } : { x: 0, w: 1 }
  const rect = wm.constrainToMedia ? pic : { x: 0, w: 1 }
  const logoW = rect.w * (wm.widthPercent / 100)
  const mx = rect.w * (wm.horizontalMarginPercent / 100)
  const my = wm.verticalMarginPercent / 100
  const [v, h] = wm.position.split('-') as ['top' | 'bottom', 'left' | 'right']
  const style: React.CSSProperties = {
    width: `${logoW * 100}%`,
    opacity: wm.opacityPercent / 100,
    [v]: `${my * 100}%`,
    [h]: h === 'left' ? `${(rect.x + mx) * 100}%` : `${(1 - rect.x - rect.w + mx) * 100}%`,
  }

  return (
    <div className={cx('space-y-2.5', className)}>
      <div className="relative aspect-video rounded-xl overflow-hidden bg-black ring-1 ring-white/10 shadow-[0_18px_40px_-18px_rgb(0_0_0/0.9)]">
        {/* The program picture */}
        <div
          className="absolute inset-y-0 overflow-hidden bg-gradient-to-br from-indigo-900/60 via-slate-900 to-cyan-900/40"
          style={{ left: `${pic.x * 100}%`, width: `${pic.w * 100}%` }}
        >
          {backdropId != null && (
            <img src={artworkUrl(backdropId, 'backdrop', ART.card)} alt="" className="w-full h-full object-cover fade-in" />
          )}
        </div>
        {wm.mode !== 'none' && logoSrc && (
          <img
            src={logoSrc}
            alt=""
            className={cx(
              'absolute h-auto object-contain transition-[top,bottom,left,right,width,opacity] duration-300',
              wm.mode === 'intermittent' && 'animate-[wm-blink_4s_ease-in-out_infinite]',
            )}
            style={style}
          />
        )}
        <div className="absolute top-2 left-2 rounded-md bg-black/60 backdrop-blur px-1.5 py-0.5 text-[10.5px] font-medium text-white/80">
          {wm.mode === 'none'
            ? 'No watermark'
            : wm.mode === 'intermittent'
              ? `On ${wm.durationSeconds}s every ${wm.frequencyMinutes} min`
              : 'Always on'}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-[12px] text-ink-faint">
        <span>Preview over</span>
        <Segmented
          size="sm"
          value={content}
          onChange={setContent}
          options={[
            { value: 'wide', label: '16:9 show' },
            { value: 'classic', label: '4:3 show' },
          ]}
        />
      </div>
    </div>
  )
}
