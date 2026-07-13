import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  api,
  formatDays,
  minutesToTime,
  type ChannelDetail,
  type Collection,
  type Playout,
} from '../lib/api'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtDur(sec: number | null): string {
  if (!sec) return ''
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
function label(m: Playout['items'][number]['mediaItem']): string {
  if (m.type === 'episode' && m.showTitle) {
    const se = m.season != null && m.episode != null
      ? ` S${String(m.season).padStart(2, '0')}E${String(m.episode).padStart(2, '0')}`
      : ''
    return `${m.showTitle}${se} — ${m.title}`
  }
  return m.title
}

const input = 'rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none'

export default function ChannelEditor() {
  const { id } = useParams()
  const channelId = Number(id)
  const [ch, setCh] = useState<ChannelDetail | null>(null)
  const [cols, setCols] = useState<Collection[]>([])
  const [playout, setPlayout] = useState<Playout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)

  const [chForm, setChForm] = useState({ name: '', group: '', logoUrl: '' })
  const [rot, setRot] = useState({ collectionId: '', mode: 'one', count: '1', playbackOrder: 'chronological' })
  const [blk, setBlk] = useState<{ collectionId: string; days: number[]; start: string; end: string; playbackOrder: string; logoUrl: string }>({
    collectionId: '',
    days: [1, 2, 3, 4, 5],
    start: '18:00',
    end: '21:00',
    playbackOrder: 'chronological',
    logoUrl: '',
  })

  const load = () => api.channel(channelId).then(setCh).catch(() => {})
  const loadPlayout = () => api.playout(channelId, 24).then(setPlayout).catch(() => {})

  useEffect(() => {
    api
      .channel(channelId)
      .then((c) => {
        setCh(c)
        setChForm({ name: c.name, group: c.group ?? '', logoUrl: c.logoUrl ?? '' })
      })
      .catch(() => {})
    loadPlayout()
    api.collections().then(setCols).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    await guard(() =>
      api.updateChannel(channelId, {
        name: chForm.name,
        group: chForm.group || null,
        logoUrl: chForm.logoUrl || null,
      }),
    )
  }

  async function guard<T>(fn: () => Promise<T>) {
    setError(null)
    try {
      await fn()
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  async function addRotation(e: React.FormEvent) {
    e.preventDefault()
    if (!rot.collectionId) return
    await guard(() =>
      api.addRotation(channelId, {
        collectionId: Number(rot.collectionId),
        mode: rot.mode,
        count: Number(rot.count) || 1,
        playbackOrder: rot.playbackOrder,
      }),
    )
    setRot({ collectionId: '', mode: 'one', count: '1', playbackOrder: 'chronological' })
  }

  async function addBlock(e: React.FormEvent) {
    e.preventDefault()
    if (!blk.collectionId || blk.days.length === 0) {
      setError('Pick a collection and at least one day.')
      return
    }
    await guard(() =>
      api.addBlock(channelId, {
        collectionId: Number(blk.collectionId),
        days: [...blk.days].sort().join(','),
        startMinute: timeToMin(blk.start),
        endMinute: timeToMin(blk.end),
        playbackOrder: blk.playbackOrder,
        logoUrl: blk.logoUrl || null,
      }),
    )
    setBlk({ ...blk, collectionId: '', logoUrl: '' })
  }

  async function build() {
    setError(null)
    setBuilding(true)
    try {
      await api.buildPlayout(channelId, 48)
      await load()
      await loadPlayout()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Build failed')
    } finally {
      setBuilding(false)
    }
  }

  async function reset() {
    setError(null)
    setBuilding(true)
    try {
      await api.resetPlayout(channelId)
      await api.buildPlayout(channelId, 48)
      await load()
      await loadPlayout()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setBuilding(false)
    }
  }

  if (!ch) return <div className="text-slate-500 text-sm">Loading…</div>

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
        <Link to="/channels" className="hover:text-indigo-300">Channels</Link>
        <span>/</span>
        <span className="text-slate-300">#{ch.number} {ch.name}</span>
      </div>
      <h1 className="text-2xl font-bold mb-6">
        <span className="font-mono text-indigo-300">{ch.number}</span> {ch.name}
      </h1>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm p-3 mb-5">{error}</div>
      )}

      {/* Channel settings */}
      <form onSubmit={saveSettings} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mb-6">
        <h2 className="font-semibold mb-3">Channel settings</h2>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_2fr_auto] gap-3 items-end">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Name</span>
            <input className={input} value={chForm.name} onChange={(e) => setChForm({ ...chForm, name: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Group</span>
            <input className={input} placeholder="Entertainment" value={chForm.group} onChange={(e) => setChForm({ ...chForm, group: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Logo URL</span>
            <div className="flex gap-2 items-center">
              <input className={input + ' flex-1 min-w-0'} placeholder="https://…/logo.png" value={chForm.logoUrl} onChange={(e) => setChForm({ ...chForm, logoUrl: e.target.value })} />
              {chForm.logoUrl && (
                <img src={chForm.logoUrl} alt="" className="w-9 h-9 rounded object-contain bg-slate-950 border border-slate-800 shrink-0" onError={(ev) => ((ev.target as HTMLImageElement).style.visibility = 'hidden')} />
              )}
            </div>
          </label>
          <button type="submit" className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-4 py-2 text-sm font-medium">Save</button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Logo shows in the guide (M3U/XMLTV) and is the default on-screen watermark. Time blocks can override the on-screen logo (rendered once live streaming lands).
        </p>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Rotation */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="font-semibold mb-1">Rotation <span className="text-slate-600 font-normal">(optional)</span></h2>
          <p className="text-slate-500 text-xs mb-4">The 24/7 default — loops forever. Leave empty for a blocks-only channel.</p>
          <div className="space-y-2 mb-4">
            {ch.rotationItems.length === 0 && <div className="text-slate-600 text-sm">No rotation items yet.</div>}
            {ch.rotationItems.map((r, i) => (
              <div key={r.id} className="flex items-center gap-3 text-sm rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
                <span className="text-slate-600 w-5">{i + 1}</span>
                <span className="flex-1 min-w-0 truncate">{r.collection.name}</span>
                <span className="text-xs text-slate-500">
                  {r.mode === 'multiple' ? `${r.count}×` : '1'} · {r.playbackOrder}
                </span>
                <button onClick={() => guard(() => api.deleteRotation(channelId, r.id))} className="text-slate-600 hover:text-rose-400" aria-label="Remove">×</button>
              </div>
            ))}
          </div>
          <form onSubmit={addRotation} className="flex flex-wrap gap-2 items-end border-t border-slate-800 pt-4">
            <select className={input + ' flex-1 min-w-32'} value={rot.collectionId} onChange={(e) => setRot({ ...rot, collectionId: e.target.value })} required>
              <option value="">Collection…</option>
              {cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className={input} value={rot.mode} onChange={(e) => setRot({ ...rot, mode: e.target.value })}>
              <option value="one">1 at a time</option>
              <option value="multiple">multiple</option>
            </select>
            {rot.mode === 'multiple' && (
              <input className={input + ' w-16'} type="number" min="1" value={rot.count} onChange={(e) => setRot({ ...rot, count: e.target.value })} />
            )}
            <select className={input} value={rot.playbackOrder} onChange={(e) => setRot({ ...rot, playbackOrder: e.target.value })}>
              <option value="chronological">in order</option>
              <option value="rotate">rotate shows</option>
              <option value="shuffle">shuffle</option>
            </select>
            <button type="submit" className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-3 py-2 text-sm font-medium">Add</button>
          </form>
        </section>

        {/* Time blocks */}
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="font-semibold mb-1">Time blocks <span className="text-slate-600 font-normal">(optional)</span></h2>
          <p className="text-slate-500 text-xs mb-4">Scheduled slots for specific days/times. Override the rotation while active.</p>
          <div className="space-y-2 mb-4">
            {ch.timeBlocks.length === 0 && <div className="text-slate-600 text-sm">No time blocks.</div>}
            {ch.timeBlocks.map((b) => (
              <div key={b.id} className="flex items-center gap-3 text-sm rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <div className="truncate">{b.collection.name}</div>
                  <div className="text-xs text-slate-500">
                    {formatDays(b.days)} · {minutesToTime(b.startMinute)}–{minutesToTime(b.endMinute)} · {b.playbackOrder}
                    {b.logoUrl && ' · 🖼 logo'}
                  </div>
                </div>
                <button onClick={() => guard(() => api.deleteBlock(channelId, b.id))} className="text-slate-600 hover:text-rose-400" aria-label="Remove">×</button>
              </div>
            ))}
          </div>
          <form onSubmit={addBlock} className="space-y-2 border-t border-slate-800 pt-4">
            <div className="flex gap-1">
              {DAY_NAMES.map((d, i) => {
                const on = blk.days.includes(i)
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setBlk({ ...blk, days: on ? blk.days.filter((x) => x !== i) : [...blk.days, i] })}
                    className={'flex-1 rounded-md text-xs py-1.5 border transition-colors ' + (on ? 'bg-indigo-500/20 border-indigo-500 text-indigo-200' : 'border-slate-700 text-slate-500 hover:border-slate-500')}
                  >
                    {d}
                  </button>
                )
              })}
            </div>
            <input
              className={input + ' w-full'}
              placeholder="On-screen logo URL (optional — defaults to channel logo)"
              value={blk.logoUrl}
              onChange={(e) => setBlk({ ...blk, logoUrl: e.target.value })}
            />
            <div className="flex flex-wrap gap-2 items-end">
              <select className={input + ' flex-1 min-w-32'} value={blk.collectionId} onChange={(e) => setBlk({ ...blk, collectionId: e.target.value })} required>
                <option value="">Collection…</option>
                {cols.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <input className={input} type="time" value={blk.start} onChange={(e) => setBlk({ ...blk, start: e.target.value })} />
              <input className={input} type="time" value={blk.end} onChange={(e) => setBlk({ ...blk, end: e.target.value })} />
              <select className={input} value={blk.playbackOrder} onChange={(e) => setBlk({ ...blk, playbackOrder: e.target.value })}>
                <option value="chronological">in order</option>
                <option value="rotate">rotate shows</option>
                <option value="shuffle">shuffle</option>
              </select>
              <button type="submit" className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-3 py-2 text-sm font-medium">Add</button>
            </div>
          </form>
        </section>
      </div>

      {/* Guide / playout */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mt-6">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h2 className="font-semibold">Guide preview</h2>
          <div className="flex gap-2">
            <button onClick={build} disabled={building || (ch.rotationItems.length === 0 && ch.timeBlocks.length === 0)} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 px-4 py-2 text-sm font-medium">
              {building ? 'Building…' : 'Build 48h'}
            </button>
            <button onClick={reset} disabled={building || (ch.rotationItems.length === 0 && ch.timeBlocks.length === 0)} className="rounded-lg border border-slate-700 hover:border-amber-500/60 hover:text-amber-300 disabled:opacity-40 px-4 py-2 text-sm">
              Reset & rebuild
            </button>
          </div>
        </div>

        {ch.rotationItems.length === 0 && ch.timeBlocks.length === 0 ? (
          <div className="text-slate-500 text-sm">Add a rotation item or a time block, then build the guide.</div>
        ) : !playout || playout.items.length === 0 ? (
          <div className="text-slate-500 text-sm">No playout yet — click <span className="text-indigo-300">Build 48h</span>.</div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {playout.items.slice(0, 60).map((it, i) => {
              const isNow = new Date(it.startTime) <= new Date(playout.now) && new Date(it.stopTime) > new Date(playout.now)
              return (
                <div key={it.id} className={'flex items-center gap-3 py-2 text-sm ' + (isNow ? 'text-indigo-200' : '')}>
                  <span className="font-mono text-xs text-slate-500 w-16 shrink-0">{fmtClock(it.startTime)}</span>
                  {isNow && <span className="text-[10px] bg-indigo-500/20 text-indigo-300 rounded px-1.5 py-0.5 shrink-0">NOW</span>}
                  <span className="flex-1 min-w-0 truncate">{label(it.mediaItem)}</span>
                  <span className="text-xs text-slate-600 shrink-0">{fmtDur(it.mediaItem.durationSec)}</span>
                  {i === 0 && !isNow && <span className="text-[10px] text-slate-600 shrink-0">next</span>}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
