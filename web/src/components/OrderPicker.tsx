import { useEffect, useState } from 'react'
import { api, type MediaItem } from '../lib/api'
import { programLabel } from '../lib/format'
import { PLAYBACK_ORDERS } from '../lib/playback'
import { cx } from './ui'

type Preview = { order: string; count: number; sample: MediaItem[] }

// Orders dealt at random: a preview shows one deal, and each channel deals its own.
const RANDOM = new Set(['shuffle', 'shuffleShows'])

/**
 * The order a collection plays in: each choice with a line on what it does,
 * and beside them the collection's first airings in the chosen order, so the
 * effect is visible before it's saved.
 */
export default function OrderPicker({
  collectionId,
  value,
  onChange,
}: {
  collectionId: number
  value: string
  onChange: (order: string) => void
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    setFailed(false)
    api
      .collectionPreview(collectionId, value)
      .then((p) => live && setPreview(p))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [collectionId, value])

  const loading = !failed && preview?.order !== value

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,15rem)]">
      <div role="radiogroup" aria-label="Plays in this order" className="space-y-1.5">
        {PLAYBACK_ORDERS.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.value)}
              className={cx(
                'flex w-full gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors',
                on
                  ? 'border-indigo-400/50 bg-indigo-500/[0.09] shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]'
                  : 'border-edge bg-sunken/40 hover:border-edge-strong hover:bg-white/[0.02]',
              )}
            >
              <span
                className={cx(
                  'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                  on ? 'border-indigo-400 bg-indigo-500' : 'border-edge-strong',
                )}
              >
                {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={cx('text-[13.5px] font-medium', on ? 'text-ink' : 'text-ink-soft')}>{o.label}</span>
                  <span className="hidden whitespace-nowrap font-mono text-[11px] text-ink-faint sm:inline">{o.pattern}</span>
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-ink-muted">{o.description}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="self-start rounded-xl border border-edge bg-sunken/60 p-3.5">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">First airings</div>
        {failed ? (
          <p className="text-[12.5px] text-ink-faint">Couldn’t work out the running order.</p>
        ) : !preview ? (
          <p className="text-[12.5px] text-ink-faint">Working it out…</p>
        ) : preview.count === 0 ? (
          <p className="text-[12.5px] text-ink-faint">Nothing playable here yet.</p>
        ) : (
          <div className={cx('transition-opacity', loading && 'opacity-40')}>
            <ol className="space-y-1">
              {preview.sample.slice(0, 8).map((m, i) => (
                <li key={`${m.id}-${i}`} className="flex gap-2 text-[12.5px]">
                  <span className="w-4 shrink-0 text-right tabular-nums text-ink-ghost">{i + 1}</span>
                  <span className="truncate text-ink-soft">{programLabel(m, { withTitle: true })}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2.5 border-t border-edge/70 pt-2 text-[11.5px] leading-snug text-ink-faint">
              {RANDOM.has(value)
                ? 'One possible deal: each channel deals its own, and a new one each time round.'
                : 'From the start: a channel carries on from wherever it has got to.'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
