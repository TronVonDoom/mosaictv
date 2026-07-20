import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  api,
  formatDays,
  minutesToTime,
  parseComingUp,
  DEFAULT_COMINGUP,
  type ChannelDetail,
  type Collection,
  type ComingUpConfig,
  type EncodingProfile,
  type Playout,
} from '../lib/api'
import CollectionManager from '../components/CollectionManager'
import LogoPicker from '../components/LogoPicker'
import FillerManager from '../components/FillerManager'
import ComingUpFields from '../components/ComingUpFields'
import TimelineView from '../components/TimelineView'
import WeeklyBlockGrid from '../components/WeeklyBlockGrid'

// Channel-level coming-up state is always a full config; "off" is enabled=false,
// which we persist as null (see saveSettings).
const offComingUp = (): ComingUpConfig => ({ ...DEFAULT_COMINGUP, enabled: false })

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
function minToTimeStr(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}
function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
function fmtDur(sec: number | null): string {
  if (!sec) return ''
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}
function label(m: NonNullable<Playout['items'][number]['mediaItem']>): string {
  if (m.type === 'episode' && m.showTitle) {
    const se = m.season != null && m.episode != null
      ? ` S${String(m.season).padStart(2, '0')}E${String(m.episode).padStart(2, '0')}`
      : ''
    return `${m.showTitle}${se} — ${m.title}`
  }
  return m.title
}

const input = 'rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none'

type Tab = 'general' | 'collections' | 'schedule' | 'fillers' | 'guide'
const TAB_IDS: Tab[] = ['general', 'collections', 'schedule', 'fillers', 'guide']

export default function ChannelEditor() {
  const { id } = useParams()
  const channelId = Number(id)
  const [ch, setCh] = useState<ChannelDetail | null>(null)
  const [cols, setCols] = useState<Collection[]>([])
  const [playout, setPlayout] = useState<Playout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)

  // Deep-linkable tab (survives refresh via the URL hash).
  const [tab, setTabState] = useState<Tab>(() => {
    const h = window.location.hash.replace('#', '') as Tab
    return TAB_IDS.includes(h) ? h : 'general'
  })
  const setTab = (t: Tab) => {
    setTabState(t)
    window.location.hash = t
  }

  const [profiles, setProfiles] = useState<EncodingProfile[]>([])
  const [chForm, setChForm] = useState<{ number: string; name: string; group: string; logoUrl: string; logoId: number | null; profileId: number | null }>({ number: '', name: '', group: '', logoUrl: '', logoId: null, profileId: null })
  const [cu, setCu] = useState<ComingUpConfig>(offComingUp())
  const [rot, setRot] = useState({ collectionId: '', mode: 'one', count: '1', playbackOrder: 'chronological' })
  const [blk, setBlk] = useState<{ collectionId: string; days: number[]; start: string; end: string; playbackOrder: string; logoUrl: string; logoId: number | null; fillerMode: string; startMode: string; comingUp: ComingUpConfig | null }>({
    collectionId: '',
    days: [1, 2, 3, 4, 5],
    start: '18:00',
    end: '21:00',
    playbackOrder: 'chronological',
    logoUrl: '',
    logoId: null,
    fillerMode: 'none',
    startMode: 'soft',
    comingUp: null,
  })
  const [editingBlock, setEditingBlock] = useState<number | null>(null)
  const [guideView, setGuideView] = useState<'timeline' | 'list'>('timeline')

  const load = () => api.channel(channelId).then(setCh).catch(() => {})
  const loadPlayout = () => api.playout(channelId, 24).then(setPlayout).catch(() => {})
  const loadCols = () => api.collections(channelId).then(setCols).catch(() => {})

  useEffect(() => {
    api
      .channel(channelId)
      .then((c) => {
        setCh(c)
        setChForm({
          number: c.number != null ? String(c.number) : '',
          name: c.name,
          group: c.group ?? '',
          logoUrl: c.logoUrl ?? '',
          logoId: c.logoId ?? null,
          profileId: c.profileId ?? null,
        })
        setCu(parseComingUp(c.comingUp) ?? offComingUp())
      })
      .catch(() => {})
    loadPlayout()
    loadCols()
    api.profiles().then((r) => setProfiles(r.profiles)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    await guard(() =>
      api.updateChannel(channelId, {
        number: chForm.number.trim() ? Number(chForm.number) : null,
        name: chForm.name,
        group: chForm.group || null,
        logoUrl: chForm.logoUrl || null,
        logoId: chForm.logoId,
        profileId: chForm.profileId,
        comingUp: cu.enabled ? cu : null,
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

  function resetBlockForm() {
    setEditingBlock(null)
    setBlk({ collectionId: '', days: [1, 2, 3, 4, 5], start: '18:00', end: '21:00', playbackOrder: 'chronological', logoUrl: '', logoId: null, fillerMode: 'none', startMode: 'soft', comingUp: null })
  }

  // Grid click on an empty slot → start a new block prefilled with that day/time.
  function addBlockAt(day: number, startMin: number) {
    setEditingBlock(null)
    setBlk((b) => ({ ...b, collectionId: '', days: [day], start: minToTimeStr(startMin), end: minToTimeStr(Math.min(1439, startMin + 120)) }))
  }

  function editBlock(b: ChannelDetail['timeBlocks'][number]) {
    setEditingBlock(b.id)
    setBlk({
      collectionId: String(b.collectionId),
      days: b.days.split(',').map(Number).filter((n) => !Number.isNaN(n)),
      start: minToTimeStr(b.startMinute),
      end: minToTimeStr(b.endMinute),
      playbackOrder: b.playbackOrder,
      logoUrl: b.logoUrl ?? '',
      logoId: b.logoId ?? null,
      fillerMode: b.fillerMode ?? 'none',
      startMode: b.startMode ?? 'soft',
      comingUp: parseComingUp(b.comingUp),
    })
  }

  async function submitBlock(e: React.FormEvent) {
    e.preventDefault()
    if (!blk.collectionId || blk.days.length === 0) {
      setError('Pick a collection and at least one day.')
      return
    }
    const payload = {
      collectionId: Number(blk.collectionId),
      days: [...blk.days].sort().join(','),
      startMinute: timeToMin(blk.start),
      endMinute: timeToMin(blk.end),
      playbackOrder: blk.playbackOrder,
      logoUrl: blk.logoUrl || null,
      logoId: blk.logoId,
      fillerMode: blk.fillerMode,
      startMode: blk.startMode,
      comingUp: blk.comingUp,
    }
    await guard(() =>
      editingBlock ? api.updateBlock(channelId, editingBlock, payload) : api.addBlock(channelId, payload),
    )
    resetBlockForm()
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

  async function reset(hard = false) {
    if (hard && !confirm('Restart every show/rotation from the beginning? This loses all saved playback positions on this channel.')) return
    setError(null)
    setBuilding(true)
    try {
      await api.resetPlayout(channelId, hard)
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

  const hasSchedule = ch.rotationItems.length > 0 || ch.timeBlocks.length > 0
  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'general', label: 'General' },
    { id: 'collections', label: 'Collections', badge: cols.length || undefined },
    { id: 'schedule', label: 'Schedule', badge: ch.rotationItems.length + ch.timeBlocks.length || undefined },
    { id: 'fillers', label: 'Fillers' },
    { id: 'guide', label: 'Guide' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
        <Link to="/channels" className="hover:text-indigo-300">Channels</Link>
        <span>/</span>
        <span className="text-slate-300">{ch.number != null ? `#${ch.number} ` : ''}{ch.name}</span>
      </div>
      <h1 className="text-2xl font-bold mb-4">
        {ch.number != null ? <span className="font-mono text-indigo-300">{ch.number} </span> : <span className="text-xs uppercase tracking-wide text-slate-600 mr-2 align-middle">draft</span>}
        {ch.name}
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800 mb-6 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              'px-4 py-2 text-sm rounded-t-lg border-b-2 -mb-px whitespace-nowrap transition-colors ' +
              (tab === t.id
                ? 'border-indigo-400 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200')
            }
          >
            {t.label}
            {t.badge != null && <span className="ml-1.5 text-[10px] rounded-full bg-slate-800 text-slate-400 px-1.5 py-0.5">{t.badge}</span>}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm p-3 mb-5">{error}</div>
      )}

      {/* ------- General ------- */}
      {tab === 'general' && (
        <form onSubmit={saveSettings} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="font-semibold mb-1">Channel settings</h2>
          <p className="text-slate-500 text-xs mb-4">
            Identity and output. Leave the number blank to keep the channel a draft (hidden from the guide and
            stream).
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Number</span>
              <input className={input} type="number" placeholder="draft" value={chForm.number} onChange={(e) => setChForm({ ...chForm, number: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Name</span>
              <input className={input} value={chForm.name} onChange={(e) => setChForm({ ...chForm, name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Group</span>
              <input className={input} placeholder="Entertainment" value={chForm.group} onChange={(e) => setChForm({ ...chForm, group: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Encoding profile</span>
              <select className={input} value={chForm.profileId ?? ''} onChange={(e) => setChForm({ ...chForm, profileId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">Default (built-in)</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <label className="flex flex-col gap-1 text-sm flex-1 min-w-56">
              <span className="text-slate-400">Logo</span>
              <LogoPicker value={chForm.logoId} onChange={(id) => setChForm({ ...chForm, logoId: id })} />
            </label>
            <button type="submit" className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-5 py-2 text-sm font-medium">Save</button>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            The channel logo shows in the guide and is the default on-screen watermark; a collection or time block
            can override it. Create encoding profiles under <Link to="/settings" className="text-indigo-300">Settings</Link>.
          </p>

          <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 mt-5">
            <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Coming up next</div>
            <p className="text-slate-500 text-xs mb-3">
              Burns a caption naming the next program over the current one — for this channel's programs (rotation
              and blocks alike). A time block can override it on the Schedule tab. Never shows on filler. Saved with
              the button above.
            </p>
            <ComingUpFields cfg={cu} onChange={setCu} />
          </div>
        </form>
      )}

      {/* ------- Collections ------- */}
      {tab === 'collections' && <CollectionManager channelId={channelId} onChange={loadCols} />}

      {/* ------- Schedule ------- */}
      {tab === 'schedule' && (
        <div className="space-y-6">
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
            <p className="text-slate-500 text-xs mb-4">Scheduled slots for specific days/times. Override the rotation while active. Set each block's filler on the Fillers tab.</p>

            <div className="mb-5">
              <WeeklyBlockGrid blocks={ch.timeBlocks} onEditBlock={editBlock} onAddAt={addBlockAt} />
            </div>

            <div className="space-y-2 mb-4">
              {ch.timeBlocks.map((b) => (
                <div key={b.id} className="flex items-center gap-3 text-sm rounded-lg bg-slate-950/60 border border-slate-800 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{b.collection.name}</div>
                    <div className="text-xs text-slate-500">
                      {formatDays(b.days)} · {minutesToTime(b.startMinute)}–{minutesToTime(b.endMinute)} · {b.playbackOrder}
                      {b.startMode === 'hard' && ' · hard start'}
                      {(b.logoId || b.logoUrl) && ' · logo'}
                      {b.fillerMode && b.fillerMode !== 'none' && ` · filler: ${b.fillerMode}`}
                      {b.comingUp && ' · up-next'}
                    </div>
                  </div>
                  <button onClick={() => editBlock(b)} className="text-xs text-slate-500 hover:text-indigo-300" aria-label="Edit">Edit</button>
                  <button onClick={() => guard(() => api.deleteBlock(channelId, b.id))} className="text-slate-600 hover:text-rose-400" aria-label="Remove">×</button>
                </div>
              ))}
            </div>
            <form onSubmit={submitBlock} className="space-y-2 border-t border-slate-800 pt-4">
              {editingBlock && <div className="text-xs text-indigo-300">Editing a block — change values and Save.</div>}
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
              <LogoPicker value={blk.logoId} onChange={(id) => setBlk({ ...blk, logoId: id })} noneLabel="On-screen logo: use collection/channel logo" />

              <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <label className="flex items-center gap-2 text-sm select-none">
                  <input
                    type="checkbox"
                    checked={blk.comingUp != null}
                    onChange={(e) => setBlk({ ...blk, comingUp: e.target.checked ? blk.comingUp ?? { ...DEFAULT_COMINGUP } : null })}
                  />
                  <span className="text-slate-300">Override “coming up next” for this block</span>
                </label>
                {blk.comingUp ? (
                  <div className="mt-3">
                    <ComingUpFields cfg={blk.comingUp} onChange={(c) => setBlk({ ...blk, comingUp: c })} />
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 mt-1">Uses the channel's setting (General tab). Check to give this block its own — including turning the caption off for this block only.</p>
                )}
              </div>

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
                <select className={input} value={blk.fillerMode} onChange={(e) => setBlk({ ...blk, fillerMode: e.target.value })} title="Fill the leftover time so the block ends on schedule">
                  <option value="none">no filler</option>
                  <option value="between">filler between</option>
                  <option value="end">filler at end</option>
                </select>
                <select className={input} value={blk.startMode} onChange={(e) => setBlk({ ...blk, startMode: e.target.value })} title="Soft: starts at the next program boundary. Hard: starts exactly on time (fills the gap before it).">
                  <option value="soft">soft start</option>
                  <option value="hard">hard start</option>
                </select>
                <button type="submit" className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-3 py-2 text-sm font-medium">{editingBlock ? 'Save' : 'Add'}</button>
                {editingBlock && (
                  <button type="button" onClick={resetBlockForm} className="rounded-lg border border-slate-700 hover:border-slate-500 px-3 py-2 text-sm">Cancel</button>
                )}
              </div>
            </form>
          </section>
        </div>
      )}

      {/* ------- Fillers ------- */}
      {tab === 'fillers' && (
        <div className="space-y-6">
          <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
            <h2 className="font-semibold mb-1">Channel default</h2>
            <p className="text-slate-500 text-xs mb-3">
              Plays during gaps unless the block has its own filler below. Frosted uses this channel's logo + the
              MosaicTV logo; pick an audio track to bake it in and match the clip length.
            </p>
            <FillerManager owner={{ channelId }} hint="channel default" />
          </section>

          {ch.timeBlocks.map((b) => (
            <section key={b.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
              <h2 className="font-semibold mb-1">
                {b.collection.name}{' '}
                <span className="text-xs text-slate-500 font-normal">
                  {formatDays(b.days)} · {minutesToTime(b.startMinute)}–{minutesToTime(b.endMinute)}
                </span>
              </h2>
              <p className="text-slate-500 text-xs mb-3">
                Overrides the channel default while this block is on. Frosted uses the block's logo (else the
                channel's).
              </p>
              <FillerManager owner={{ timeBlockId: b.id }} hint={`during ${b.collection.name}`} />
            </section>
          ))}

          {ch.timeBlocks.length === 0 && (
            <p className="text-sm text-slate-500">No time blocks yet — add some on the Schedule tab to give each its own filler.</p>
          )}
        </div>
      )}

      {/* ------- Guide ------- */}
      {tab === 'guide' && (
        <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold">Guide preview</h2>
              <div className="flex rounded-lg border border-slate-700 overflow-hidden text-xs">
                {(['timeline', 'list'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setGuideView(v)}
                    className={'px-2.5 py-1 capitalize ' + (guideView === v ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-400 hover:text-slate-200')}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={build} disabled={building || !hasSchedule} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-40 px-4 py-2 text-sm font-medium">
                {building ? 'Building…' : 'Build 48h'}
              </button>
              <button onClick={() => reset(false)} disabled={building || !hasSchedule} title="Clears the schedule and rebuilds — shows continue where they left off" className="rounded-lg border border-slate-700 hover:border-amber-500/60 hover:text-amber-300 disabled:opacity-40 px-4 py-2 text-sm">
                Rebuild
              </button>
              <button onClick={() => reset(true)} disabled={building || !hasSchedule} title="Restart every show from episode 1" className="rounded-lg border border-slate-800 text-slate-500 hover:border-rose-500/50 hover:text-rose-300 disabled:opacity-40 px-4 py-2 text-sm">
                Restart from S1E1
              </button>
            </div>
          </div>

          {!hasSchedule ? (
            <div className="text-slate-500 text-sm">Add a rotation item or a time block on the Schedule tab, then build the guide.</div>
          ) : !playout || playout.items.length === 0 ? (
            <div className="text-slate-500 text-sm">No playout yet — click <span className="text-indigo-300">Build 48h</span>.</div>
          ) : guideView === 'timeline' ? (
            <TimelineView playout={playout} />
          ) : (
            <div className="divide-y divide-slate-800/60">
              {playout.items.slice(0, 60).map((it, i) => {
                const isNow = new Date(it.startTime) <= new Date(playout.now) && new Date(it.stopTime) > new Date(playout.now)
                return (
                  <div key={it.id} className={'flex items-center gap-3 py-2 text-sm ' + (isNow ? 'text-indigo-200' : '')}>
                    <span className="font-mono text-xs text-slate-500 w-16 shrink-0">{fmtClock(it.startTime)}</span>
                    {isNow && <span className="text-[10px] bg-indigo-500/20 text-indigo-300 rounded px-1.5 py-0.5 shrink-0">NOW</span>}
                    <span className={'flex-1 min-w-0 truncate ' + (!it.mediaItem ? 'text-slate-500 italic' : '')}>
                      {it.mediaItem ? label(it.mediaItem) : it.title || 'Station ID'}
                    </span>
                    <span className="text-xs text-slate-600 shrink-0">
                      {fmtDur(it.mediaItem?.durationSec ?? (new Date(it.stopTime).getTime() - new Date(it.startTime).getTime()) / 1000)}
                    </span>
                    {i === 0 && !isNow && <span className="text-[10px] text-slate-600 shrink-0">next</span>}
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
