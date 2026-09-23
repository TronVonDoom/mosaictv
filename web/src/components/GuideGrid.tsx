import { useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import ChannelLogo from './ChannelLogo'
import type { Playout, PlayoutEntry } from '../lib/api'
import { episodeCode, formatClock } from '../lib/format'
import { cx } from './ui'
import { useMediaQuery } from '../lib/hooks'

export type GuideChannel = { id: number; number: number | null; name: string; logoId: number | null }

/** One block on the grid: a program, a multi-part airing folded into one, or
 *  a station break. `entry` is the first segment — what a click opens. */
type Block = { key: string; start: number; stop: number; title: string; sub: string | null; filler: boolean; entry: PlayoutEntry }

/** Fold a channel's playout into blocks, merging segments that share a
 *  groupKey the way the XMLTV guide does. */
function toBlocks(items: PlayoutEntry[]): Block[] {
  const out: Block[] = []
  for (const it of items) {
    const start = new Date(it.startTime).getTime()
    const stop = new Date(it.stopTime).getTime()
    const last = out[out.length - 1]
    if (it.groupKey && last && last.entry.groupKey === it.groupKey) {
      last.stop = stop
      if (it.mediaItem?.title && last.sub && !last.sub.includes(it.mediaItem.title)) last.sub += ` / ${it.mediaItem.title}`
      continue
    }
    const m = it.mediaItem
    if (!m) {
      out.push({ key: String(it.id), start, stop, title: 'Station break', sub: null, filler: true, entry: it })
    } else if (m.showTitle) {
      const code = episodeCode(m)
      out.push({
        key: String(it.id),
        start,
        stop,
        title: m.showTitle,
        sub: [code, m.title].filter(Boolean).join(' · ') || null,
        filler: false,
        entry: it,
      })
    } else {
      out.push({
        key: String(it.id),
        start,
        stop,
        title: m.type === 'music' && m.artist ? `${m.artist} – ${m.title}` : m.title,
        sub: null,
        filler: false,
        entry: it,
      })
    }
  }
  return out
}

/**
 * The TV guide: every channel on one time axis, the way a set-top box draws
 * it. One scroll area for all rows (the old per-channel strips each had their
 * own scrollbar and drifted apart), the channel column pinned on the left,
 * the time ruler pinned on top, and a red "now" line through every row.
 *
 * `jump` re-centres on now whenever it changes — the page's "Now" button.
 */
export default function GuideGrid({
  channels,
  guides,
  nowMs,
  hours = 24,
  pxPerMin = 5,
  rowHeight = 68,
  maxHeight,
  onSelect,
  jump = 0,
  className,
}: {
  channels: GuideChannel[]
  guides: Record<number, Playout>
  nowMs: number
  hours?: number
  pxPerMin?: number
  rowHeight?: number
  maxHeight?: string
  onSelect?: (entry: PlayoutEntry) => void
  jump?: number
  className?: string
}) {
  // A phone can't spare 208px for the channel column: logo and number only.
  const narrow = useMediaQuery('(max-width: 640px)')
  const CH_W = narrow ? 76 : 208
  const RULER_H = 40
  const scrollRef = useRef<HTMLDivElement>(null)

  // Start half an hour before the current half-hour, so what just ended is
  // still in view; recomputed only when that boundary moves.
  const halfHour = Math.floor(nowMs / 1_800_000)
  const windowStart = (halfHour - 1) * 1_800_000
  const windowEnd = windowStart + hours * 3_600_000
  const totalMin = (windowEnd - windowStart) / 60000
  const x = (t: number) => ((t - windowStart) / 60000) * pxPerMin

  const blocks = useMemo(() => {
    const m: Record<number, Block[]> = {}
    for (const c of channels) m[c.id] = toBlocks(guides[c.id]?.items ?? [])
    return m
  }, [channels, guides])

  // Half-hour ruler marks; a day label where the date turns over.
  const marks = useMemo(() => {
    const out: { t: number; label: string; hour: boolean; day?: string }[] = []
    for (let t = windowStart; t <= windowEnd; t += 1_800_000) {
      const d = new Date(t)
      const hour = d.getMinutes() === 0
      out.push({
        t,
        hour,
        label: hour ? d.toLocaleTimeString([], { hour: 'numeric' }) : ':30',
        day: d.getHours() === 0 && hour ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : undefined,
      })
    }
    return out
  }, [windowStart, windowEnd])

  // Put "now" a fifth of the way in, on mount and whenever asked.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const target = x(nowMs) - (el.clientWidth - CH_W) * 0.2
    el.scrollTo({ left: Math.max(0, target), behavior: jump ? 'smooth' : 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump, pxPerMin])

  const nowX = x(nowMs)
  const width = CH_W + totalMin * pxPerMin

  return (
    <div className={cx('relative rounded-2xl border border-edge surface-card overflow-hidden', className)}>
      <div ref={scrollRef} className="overflow-auto" style={{ maxHeight }}>
        <div className="relative" style={{ width }}>
          {/* Time ruler */}
          <div className="sticky top-0 z-30 flex border-b border-edge bg-[#0e1119]/95 backdrop-blur" style={{ height: RULER_H }}>
            <div
              className="sticky left-0 z-40 shrink-0 flex items-center px-4 border-r border-edge bg-[#0e1119] text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint"
              style={{ width: CH_W }}
            >
              {new Date(nowMs).toLocaleDateString([], { weekday: narrow ? 'short' : 'long' })}
            </div>
            <div className="relative flex-1">
              {marks.map((m) => (
                <div key={m.t} className="absolute top-0 bottom-0" style={{ left: x(m.t) }}>
                  <div className={cx('absolute bottom-0 w-px', m.hour ? 'h-3 bg-edge-strong' : 'h-1.5 bg-edge')} />
                  <span
                    className={cx(
                      'absolute top-2.5 left-2 whitespace-nowrap text-[11.5px] tabular-nums',
                      m.hour ? 'font-semibold text-ink-soft' : 'text-ink-faint',
                    )}
                  >
                    {m.day ? <span className="text-indigo-300">{m.day}</span> : m.label}
                  </span>
                </div>
              ))}
              {nowX >= 0 && nowX <= totalMin * pxPerMin && (
                <div className="absolute top-1.5 z-10 -translate-x-1/2" style={{ left: nowX }}>
                  <span className="rounded-md bg-live px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-white shadow-[0_0_14px_rgb(255_59_79/0.55)]">
                    {formatClock(nowMs)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Channel rows */}
          {channels.map((c) => (
            <div key={c.id} className="flex border-b border-edge/60 last:border-b-0" style={{ height: rowHeight }}>
              <Link
                to={`/channels/${c.id}#guide`}
                title={c.name}
                className={cx(
                  'group sticky left-0 z-20 shrink-0 flex items-center border-r border-edge bg-[#0f121a] hover:bg-[#141824] transition-colors',
                  narrow ? 'flex-col justify-center gap-1 px-1' : 'gap-3 px-3.5',
                )}
                style={{ width: CH_W }}
              >
                <ChannelLogo logoId={c.logoId} name={c.name} size={narrow ? 34 : 40} />
                {narrow ? (
                  <span className="font-mono text-[11px] font-semibold text-indigo-300 tabular-nums">{c.number ?? '—'}</span>
                ) : (
                  <span className="min-w-0">
                    <span className="block font-mono text-[12px] font-semibold text-indigo-300 tabular-nums">{c.number ?? '—'}</span>
                    <span className="block text-[13px] font-medium text-ink-soft group-hover:text-ink truncate">{c.name}</span>
                  </span>
                )}
              </Link>
              <div className="relative flex-1">
                {/* Hour gridlines */}
                {marks
                  .filter((m) => m.hour)
                  .map((m) => (
                    <div key={m.t} className="absolute top-0 bottom-0 w-px bg-edge/45" style={{ left: x(m.t) }} />
                  ))}
                {(blocks[c.id] ?? []).map((b) => {
                  if (b.stop <= windowStart || b.start >= windowEnd) return null
                  const left = Math.max(0, x(b.start))
                  const right = Math.min(totalMin * pxPerMin, x(b.stop))
                  const w = right - left
                  if (w < 2) return null
                  const current = b.start <= nowMs && b.stop > nowMs
                  const past = b.stop <= nowMs
                  const pct = current ? ((nowMs - b.start) / (b.stop - b.start)) * 100 : 0
                  const clickable = !!onSelect && !b.filler && !!b.entry.mediaItem
                  const title = `${b.title}${b.sub ? ` — ${b.sub}` : ''}\n${formatClock(b.start)} – ${formatClock(b.stop)}`
                  return (
                    <button
                      key={b.key}
                      type="button"
                      title={title}
                      disabled={!clickable}
                      onClick={() => clickable && onSelect!(b.entry)}
                      className={cx(
                        // overflow-clip, not -hidden: hidden makes the block a scroll
                        // container of its own, and the sticky title would pin to
                        // the block's edge instead of the guide's.
                        'absolute top-1.5 bottom-1.5 overflow-clip rounded-lg border text-left transition-colors',
                        w > 36 ? 'px-2.5 py-1.5' : 'px-0',
                        b.filler
                          ? 'border-transparent bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.025)_0_6px,transparent_6px_12px)] text-ink-ghost'
                          : current
                            ? 'border-indigo-400/55 bg-indigo-500/[0.14] text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]'
                            : 'border-edge-strong/70 bg-raised/70 text-ink-soft',
                        past && 'opacity-45',
                        clickable && 'cursor-pointer hover:border-indigo-400/60 hover:bg-raised hover:text-ink',
                        !clickable && 'cursor-default',
                      )}
                      style={{ left: left + 1.5, width: w - 3 }}
                    >
                      {current && (
                        <span
                          className="absolute inset-y-0 left-0 bg-gradient-to-r from-indigo-500/25 to-indigo-500/5 pointer-events-none"
                          style={{ width: `${pct}%` }}
                        />
                      )}
                      {w > 36 && (
                        // Sticky within its block: a program that began before
                        // the scrolled-to window keeps its title in view,
                        // pinned just right of the channel column.
                        <span className="sticky inline-block max-w-full align-top" style={{ left: CH_W + 10 }}>
                          <span className={cx('block truncate text-[12.5px] leading-tight', b.filler ? 'italic' : 'font-medium')}>
                            {b.title}
                          </span>
                          {rowHeight >= 56 && (
                            <span className="block truncate text-[11px] leading-tight mt-0.5 text-ink-faint tabular-nums">
                              {b.sub ?? `${formatClock(b.start)} – ${formatClock(b.stop)}`}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Now line, through every row */}
          {nowX >= 0 && nowX <= totalMin * pxPerMin && (
            <div
              className="absolute bottom-0 z-10 w-0.5 -translate-x-1/2 bg-live shadow-[0_0_12px_rgb(255_59_79/0.7)] pointer-events-none"
              style={{ left: CH_W + nowX, top: RULER_H }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
