import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Channel } from '../lib/api'
import LogoPicker from '../components/LogoPicker'

function IptvEndpoints() {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const [copied, setCopied] = useState<string | null>(null)
  const rows = [
    { label: 'M3U playlist', url: `${origin}/iptv/channels.m3u` },
    { label: 'XMLTV guide', url: `${origin}/iptv/xmltv.xml` },
  ]
  const copy = (url: string) => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(url)
      setTimeout(() => setCopied(null), 1500)
    })
  }
  return (
    <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 p-4 mb-6">
      <div className="text-sm font-medium mb-2">📺 IPTV endpoints</div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-sm">
            <span className="text-slate-400 w-28 shrink-0">{r.label}</span>
            <code className="flex-1 min-w-0 truncate text-slate-300 bg-slate-950/60 rounded px-2 py-1 text-xs">{r.url}</code>
            <button onClick={() => copy(r.url)} className="text-xs rounded border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 px-2 py-1 shrink-0">
              {copied === r.url ? 'Copied!' : 'Copy'}
            </button>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500 mt-2">
        Add these to Plex, Jellyfin, or Threadfin. Build a channel's guide so the EPG has programs. Live playback arrives in the next milestone.
      </p>
    </div>
  )
}

export default function Channels() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [form, setForm] = useState<{ number: string; name: string; group: string; logoId: number | null }>({ number: '', name: '', group: '', logoId: null })
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const refresh = () => api.channels().then(setChannels).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      // Two-step: create the shell, then drop straight into the editor to
      // build its collections, rotation, and blocks.
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

  async function del(id: number) {
    setError(null)
    try {
      await api.deleteChannel(id)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete channel')
    }
  }

  const input = 'rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none'

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Channels</h1>
      <p className="text-slate-400 text-sm mb-6">
        Each channel plays a 24/7 rotation with optional day/time blocks.
      </p>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm p-3 mb-5">
          {error}
        </div>
      )}

      <IptvEndpoints />

      <form onSubmit={add} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mb-6">
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

      {channels.length === 0 ? (
        <div className="text-slate-500 text-sm">No channels yet.</div>
      ) : (
        <div className="space-y-2">
          {channels.map((c) => (
            <div key={c.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex items-center gap-4">
              <div className="text-lg font-mono w-12 text-center shrink-0" title={c.number == null ? 'Draft — no number assigned' : undefined}>
                {c.number == null ? <span className="text-xs text-slate-600 uppercase">draft</span> : <span className="text-indigo-300">{c.number}</span>}
              </div>
              <Link to={`/channels/${c.id}`} className="flex-1 min-w-0 group">
                <div className="font-medium group-hover:text-indigo-300 transition-colors">
                  {c.name}
                  {c.group && <span className="text-xs text-slate-500 ml-2">{c.group}</span>}
                </div>
                <div className="text-xs text-slate-500">
                  {c.rotationCount} rotation · {c.blockCount} blocks ·{' '}
                  {c.playoutCount > 0 ? `${c.playoutCount} programs scheduled` : 'not built yet'}
                </div>
              </Link>
              <Link to={`/channels/${c.id}`} className="rounded-lg border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 px-3 py-1.5 text-sm">
                Edit
              </Link>
              <button onClick={() => del(c.id)} className="rounded-lg border border-slate-800 text-slate-500 hover:border-rose-500/50 hover:text-rose-400 px-3 py-1.5 text-sm">
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
