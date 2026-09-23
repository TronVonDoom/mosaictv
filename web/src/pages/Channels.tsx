import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import ChannelCard from '../components/ChannelCard'
import LogoPicker from '../components/LogoPicker'
import { api, type Channel, type ChannelNow } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { confirmDialog } from '../lib/confirm'
import { errorMessage } from '../lib/errors'
import { useNow, usePolling } from '../lib/hooks'
import { toast } from '../lib/toast'
import {
  Banner,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  ModalHeader,
  PageHeader,
  Segmented,
  Skeleton,
} from '../components/ui'

// hls.js is only needed once a preview is actually opened.
const ChannelPreview = lazy(() => import('../components/ChannelPreview'))

type Filter = 'all' | 'live' | 'drafts'

/** New-channel dialog: just enough to name it, then straight into the editor. */
function NewChannelDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [form, setForm] = useState<{ number: string; name: string; group: string; logoId: number | null }>({
    number: '',
    name: '',
    group: '',
    logoId: null,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const created = await api.addChannel({
        number: form.number.trim() ? Number(form.number) : null,
        name: form.name,
        group: form.group || null,
        logoId: form.logoId,
      })
      navigate(`/channels/${created.id}`)
    } catch (err) {
      setError(errorMessage(err, 'Failed to create channel'))
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-lg">
      <ModalHeader
        icon="channels"
        title="New channel"
        subtitle="Name it now — collections, schedule and branding come next."
        onClose={onClose}
      />
      <form onSubmit={submit} className="p-5 space-y-4">
        {error && <Banner>{error}</Banner>}
        <div className="grid grid-cols-[110px_1fr] gap-3">
          <Field label="Number" hint="Blank = draft">
            <Input
              type="number"
              placeholder="—"
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
            />
          </Field>
          <Field label="Name">
            <Input
              autoFocus
              required
              placeholder="Nickelodeon"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Group" hint="Players that support categories sort channels by this.">
          <Input placeholder="Kids" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} />
        </Field>
        <Field label="Logo">
          <LogoPicker value={form.logoId} onChange={(id) => setForm({ ...form, logoId: id })} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} iconRight="chevronRight">
            Create &amp; configure
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default function Channels() {
  const { openConnect } = useOutletContext<{ openConnect: () => void }>()
  const navigate = useNavigate()
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [nowRows, setNowRows] = useState<Record<number, ChannelNow>>({})
  const [creating, setCreating] = useState(false)
  const [previewing, setPreviewing] = useState<Channel | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const nowMs = useNow(15000)

  const refresh = useCallback(() => {
    api.channels().then(setChannels).catch(() => setChannels((c) => c ?? []))
    api
      .channelsNow()
      .then((rows) => setNowRows(Object.fromEntries(rows.map((r) => [r.channelId, r]))))
      .catch(() => {})
  }, [])
  useEffect(() => {
    refresh()
  }, [refresh])
  usePolling(refresh, 15000) // keep now-playing / viewers fresh

  async function del(c: Channel) {
    const ok = await confirmDialog({
      title: `Delete “${c.name}”?`,
      message: 'Its collections, schedule, fillers and built guide go with it. Your media files are not touched.',
      confirmLabel: 'Delete channel',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteChannel(c.id)
      toast.success(`Deleted “${c.name}”`)
      refresh()
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to delete channel'))
    }
  }

  async function copyStream(c: Channel) {
    const url = `${window.location.origin}/iptv/channel/${c.number}.ts`
    if (await copyText(url)) toast.success(`Copied the stream URL for ${c.name}`)
    else toast.error(`Copy blocked by the browser — the URL is ${url}`)
  }

  const all = channels ?? []
  const live = all.filter((c) => c.number != null)
  const drafts = all.filter((c) => c.number == null)
  const shown = filter === 'live' ? live : filter === 'drafts' ? drafts : all

  return (
    <div>
      <PageHeader
        title="Channels"
        icon="channels"
        description="Each channel is a container — its collections, schedule, and fillers all live inside it."
        actions={
          <>
            <Button variant="secondary" icon="cast" onClick={openConnect}>
              Connect a player
            </Button>
            <Button icon="plus" onClick={() => setCreating(true)}>
              New channel
            </Button>
          </>
        }
      />

      {channels != null && all.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
          <Segmented<Filter>
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All ${all.length}` },
              { value: 'live', label: `On air ${live.length}` },
              { value: 'drafts', label: `Drafts ${drafts.length}` },
            ]}
          />
          <span className="text-[12.5px] text-ink-faint">
            {live.reduce((n, c) => n + c.viewers, 0) > 0
              ? `${live.reduce((n, c) => n + c.viewers, 0)} watching right now`
              : 'Nobody watching right now'}
          </span>
        </div>
      )}

      {channels == null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="aspect-[16/13] rounded-2xl" />
          ))}
        </div>
      ) : all.length === 0 ? (
        <EmptyState
          icon="channels"
          title="No channels yet"
          description="A channel is where your collections, schedule and fillers come together into something that actually broadcasts."
          action={
            <Button icon="plus" onClick={() => setCreating(true)}>
              Create your first channel
            </Button>
          }
        />
      ) : shown.length === 0 ? (
        <EmptyState
          icon={filter === 'drafts' ? 'edit' : 'live'}
          title={filter === 'drafts' ? 'No drafts' : 'Nothing on air'}
          description={
            filter === 'drafts'
              ? 'A channel without a number is a draft — hidden from players until you give it one.'
              : 'Give a channel a number to put it in the playlist and guide.'
          }
        />
      ) : (
        <div
          className={`grid gap-4 ${
            // Even rows: two or four channels pair up rather than leave one
            // orphaned under a row of three. Cards stay wide enough for their
            // footer actions.
            shown.length === 2 || shown.length === 4
              ? 'sm:grid-cols-2 min-[1800px]:grid-cols-4'
              : 'sm:grid-cols-2 2xl:grid-cols-3 min-[1800px]:grid-cols-4'
          }`}
        >
          {shown.map((c, i) => (
            <ChannelCard
              key={c.id}
              channel={c}
              now={nowRows[c.id]}
              nowMs={nowMs}
              variant="manage"
              onWatch={() => setPreviewing(c)}
              style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}
              menu={[
                ...(c.number != null
                  ? [
                      { label: 'Watch live', icon: 'play' as const, onSelect: () => setPreviewing(c) },
                      { label: 'Copy stream URL', icon: 'copy' as const, onSelect: () => copyStream(c) },
                    ]
                  : []),
                { label: 'Edit schedule', icon: 'calendar' as const, onSelect: () => navigate(`/channels/${c.id}#schedule`) },
                { label: 'View guide', icon: 'guide' as const, onSelect: () => navigate(`/channels/${c.id}#guide`) },
                'divider' as const,
                { label: 'Delete channel', icon: 'trash' as const, danger: true, onSelect: () => del(c) },
              ]}
            />
          ))}
        </div>
      )}

      {creating && <NewChannelDialog onClose={() => setCreating(false)} />}

      {previewing?.number != null && (
        <Suspense fallback={null}>
          <ChannelPreview
            key={previewing.id}
            number={previewing.number}
            name={previewing.name}
            logoId={previewing.logoId}
            nowPlaying={nowRows[previewing.id]?.now ?? previewing.nowPlaying}
            onClose={() => setPreviewing(null)}
          />
        </Suspense>
      )}
    </div>
  )
}
