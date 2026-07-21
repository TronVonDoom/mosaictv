import { useEffect, useState } from 'react'
import { api, backupUrl, type StreamMode, type WatermarkConfig } from '../lib/api'
import { errorMessage } from '../lib/errors'
import WatermarkFields from '../components/WatermarkFields'
import EncodingProfilesCard from '../components/EncodingProfilesCard'
import { toast } from '../lib/toast'
import { Badge, Button, Card, Input, LinkButton, Tabs, cx } from '../components/ui'

type SettingsTab = 'metadata' | 'streaming' | 'watermark' | 'encoding' | 'maintenance'
const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'metadata', label: 'Metadata' },
  { id: 'streaming', label: 'Streaming' },
  { id: 'watermark', label: 'Watermark' },
  { id: 'encoding', label: 'Encoding' },
  { id: 'maintenance', label: 'Maintenance' },
]

const STREAM_MODES = [
  {
    id: 'hls',
    title: 'Shared HLS',
    desc: 'One transcode per channel, served to every viewer. Best for multiple viewers / weaker CPUs. Recommended.',
  },
  {
    id: 'mpegts',
    title: 'MPEG-TS (per-client)',
    desc: 'A separate transcode for each viewer. Simplest; fine for a single viewer or a very fast box.',
  },
] as const

export default function Settings() {
  const [tab, setTab] = useState<SettingsTab>('metadata')
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [wm, setWm] = useState<WatermarkConfig | null>(null)
  const [streamMode, setStreamMode] = useState<StreamMode>('mpegts')
  const [wipeAssets, setWipeAssets] = useState(true)
  const [resetBusy, setResetBusy] = useState(false)

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setConfigured(s.tmdbConfigured)
        setWm(s.watermark)
        setStreamMode(s.streamMode)
      })
      .catch(() => {})
  }, [])

  async function saveMode(mode: StreamMode) {
    setStreamMode(mode)
    try {
      await api.saveStreamMode(mode)
      toast.success(`Streaming mode: ${mode === 'hls' ? 'Shared HLS' : 'MPEG-TS'}`)
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save streaming mode'))
    }
  }

  async function saveWm(e: React.FormEvent) {
    e.preventDefault()
    if (!wm) return
    try {
      const r = await api.saveWatermark(wm)
      setWm(r.watermark)
      toast.success('Watermark saved')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save watermark'))
    }
  }

  async function resetInstance() {
    if (
      !confirm(
        'Wipe ALL libraries, channels, collections, logos and settings back to a clean slate? This cannot be undone — back up first.',
      )
    )
      return
    setResetBusy(true)
    try {
      await api.resetInstance(wipeAssets)
      toast.info('Instance reset. Reloading…')
      setTimeout(() => window.location.reload(), 1200)
    } catch (err) {
      toast.error(errorMessage(err, 'Reset failed'))
      setResetBusy(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.saveTmdbKey(key.trim())
      setConfigured(true)
      setKey('')
      toast.success('TMDB key saved and verified')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save key'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">Settings</h1>
      <p className="text-slate-400 text-sm mb-5">
        Global defaults and external services. Fillers and logos live on each channel; assets live on the
        Studio page.
      </p>

      <Tabs tabs={TABS} active={tab} onChange={setTab} className="mb-6" />

      {tab === 'metadata' && (
        <Card>
          <div className="flex items-center gap-3 mb-2">
            <h2 className="font-semibold">TMDB (The Movie Database)</h2>
            {configured != null && (
              <Badge tone={configured ? 'good' : 'neutral'}>{configured ? 'configured' : 'not set'}</Badge>
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

          <form onSubmit={save} className="flex gap-2">
            <Input
              type="password"
              className="flex-1 min-w-0 font-mono"
              placeholder={configured ? '•••••••• (enter a new key to replace)' : 'Paste your TMDB API key'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
            />
            <Button type="submit" disabled={saving || !key.trim()} className="shrink-0">
              {saving ? 'Verifying…' : 'Save & verify'}
            </Button>
          </form>
        </Card>
      )}

      {tab === 'streaming' && (
        <Card>
          <h2 className="font-semibold mb-1">Streaming mode</h2>
          <p className="text-slate-400 text-sm mb-4">
            How the M3U hands out channel streams. Change takes effect the next time a player reloads the
            playlist.
          </p>
          <div className="space-y-2">
            {STREAM_MODES.map((o) => (
              <label
                key={o.id}
                className={cx(
                  'flex gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
                  streamMode === o.id
                    ? 'border-indigo-500/60 bg-indigo-500/5'
                    : 'border-slate-800 hover:border-slate-600',
                )}
              >
                <input
                  type="radio"
                  name="streamMode"
                  className="mt-0.5"
                  checked={streamMode === o.id}
                  onChange={() => saveMode(o.id)}
                />
                <div>
                  <div className="text-sm font-medium">{o.title}</div>
                  <div className="text-xs text-slate-500">{o.desc}</div>
                </div>
              </label>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Both endpoints stay live regardless of this setting — a channel is always reachable at{' '}
            <code className="text-slate-400">/iptv/channel/N.ts</code> and{' '}
            <code className="text-slate-400">/iptv/channel/N/index.m3u8</code>.
          </p>
        </Card>
      )}

      {tab === 'watermark' && wm && (
        <Card>
          <form onSubmit={saveWm}>
            <h2 className="font-semibold mb-1">Default watermark (on-screen logo)</h2>
            <p className="text-slate-400 text-sm mb-4">
              The fallback watermark for logos without their own settings (and legacy URL logos). Set
              per-logo overrides on the <span className="text-slate-300">Studio</span> page. Intermittent
              mode shows the logo for the set duration every so many minutes, aligned to wall-clock time.
            </p>
            <WatermarkFields wm={wm} onChange={setWm} />
            <div className="flex justify-end mt-3">
              <Button type="submit" size="lg">
                Save default
              </Button>
            </div>
          </form>
        </Card>
      )}

      {tab === 'encoding' && <EncodingProfilesCard />}

      {tab === 'maintenance' && (
        <Card>
          <h2 className="font-semibold mb-1">Maintenance</h2>
          <p className="text-slate-400 text-sm mb-4">
            Back up your data (database + logos + filler) before experimenting, or reset to a clean slate
            for a fresh start.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <LinkButton href={backupUrl}>Download backup (.tar.gz)</LinkButton>
            <label className="flex items-center gap-2 text-sm text-slate-400 select-none">
              <input
                type="checkbox"
                checked={wipeAssets}
                onChange={(e) => setWipeAssets(e.target.checked)}
              />
              Also delete uploaded logos &amp; filler
            </label>
            <Button variant="danger" onClick={resetInstance} disabled={resetBusy} className="ml-auto">
              {resetBusy ? 'Resetting…' : 'Reset to clean slate'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}
