// Container load over time, with playout transitions marked on the same
// timeline. The point of the pairing: a step change in CPU that never comes
// back down can be traced to the item that started at that moment.
//
// CPU and memory are separate plots rather than one dual-axis chart — two
// measures on two y-scales can be made to tell any story you like.

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type MetricMarker, type MetricsResponse, type MetricSample } from '../lib/api'
import { usePolling } from '../lib/hooks'
import { Card, Select, cx } from './ui'

// Validated against the slate-900 card surface (CVD separation lands in the
// 6–8 floor band, so every marker kind also carries a distinct glyph and a
// legend label — identity is never colour alone).
const KIND_COLOR: Record<MetricMarker['kind'], string> = {
  program: '#008300',
  filler: '#d55181',
  song: '#c98500',
}
const KIND_LABEL: Record<MetricMarker['kind'], string> = {
  program: 'Episode / movie',
  filler: 'Filler',
  song: 'Music video',
}
const LINE = '#3987e5'
const GRID = 'rgba(148, 163, 184, 0.14)' // slate-400, recessive
const AXIS_TEXT = '#94a3b8' // slate-400

const RANGES = [
  { value: 5, label: 'Last 5 min' },
  { value: 15, label: 'Last 15 min' },
  { value: 60, label: 'Last hour' },
]

// Plot geometry. Two stacked panels share one x-axis at the bottom.
const PAD_L = 44
const PAD_R = 10
const CPU_TOP = 16
const CPU_H = 116
const MEM_TOP = CPU_TOP + CPU_H + 26
const MEM_H = 64
const AXIS_Y = MEM_TOP + MEM_H
const HEIGHT = AXIS_Y + 20

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
function fmtMB(bytes: number): string {
  if (bytes < 0) return '—'
  const mb = bytes / 1e6
  return mb >= 1000 ? `${(mb / 1000).toFixed(2)} GB` : `${Math.round(mb)} MB`
}

/** Marker glyph — the secondary encoding that carries kind without colour. */
function KindGlyph({ kind, x, y }: { kind: MetricMarker['kind']; x: number; y: number }) {
  const c = KIND_COLOR[kind]
  if (kind === 'program') return <rect x={x - 3.5} y={y - 3.5} width={7} height={7} fill={c} />
  if (kind === 'filler')
    return <circle cx={x} cy={y} r={3.5} fill="none" stroke={c} strokeWidth={2} />
  return <path d={`M ${x} ${y - 4.2} L ${x + 4} ${y + 3.2} L ${x - 4} ${y + 3.2} Z`} fill={c} />
}

export default function ResourceChart() {
  const [minutes, setMinutes] = useState(15)
  const [data, setData] = useState<MetricsResponse | null>(null)
  const [width, setWidth] = useState(720)
  const [hover, setHover] = useState<number | null>(null) // index into samples
  const wrapRef = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    api.metrics(minutes).then(setData).catch(() => {})
  }, [minutes])

  useEffect(() => { load() }, [load])
  usePolling(load, 5000)

  // Track the container width so the SVG uses real pixel units — a scaled
  // viewBox would stretch stroke widths and text with it.
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const samples: MetricSample[] = data?.samples ?? []
  const markers: MetricMarker[] = data?.markers ?? []
  const cores = data?.cores ?? 1

  // Fixed window ending now, so the plot scrolls smoothly instead of
  // rescaling every time a sample drops off the back.
  const t1 = Date.now()
  const t0 = t1 - minutes * 60_000
  const plotW = Math.max(80, width - PAD_L - PAD_R)
  const x = (ts: number) => PAD_L + ((ts - t0) / (t1 - t0)) * plotW

  // CPU headroom: percent of one core, so the ceiling is cores*100. Scale to
  // the peak (rounded up to a sensible step) but never below one full core.
  const cpuPeak = Math.max(100, ...samples.map((s) => (s.cpuPct < 0 ? 0 : s.cpuPct)))
  const cpuMax = Math.min(cores * 100, Math.ceil(cpuPeak / 100) * 100)
  const cpuY = (pct: number) => CPU_TOP + CPU_H - (Math.min(pct, cpuMax) / cpuMax) * CPU_H

  const memVals = samples.map((s) => s.memBytes).filter((b) => b >= 0)
  const memMax = memVals.length ? Math.max(...memVals) * 1.15 : 1
  const memY = (b: number) => MEM_TOP + MEM_H - (b / memMax) * MEM_H

  // Build a path that breaks at unmeasurable points rather than drawing a
  // straight line through a gap it knows nothing about.
  const pathFor = (get: (s: MetricSample) => number, toY: (v: number) => number): string => {
    let d = ''
    let pen = false
    for (const s of samples) {
      const v = get(s)
      if (v < 0 || s.ts < t0) { pen = false; continue }
      d += `${pen ? 'L' : 'M'} ${x(s.ts).toFixed(1)} ${toY(v).toFixed(1)} `
      pen = true
    }
    return d.trim()
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    if (px < PAD_L || !samples.length) return setHover(null)
    const ts = t0 + ((px - PAD_L) / plotW) * (t1 - t0)
    let best = 0
    for (let i = 1; i < samples.length; i++) {
      if (Math.abs(samples[i].ts - ts) < Math.abs(samples[best].ts - ts)) best = i
    }
    setHover(best)
  }

  const hs = hover != null ? samples[hover] : null
  // The transition that was in effect at the hovered moment.
  const hoveredMarker = hs
    ? [...markers].reverse().find((m) => m.ts <= hs.ts + 1500)
    : null

  const degraded = data && data.source === 'process'
  const noData = samples.length === 0

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Container load</h2>
          <p className="text-xs text-slate-500">
            CPU is percent of one core ({cores} available). Vertical rules mark playout changes.
          </p>
        </div>
        <Select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="w-auto">
          {RANGES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </Select>
      </div>

      {degraded && (
        <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          No container cgroup found — these numbers cover the app process only and
          <strong className="font-semibold"> exclude ffmpeg</strong>, which is most of the load.
        </p>
      )}

      <div ref={wrapRef} className="w-full">
        {noData ? (
          <p className="py-10 text-center text-sm text-slate-500">
            Collecting samples… the first points appear a few seconds after start-up.
          </p>
        ) : (
          <svg
            width={width}
            height={HEIGHT}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            className="touch-none"
            role="img"
            aria-label={`Container CPU and memory over the last ${minutes} minutes with playout transition markers`}
          >
            {/* --- gridlines + y labels --- */}
            {[0, 0.5, 1].map((f) => (
              <g key={`c${f}`}>
                <line x1={PAD_L} x2={width - PAD_R} y1={cpuY(cpuMax * f)} y2={cpuY(cpuMax * f)} stroke={GRID} strokeWidth={1} />
                <text x={PAD_L - 6} y={cpuY(cpuMax * f) + 3.5} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
                  {Math.round(cpuMax * f)}%
                </text>
              </g>
            ))}
            {[0, 1].map((f) => (
              <g key={`m${f}`}>
                <line x1={PAD_L} x2={width - PAD_R} y1={memY(memMax * f)} y2={memY(memMax * f)} stroke={GRID} strokeWidth={1} />
                <text x={PAD_L - 6} y={memY(memMax * f) + 3.5} textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
                  {f === 0 ? '0' : fmtMB(memMax)}
                </text>
              </g>
            ))}
            <text x={PAD_L} y={CPU_TOP - 5} fontSize={10} fill={AXIS_TEXT}>CPU</text>
            <text x={PAD_L} y={MEM_TOP - 5} fontSize={10} fill={AXIS_TEXT}>Memory</text>

            {/* --- transition markers, behind the data --- */}
            {markers.filter((m) => m.ts >= t0).map((m) => (
              <g key={m.id}>
                <line
                  x1={x(m.ts)} x2={x(m.ts)} y1={CPU_TOP} y2={AXIS_Y}
                  stroke={KIND_COLOR[m.kind]} strokeWidth={1} strokeDasharray="3 3" opacity={0.7}
                />
                <KindGlyph kind={m.kind} x={x(m.ts)} y={CPU_TOP - 1} />
              </g>
            ))}

            {/* --- series --- */}
            <path d={pathFor((s) => s.cpuPct, cpuY)} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={pathFor((s) => s.memBytes, memY)} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

            {/* --- x axis --- */}
            <line x1={PAD_L} x2={width - PAD_R} y1={AXIS_Y} y2={AXIS_Y} stroke={GRID} strokeWidth={1} />
            <text x={PAD_L} y={AXIS_Y + 14} fontSize={10} fill={AXIS_TEXT}>{fmtClock(t0)}</text>
            <text x={width - PAD_R} y={AXIS_Y + 14} fontSize={10} fill={AXIS_TEXT} textAnchor="end">now</text>

            {/* --- hover crosshair --- */}
            {hs && (
              <g>
                <line x1={x(hs.ts)} x2={x(hs.ts)} y1={CPU_TOP} y2={AXIS_Y} stroke={AXIS_TEXT} strokeWidth={1} opacity={0.5} />
                {hs.cpuPct >= 0 && (
                  <circle cx={x(hs.ts)} cy={cpuY(hs.cpuPct)} r={4} fill={LINE} stroke="#0f172a" strokeWidth={2} />
                )}
                {hs.memBytes >= 0 && (
                  <circle cx={x(hs.ts)} cy={memY(hs.memBytes)} r={4} fill={LINE} stroke="#0f172a" strokeWidth={2} />
                )}
              </g>
            )}
          </svg>
        )}
      </div>

      {/* --- legend (identity never by colour alone) --- */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
        {(Object.keys(KIND_LABEL) as MetricMarker['kind'][]).map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <svg width={12} height={12} aria-hidden="true"><KindGlyph kind={k} x={6} y={6} /></svg>
            {KIND_LABEL[k]}
          </span>
        ))}
      </div>

      {/* --- readout for the hovered moment --- */}
      <div className={cx('mt-3 min-h-[3.25rem] rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs', !hs && 'text-slate-500')}>
        {hs ? (
          <>
            <div className="flex flex-wrap gap-x-4 text-slate-300">
              <span className="tabular-nums">{fmtClock(hs.ts)}</span>
              <span>CPU <strong className="font-semibold tabular-nums text-slate-100">{hs.cpuPct < 0 ? '—' : `${hs.cpuPct}%`}</strong></span>
              <span>Memory <strong className="font-semibold tabular-nums text-slate-100">{fmtMB(hs.memBytes)}</strong></span>
              <span>ffmpeg <strong className="font-semibold tabular-nums text-slate-100">{hs.ffmpegCount < 0 ? '—' : hs.ffmpegCount}</strong></span>
            </div>
            {hoveredMarker && (
              <div className="mt-1 truncate text-slate-400">
                Playing since {fmtClock(hoveredMarker.ts)}: ch {hoveredMarker.channel} · {KIND_LABEL[hoveredMarker.kind]} · {hoveredMarker.label}
              </div>
            )}
          </>
        ) : (
          'Hover the chart to read a moment.'
        )}
      </div>
    </Card>
  )
}
