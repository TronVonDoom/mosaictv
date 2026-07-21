import { lazy, Suspense, useEffect, useState } from 'react'
import Icon from '../components/Icon'
import { Link, useNavigate } from 'react-router-dom'
import { api, logoImageUrl, type Channel } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { errorMessage } from '../lib/errors'
import { usePolling } from '../lib/hooks'
import { toast } from '../lib/toast'
import LogoPicker from '../components/LogoPicker'
import { Banner, Button, Card, EmptyState, Field, Input, PageHeader, buttonClass } from '../components/ui'

// mpegts.js is ~280 kB and only needed once a preview is actually opened, so
// keep it out of the main bundle.
const ChannelPreview = lazy(() => import('../components/ChannelPreview'))

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
    <div className="rounded-xl border border-edge bg-surface/40 px-4 py-2.5 mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      <span className="text-ink-muted inline-flex items-center gap-1.5">
        <Icon name="channels" size={15} colored /> IPTV endpoints for Plex / Jellyfin / Threadfin:
      </span>
      {rows.map((r) =>
        failed === r.url ? (
          <input
            key={r.label}
            readOnly
            autoFocus
            value={r.url}
            onFocus={(e) => e.currentTarget.select()}
            title="Copying was blocked by the browser — copy this manually"
            className="rounded-lg border border-amber-500/60 bg-canvas text-amber-200 px-2.5 py-1 text-xs font-mono w-72 max-w-full"
          />
        ) : (
          <button
            key={r.label}
            onClick={() => copy(r.url)}
            title={r.url}
            className={buttonClass('secondary', 'sm', 'px-2.5 py-1 text-xs')}
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
  }, [])
  usePolling(refresh, 10000) // keep now-playing / viewers fresh

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
      setError(errorMessage(err, 'Failed to create channel'))
    }
  }

  async function del(c: Channel) {
    if (!confirm(`Delete "${c.name}" and everything in it (collections, schedule, fillers)?`)) return
    try {
      await api.deleteChannel(c.id)
      toast.success(`Deleted "${c.name}"`)
      refresh()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to delete channel'))
    }
  }

  return (
    <div>
      <PageHeader
        title="Channels"
        icon="channels"
        description="Each channel is a container — its collections, schedule, and fillers all live inside it."
        actions={
          <Button variant={creating ? 'secondary' : 'primary'} onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : '+ New channel'}
          </Button>
        }
      />

      {error && <Banner className="mb-5">{error}</Banner>}

      {creating && (
        <form onSubmit={add} className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-[110px_1fr_1fr] gap-3 mb-3">
            <Field label="Number (optional)">
              <Input type="number" placeholder="draft" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
            </Field>
            <Field label="Name">
              <Input placeholder="Nickelodeon" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label="Group (optional)">
              <Input placeholder="Kids" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <Field label="Logo (optional)" className="flex-1 min-w-56">
              <LogoPicker value={form.logoId} onChange={(id) => setForm({ ...form, logoId: id })} />
            </Field>
            <Button type="submit" size="lg">
              Create &amp; configure →
            </Button>
          </div>
        </form>
      )}

      <IptvBar />

      {channels.length === 0 ? (
        <EmptyState
          icon="channels"
          title="No channels yet"
          description="A channel is where your collections, schedule and fillers come together into something that actually broadcasts."
          action={
            <Button onClick={() => setCreating(true)}>+ New channel</Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {channels.map((c) => (
            <Card key={c.id} className="p-3 flex items-center gap-4">
              <div className="text-lg font-mono w-12 text-center shrink-0" title={c.number == null ? 'Draft — no number assigned' : undefined}>
                {c.number == null ? <span className="text-xs text-ink-ghost uppercase">draft</span> : <span className="text-indigo-300">{c.number}</span>}
              </div>
              <div className="w-11 h-11 rounded-lg bg-canvas border border-edge shrink-0 flex items-center justify-center overflow-hidden">
                {c.logoId ? (
                  <img src={logoImageUrl(c.logoId)} alt="" className="max-w-full max-h-full object-contain" />
                ) : (
                  <Icon name="show" size={20} className="text-ink-ghost" />
                )}
              </div>
              <Link to={`/channels/${c.id}`} className="flex-1 min-w-0 group">
                <div className="font-medium group-hover:text-indigo-300 transition-colors truncate">
                  {c.name}
                  {c.group && <span className="text-xs text-ink-faint ml-2">{c.group}</span>}
                </div>
                <div className="text-xs text-ink-faint truncate">
                  {c.nowPlaying ? (
                    <span className="text-ink-muted">▶ {c.nowPlaying}</span>
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
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-400 pulse-live" />
                  {c.viewers} watching
                </span>
              )}
              <button
                onClick={() => setPreviewing(c)}
                disabled={c.number == null}
                title={c.number == null ? 'Draft channels have no number to stream from' : `Preview channel ${c.number}`}
                className={buttonClass('secondary', 'sm', 'shrink-0 disabled:opacity-30 disabled:cursor-not-allowed')}
              >
                ▶ Preview
              </button>
              <Link to={`/channels/${c.id}`} className={buttonClass('secondary', 'sm', 'shrink-0')}>
                Edit
              </Link>
              <Button variant="subtle" size="sm" onClick={() => del(c)} className="shrink-0">
                Delete
              </Button>
            </Card>
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
