import { useEffect, useRef, useState } from 'react'
import { api, type CardPosition, type ComingUpConfig } from '../lib/api'
import { Field, Input, Section, Segmented, Skeleton, cx } from './ui'

const TIMINGS: { value: ComingUpConfig['timing']; label: string; hint: string }[] = [
  { value: 'beforeEnd', label: 'Before it ends', hint: 'Appears a set time before the current program ends.' },
  { value: 'middle', label: 'Middle', hint: 'Appears once, around the midpoint of the current program.' },
  { value: 'both', label: 'Both', hint: 'Appears at the midpoint and again near the end.' },
]

const STYLES = [
  { value: 'glass', label: 'Glass', title: 'A frosted-glass card over the picture' },
  { value: 'broadcast', label: 'Broadcast', title: 'A cable-network bar with the poster standing out of it' },
] as const

const POSITION_LABEL: Record<CardPosition, string> = {
  'top-left': 'Top left',
  'top-center': 'Top middle',
  'top-right': 'Top right',
  'middle-left': 'Middle left',
  'middle-right': 'Middle right',
  'bottom-left': 'Bottom left',
  'bottom-center': 'Bottom middle',
  'bottom-right': 'Bottom right',
}
// A 3×3 grid over the picture; the centre isn't a place for a card.
const GRID: (CardPosition | null)[] = [
  'top-left', 'top-center', 'top-right',
  'middle-left', null, 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]

/** Pick an edge or corner of the picture: a small 16:9 frame to click in. */
function PositionPicker({ value, onChange }: { value: CardPosition; onChange: (p: CardPosition) => void }) {
  return (
    <div className="flex items-center gap-3">
      <div role="radiogroup" aria-label="Card position" className="grid w-[132px] aspect-video grid-cols-3 grid-rows-3 gap-1 rounded-lg border border-edge bg-sunken p-1">
        {GRID.map((pos, i) =>
          pos ? (
            <button
              key={pos}
              type="button"
              role="radio"
              aria-checked={value === pos}
              aria-label={POSITION_LABEL[pos]}
              title={POSITION_LABEL[pos]}
              onClick={() => onChange(pos)}
              className={cx(
                'rounded-[4px] transition-colors',
                value === pos ? 'bg-indigo-500 shadow-[0_0_0_1px_rgb(165_180_252/0.5)]' : 'bg-white/[0.06] hover:bg-white/[0.14]',
              )}
            />
          ) : (
            <span key={i} />
          ),
        )}
      </div>
      <span className="text-sm text-ink-soft">{POSITION_LABEL[value]}</span>
    </div>
  )
}

const SIZES = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
] as const

/**
 * The card as it will air: this channel's real next program over a still from
 * what's on now, rendered by the server exactly as the stream draws it.
 * Follows the form's unsaved settings, a moment after each change.
 */
function CardPreview({ channelId, cfg }: { channelId: number; cfg: ComingUpConfig }) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const urlRef = useRef<string | null>(null)
  // Only what changes the picture — timing edits don't need a new render.
  const key = `${cfg.style}|${cfg.position}|${cfg.size}`

  useEffect(() => {
    const ac = new AbortController()
    setLoading(true)
    const t = setTimeout(() => {
      api
        .comingUpPreview(channelId, cfg, ac.signal)
        .then((blob) => {
          const next = URL.createObjectURL(blob)
          if (urlRef.current) URL.revokeObjectURL(urlRef.current)
          urlRef.current = next
          setUrl(next)
          setFailed(false)
        })
        .catch(() => !ac.signal.aborted && setFailed(true))
        .finally(() => !ac.signal.aborted && setLoading(false))
    }, 250)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, key])

  useEffect(() => () => void (urlRef.current && URL.revokeObjectURL(urlRef.current)), [])

  return (
    <figure className="max-w-xl">
      <div className="relative aspect-video overflow-hidden rounded-xl border border-edge bg-sunken">
        {url ? (
          <img src={url} alt="The up-next card over a still from this channel" className={cx('absolute inset-0 h-full w-full object-cover transition-opacity', loading && 'opacity-60')} />
        ) : failed ? (
          <div className="absolute inset-0 grid place-items-center text-xs text-ink-faint">Preview unavailable</div>
        ) : (
          <Skeleton className="absolute inset-0 rounded-none" />
        )}
      </div>
      <figcaption className="mt-1.5 text-xs text-ink-faint">
        This channel's next program, as it will air, with the channel's logo where its watermark sits — keep
        the card clear of it. The card slides in from the nearest edge.
      </figcaption>
    </figure>
  )
}

// Editor for the "up next" card shown over programs — never filler. With a
// channel, it previews the card as it will air.
export default function ComingUpFields({
  cfg,
  onChange,
  channelId,
}: {
  cfg: ComingUpConfig
  onChange: (c: ComingUpConfig) => void
  channelId?: number
}) {
  const set = <K extends keyof ComingUpConfig>(k: K, v: ComingUpConfig[K]) => onChange({ ...cfg, [k]: v })

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm select-none">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        <span className="text-ink font-medium">Show an “up next” card over programs</span>
      </label>

      {cfg.enabled && (
        <>
          {channelId != null && <CardPreview channelId={channelId} cfg={cfg} />}

          <Section title="Timing">
            <div className="inline-flex rounded-lg border border-edge-strong overflow-hidden">
              {TIMINGS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => set('timing', t.value)}
                  className={`px-3.5 py-1.5 text-sm transition-colors ${
                    cfg.timing === t.value ? 'bg-indigo-500 text-white' : 'bg-surface text-ink-muted hover:text-ink'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-faint mt-1.5">{TIMINGS.find((t) => t.value === cfg.timing)?.hint}</p>
            <div className="grid grid-cols-3 gap-3 mt-3">
              {cfg.timing !== 'middle' && (
                <Field label="Before end (sec)" hint="300 = 5 min.">
                  <Input type="number" min={5} max={3600} className="w-full" value={cfg.leadSeconds} onChange={(e) => set('leadSeconds', Number(e.target.value))} />
                </Field>
              )}
              <Field label="On screen (sec)">
                <Input type="number" min={2} max={120} className="w-full" value={cfg.holdSeconds} onChange={(e) => set('holdSeconds', Number(e.target.value))} />
              </Field>
              <Field label="Slide in (sec)" hint="0 = no animation.">
                <Input type="number" min={0} max={3} step={0.1} className="w-full" value={cfg.fadeSeconds} onChange={(e) => set('fadeSeconds', Number(e.target.value))} />
              </Field>
            </div>
          </Section>

          <Section title="Appearance">
            <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
              <Field label="Style">
                <Segmented options={STYLES} value={cfg.style} onChange={(v) => set('style', v)} />
              </Field>
              <Field label="Position">
                <PositionPicker value={cfg.position} onChange={(v) => set('position', v)} />
              </Field>
              <Field label="Size">
                <Segmented options={SIZES} value={cfg.size} onChange={(v) => set('size', v)} />
              </Field>
            </div>
          </Section>
        </>
      )}
    </div>
  )
}
