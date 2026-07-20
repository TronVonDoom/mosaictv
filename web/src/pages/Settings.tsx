import { useEffect, useState } from 'react'
import { api, backupUrl, type WatermarkConfig } from '../lib/api'
import WatermarkFields from '../components/WatermarkFields'
import EncodingProfilesCard from '../components/EncodingProfilesCard'
import { toast } from '../lib/toast'

type SettingsTab = 'metadata' | 'watermark' | 'encoding' | 'maintenance'
const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'metadata', label: 'Metadata' },
  { id: 'watermark', label: 'Watermark' },
  { id: 'encoding', label: 'Encoding' },
  { id: 'maintenance', label: 'Maintenance' },
]

export default function Settings() {
  const [tab, setTab] = useState<SettingsTab>('metadata')
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [wm, setWm] = useState<WatermarkConfig | null>(null)
  const [wmMsg, setWmMsg] = useState<string | null>(null)
  const [wipeAssets, setWipeAssets] = useState(true)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetMsg, setResetMsg] = useState<string | null>(null)

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setConfigured(s.tmdbConfigured)
        setWm(s.watermark)
      })
      .catch(() => {})
  }, [])

  async function saveWm(e: React.FormEvent) {
    e.preventDefault()
    if (!wm) return
    setWmMsg(null)
    try {
      const r = await api.saveWatermark(wm)
      setWm(r.watermark)
      setWmMsg('Watermark saved. ✅')
      toast.success('Watermark saved')
    } catch (err) {
      setWmMsg(err instanceof Error ? err.message : 'Failed to save watermark')
    }
  }

  async function resetInstance() {
    if (!confirm('Wipe ALL libraries, channels, collections, logos and settings back to a clean slate? This cannot be undone — back up first.')) return
    setResetBusy(true)
    setResetMsg(null)
    try {
      await api.resetInstance(wipeAssets)
      setResetMsg('Instance reset. Reloading…')
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      setResetMsg(e instanceof Error ? e.message : 'Reset failed')
      setResetBusy(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    setSaving(true)
    try {
      await api.saveTmdbKey(key.trim())
      setConfigured(true)
      setKey('')
      setMsg({ type: 'ok', text: 'TMDB key saved and verified. ✅' })
      toast.success('TMDB key saved')
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Failed to save key' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Settings</h1>
      <p className="text-slate-400 text-sm mb-5">
        Global defaults and external services. Fillers and logos live on each channel; assets live on the
        Media page.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800 mb-6 overflow-x-auto">
        {TABS.map((t) => (
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
          </button>
        ))}
      </div>

      {tab === 'metadata' && (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="font-semibold">TMDB (The Movie Database)</h2>
          {configured != null && (
            <span
              className={
                'text-xs rounded-full px-2 py-0.5 ' +
                (configured
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-slate-700/50 text-slate-400')
              }
            >
              {configured ? 'configured' : 'not set'}
            </span>
          )}
        </div>
        <p className="text-slate-400 text-sm mb-4">
          Provides posters, overviews, genres and ratings. Get a free API key from your{' '}
          <a
            href="https://www.themoviedb.org/settings/api"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-300 hover:text-indigo-200"
          >
            TMDB account → API
          </a>{' '}
          (use the <span className="text-slate-300">API Key (v3 auth)</span>).
        </p>

        {msg && (
          <div
            className={
              'rounded-lg text-sm p-3 mb-4 ' +
              (msg.type === 'ok'
                ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'border border-rose-500/40 bg-rose-500/10 text-rose-300')
            }
          >
            {msg.text}
          </div>
        )}

        <form onSubmit={save} className="flex gap-2">
          <input
            type="password"
            className="flex-1 min-w-0 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm focus:border-indigo-500 outline-none"
            placeholder={configured ? '•••••••• (enter a new key to replace)' : 'Paste your TMDB API key'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
          <button
            type="submit"
            disabled={saving || !key.trim()}
            className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 px-4 py-2 text-sm font-medium shrink-0"
          >
            {saving ? 'Verifying…' : 'Save & verify'}
          </button>
        </form>
      </div>
      )}

      {tab === 'watermark' && wm && (
        <form onSubmit={saveWm} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="font-semibold mb-1">Default watermark (on-screen logo)</h2>
          <p className="text-slate-400 text-sm mb-4">
            The fallback watermark for logos without their own settings (and legacy URL logos). Set
            per-logo overrides on the <span className="text-slate-300">Media</span> page. Intermittent
            mode shows the logo for the set duration every so many minutes, aligned to wall-clock time.
          </p>
          {wmMsg && <div className="text-sm text-emerald-300 mb-3">{wmMsg}</div>}
          <WatermarkFields wm={wm} onChange={setWm} />
          <div className="flex justify-end mt-3">
            <button type="submit" className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-5 py-2 text-sm font-medium">Save default</button>
          </div>
        </form>
      )}

      {tab === 'encoding' && <EncodingProfilesCard />}

      {tab === 'maintenance' && (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="font-semibold mb-1">Maintenance</h2>
        <p className="text-slate-400 text-sm mb-4">
          Back up your data (database + logos + filler) before experimenting, or reset to a clean slate
          for a fresh start.
        </p>
        {resetMsg && <div className="text-sm text-amber-300 mb-3">{resetMsg}</div>}
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={backupUrl}
            className="rounded-lg border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 px-4 py-2 text-sm"
          >
            Download backup (.tar.gz)
          </a>
          <label className="flex items-center gap-2 text-sm text-slate-400 select-none">
            <input type="checkbox" checked={wipeAssets} onChange={(e) => setWipeAssets(e.target.checked)} />
            Also delete uploaded logos &amp; filler
          </label>
          <button
            onClick={resetInstance}
            disabled={resetBusy}
            className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 px-4 py-2 text-sm ml-auto"
          >
            {resetBusy ? 'Resetting…' : 'Reset to clean slate'}
          </button>
        </div>
      </div>
      )}
    </div>
  )
}
