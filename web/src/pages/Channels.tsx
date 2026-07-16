import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, logoImageUrl, type Channel } from '../lib/api'
import { copyText } from '../lib/clipboard'
import LogoPicker from '../components/LogoPicker'

// mpegts.js is ~280 kB and only needed once a preview is actually opened, so
// keep it out of the main bundle.
const ChannelPreview = lazy(() => import('../components/ChannelPreview'))

const input = 'rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none'

// Compact one-line bar with copyable IPTV endpoint URLs.
function IptvBar() {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const [copied, setCopied] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const copy = async (url: string) => {
    const ok = await copyText(url)
    setCopied(ok ? url : null)
    setFailed(ok ? null : url)
    setTimeout(() => {
      setCopied(null)
      setFailed(null)
    }, 2500)
  }
  const rows = [
    { label: 'M3U', url: `${origin}/iptv/channels.m3u` },
    { label: 'XMLTV', url: `${origin}/iptv/xmltv.xml` },
  ]
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2.5 mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span className="text-slate-400">📺 IPTV endpoints for Plex / Jellyfin / Threadfin:</span>
      {rows.map((r) =>
        failed === r.url ? (
          <input
            key={r.label}
            readOnly
            autoFocus
            value={r.url}
            onFocus={(e) => e.currentTarget.select()}
            title="Copying was blocked by the browser — copy this manually"
            className="rounded-lg border border-amber-500/60 bg-slate-950 text-amber-200 px-2.5 py-1 text-xs font-mono w-72 max-w-full"
          />
        ) : (
          <button
            key={r.label}
            onClick={() => copy(r.url)}
            title={r.url}
            className="rounded-lg border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 px-2.5 py-1 text-xs"
          >
            {copied === r.url ? 'Copied!' : `Copy ${r.label}`}
          </button>
        ),
      )}
    </div>
  )
}

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<{ number: string; name: string; group: string; logoId: number | null }>({ number: '', name: '', group: '', logoId: null })
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState<Channel | null>(null)
  const navigate = useNavigate()

  const refresh = () => api.channels().then(setChannels).catch(() => {})
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 10000) // keep now-playing / viewers fresh
    return () => clearInterval(id)
  }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      // Two-step: create the shell, then drop straight into the editor.
      const created = await api.addChannel({
        number: form.number.trim() ? Number(form.number) : null,
        name: form.name,
        group: form.group || null,
        logoId: form.logoId,
      })
      navigate(`/channels/${created.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create channel')
    }
  }

  async function del(c: Channel) {
    if (!confirm(`Delete "${c.name}" and everything in it (collections, schedule, fillers)?`)) return
    setError(null)
    try {
      await api.deleteChannel(c.id)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete channel')
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-bold">Channels</h1>
        <button
          onClick={() => setCreating((v) => !v)}
          className={
            creating
              ? 'rounded-lg border border-slate-700 hover:border-slate-500 px-4 py-2 text-sm'
              : 'rounded-lg bg-indigo-500 hover:bg-indigo-400 px-4 py-2 text-sm font-medium'
          }
        >
          {creating ? 'Cancel' : '+ New channel'}
        </button>
      </div>
      <p className="text-slate-400 text-sm mb-6">
        Each channel is a container: its collections, schedule, and fillers live inside it.
      </p>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm p-3 mb-5">
          {error}
        </div>
      )}

      {creating && (
        <form onSubmit={add} className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-[110px_1fr_1fr] gap-3 mb-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Number (optional)</span>
              <input className={input} type="number" placeholder="draft" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Name</span>
              <input className={input} placeholder="Nickelodeon" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-slate-400">Group (optional)</span>
              <input className={input} placeholder="Kids" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} />
            </label>
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <label className="flex flex-col gap-1 text-sm flex-1 min-w-56">
              <span className="text-slate-400">Logo (optional)</span>
              <LogoPicker value={form.logoId} onChange={(id) => setForm({ ...form, logoId: id })} />
            </label>
            <button type="submit" className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-5 py-2 font-medium text-sm">
              Create &amp; configure →
            </button>
          </div>
        </form>
      )}

      <IptvBar />

      {channels.length === 0 ? (
        <div className="text-slate-500 text-sm">No channels yet — click <span className="text-indigo-300">+ New channel</span> to create one.</div>
      ) : (
        <div className="space-y-2">
          {channels.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 flex items-center gap-4">
              <div className="text-lg font-mono w-12 text-center shrink-0" title={c.number == null ? 'Draft — no number assigned' : undefined}>
                {c.number == null ? <span className="text-xs text-slate-600 uppercase">draft</span> : <span className="text-indigo-300">{c.number}</span>}
              </div>
              <div className="w-11 h-11 rounded-lg bg-slate-950 border border-slate-800 shrink-0 flex items-center justify-center overflow-hidden">
                {c.logoId ? (
                  <img src={logoImageUrl(c.logoId)} alt="" className="max-w-full max-h-full object-contain" />
                ) : (
                  <span className="text-slate-700 text-lg">📺</span>
                )}
              </div>
              <Link to={`/channels/${c.id}`} className="flex-1 min-w-0 group">
                <div className="font-medium group-hover:text-indigo-300 transition-colors truncate">
                  {c.name}
                  {c.group && <span className="text-xs text-slate-500 ml-2">{c.group}</span>}
                </div>
                <div className="text-xs text-slate-500 truncate">
                  {c.nowPlaying ? (
                    <span className="text-slate-400">▶ {c.nowPlaying}</span>
                  ) : (
                    <>
                      {c.rotationCount} rotation · {c.blockCount} blocks ·{' '}
                      {c.playoutCount > 0 ? `${c.playoutCount} programs scheduled` : 'guide not built'}
                    </>
                  )}
                </div>
              </Link>
              {c.viewers > 0 && (
                <span className="shrink-0 inline-flex items-center gap-1.5 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-full px-2.5 py-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                  {c.viewers} watching
                </span>
              )}
              <button
                onClick={() => setPreviewing(c)}
                disabled={c.number == null}
                title={c.number == null ? 'Draft channels have no number to stream from' : `Preview channel ${c.number}`}
                className="rounded-lg border border-slate-700 enabled:hover:border-indigo-500 enabled:hover:text-indigo-300 disabled:opacity-30 disabled:cursor-not-allowed px-3 py-1.5 text-sm shrink-0"
              >
                ▶ Preview
              </button>
              <Link to={`/channels/${c.id}`} className="rounded-lg border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 px-3 py-1.5 text-sm shrink-0">
                Edit
              </Link>
              <button onClick={() => del(c)} className="rounded-lg border border-slate-800 text-slate-500 hover:border-rose-500/50 hover:text-rose-400 px-3 py-1.5 text-sm shrink-0">
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {previewing?.number != null && (
        <Suspense fallback={null}>
          <ChannelPreview
            key={previewing.id}
            number={previewing.number}
            name={previewing.name}
            nowPlaying={previewing.nowPlaying}
            onClose={() => setPreviewing(null)}
          />
        </Suspense>
      )}
    </div>
  )
}
