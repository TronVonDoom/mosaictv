import { useMemo, useRef, useEffect } from 'react'
import type { Playout } from '../lib/api'

const PX = 4 // pixels per minute
const HOURS = 24
const LOGO_W = 76 // width of the sticky channel-logo column, when shown

function progLabel(it: Playout['items'][number]): string {
  const m = it.mediaItem
  if (!m) return it.title || 'Station ID'
  if (m.type === 'episode' && m.showTitle) {
    const se = m.season != null && m.episode != null ? ` S${String(m.season).padStart(2, '0')}E${String(m.episode).padStart(2, '0')}` : ''
    return `${m.showTitle}${se}`
  }
  return m.title
}

// A Jellyfin-style horizontal EPG lane for one channel: programs as time-scaled
// bars along a 24h axis, filler dim, with a live "now" marker. Pass `logo` to
// pin the channel's logo in a sticky column at the left of the lane (stays
// put while the timeline scrolls underneath it).
export default function TimelineView({ playout, logo }: { playout: Playout; logo?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const now = new Date(playout.now)
  const windowStart = useMemo(() => {
    const d = new Date(playout.now)
    d.setMinutes(0, 0, 0)
    return d
  }, [playout.now])
  const totalMin = HOURS * 60
  const minsFrom = (iso: string) => (new Date(iso).getTime() - windowStart.getTime()) / 60000
  const nowMin = (now.getTime() - windowStart.getTime()) / 60000

  // Scroll so "now" sits a little in from the left edge.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, (nowMin - 20) * PX)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playout.now])

  return (
    <div ref={scrollRef} className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/40">
      <div className="flex" style={{ width: (logo ? LOGO_W : 0) + totalMin * PX, height: 92 }}>
        {logo && (
          <div
            className="sticky left-0 z-20 shrink-0 flex items-center justify-center bg-slate-950 border-r border-slate-800"
            style={{ width: LOGO_W, height: 92 }}
          >
            <img src={logo} alt="" className="max-w-[68%] max-h-[68%] object-contain" />
          </div>
        )}
        <div className="relative shrink-0" style={{ width: totalMin * PX, height: 92 }}>
          {/* hour ticks */}
          {Array.from({ length: HOURS + 1 }, (_, h) => {
            const t = new Date(windowStart.getTime() + h * 3600_000)
            return (
              <div key={h} className="absolute top-0 bottom-0 border-l border-slate-800/70" style={{ left: h * 60 * PX }}>
                <span className="absolute top-1 left-1 text-[10px] text-slate-500 whitespace-nowrap">
                  {t.toLocaleTimeString([], { hour: 'numeric' })}
                </span>
              </div>
            )
          })}

          {/* program bars */}
          {playout.items.map((it) => {
            const s = Math.max(0, minsFrom(it.startTime))
            const e = Math.min(totalMin, minsFrom(it.stopTime))
            const w = (e - s) * PX
            if (w <= 1) return null
            const isNow = new Date(it.startTime) <= now && new Date(it.stopTime) > now
            const filler = !it.mediaItem
            return (
              <div
                key={it.id}
                title={`${progLabel(it)} — ${new Date(it.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
                className={
                  'absolute rounded-md border px-2 py-1 overflow-hidden ' +
                  (filler
                    ? 'bg-slate-900/70 border-slate-800 text-slate-500 italic'
                    : isNow
                      ? 'bg-indigo-500/25 border-indigo-400 text-indigo-100'
                      : 'bg-slate-800/70 border-slate-700 text-slate-200')
                }
                style={{ left: s * PX + 1, width: w - 2, top: 30, height: 54 }}
              >
                <div className="text-xs font-medium truncate leading-tight">{progLabel(it)}</div>
                {w > 60 && (
                  <div className="text-[10px] text-slate-400 truncate">
                    {new Date(it.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            )
          })}

          {/* now marker */}
          {nowMin >= 0 && nowMin <= totalMin && (
            <div className="absolute top-0 bottom-0 w-0.5 bg-rose-500/80 z-10" style={{ left: nowMin * PX }}>
              <span className="absolute -top-0 left-0.5 text-[9px] bg-rose-500 text-white rounded px-1">now</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
