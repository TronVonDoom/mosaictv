import { useEffect, useMemo, useRef, useState } from 'react'
import { api, assetFileUrl, type Asset, type Filler } from '../../lib/api'
import { confirmDialog } from '../../lib/confirm'
import { toast } from '../../lib/toast'
import UploadDialog from '../UploadDialog'
import Icon from '../Icon'
import { Badge, Button, EmptyState, IconTile, Input, Skeleton, cx } from '../ui'
import Workspace, { InspectorPlaceholder } from './Workspace'
import { fillerStyleLabel } from '../FillerEditor'

function fmtSize(bytes: number | null): string {
  if (!bytes) return '—'
  const u = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** A decorative level meter; it moves only while its track is playing. */
function Bars({ playing, className }: { playing: boolean; className?: string }) {
  return (
    <span className={cx('flex items-end gap-[3px]', className)}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cx('w-[3px] rounded-full bg-current origin-bottom', playing ? 'eq-bar' : 'scale-y-[0.35]')}
          style={{ height: '100%', animationDelay: `${-i * 0.27}s` }}
        />
      ))}
    </span>
  )
}

/** Studio → Audio: the music that plays under station breaks. */
export default function AudioStudio({ onCount }: { onCount: (n: number) => void }) {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [fillers, setFillers] = useState<Filler[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  // One shared player for the list's play buttons.
  const player = useRef<HTMLAudioElement | null>(null)
  const [playingId, setPlayingId] = useState<number | null>(null)
  const [durations, setDurations] = useState<Record<number, number>>({})

  const refresh = () =>
    api
      .assets('audio')
      .then((a) => {
        setAssets(a)
        onCount(a.length)
      })
      .catch(() => setAssets((x) => x ?? []))
  useEffect(() => {
    refresh()
    api.fillers().then(setFillers).catch(() => {})
    return () => player.current?.pause()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Read each track's length from its metadata — nothing stored has it.
  useEffect(() => {
    for (const a of assets ?? []) {
      if (durations[a.id] != null) continue
      const el = new Audio()
      el.preload = 'metadata'
      el.src = assetFileUrl(a.id)
      el.onloadedmetadata = () => setDurations((d) => ({ ...d, [a.id]: el.duration }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets])

  const usedBy = (id: number) => fillers.filter((f) => f.audioAssetId === id)
  const selected = assets?.find((a) => a.id === selectedId) ?? null
  const shown = useMemo(
    () => (assets ?? []).filter((a) => !query.trim() || a.name.toLowerCase().includes(query.trim().toLowerCase())),
    [assets, query],
  )

  function toggle(a: Asset) {
    if (!player.current) {
      player.current = new Audio()
      player.current.onended = () => setPlayingId(null)
    }
    const p = player.current
    if (playingId === a.id) {
      p.pause()
      setPlayingId(null)
      return
    }
    p.src = assetFileUrl(a.id)
    p.play().then(() => setPlayingId(a.id)).catch(() => setPlayingId(null))
  }

  async function del(a: Asset) {
    const users = usedBy(a.id)
    const ok = await confirmDialog({
      title: `Delete “${a.name}”?`,
      message: users.length
        ? `${users.length} filler${users.length === 1 ? ' uses' : 's use'} it (${users.map((f) => f.name || fillerStyleLabel(f.style)).join(', ')}) — they'll play without music.`
        : 'Nothing uses it right now.',
      confirmLabel: 'Delete track',
      danger: true,
    })
    if (!ok) return
    if (playingId === a.id) {
      player.current?.pause()
      setPlayingId(null)
    }
    await api.deleteAsset(a.id).catch(() => {})
    setSelectedId(null)
    refresh()
  }

  return (
    <>
      <Workspace
        toolbar={
          <>
            <div className="relative flex-1 min-w-48 max-w-sm">
              <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter tracks…" className="w-full pl-9" />
            </div>
            <Button icon="upload" onClick={() => setUploading(true)} className="ml-auto">
              Upload audio
            </Button>
          </>
        }
        inspector={
          selected && (
            <div className="space-y-5">
              <div className="relative overflow-hidden rounded-xl border border-edge p-5 bg-[radial-gradient(120%_120%_at_0%_0%,rgb(244_114_182/0.25),transparent_55%),radial-gradient(120%_120%_at_100%_100%,rgb(139_92_246/0.3),transparent_55%)]">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => toggle(selected)}
                    aria-label={playingId === selected.id ? 'Pause' : 'Play'}
                    className="grid place-items-center w-14 h-14 rounded-full bg-white text-black shadow-[0_10px_30px_-6px_rgb(0_0_0/0.7)] hover:scale-105 transition-transform"
                  >
                    <Icon name={playingId === selected.id ? 'pause' : 'play'} size={22} className={cx('fill-current', playingId !== selected.id && 'translate-x-0.5')} />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-semibold truncate">{selected.name}</div>
                    <div className="text-[12.5px] text-ink-soft tabular-nums">
                      {durations[selected.id] ? fmtTime(durations[selected.id]) : '—'} · {fmtSize(selected.sizeBytes)}
                    </div>
                  </div>
                  <Bars playing={playingId === selected.id} className="h-8 text-pink-300" />
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-edge bg-sunken/60 p-4 text-[13px]">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Type</dt>
                  <dd className="text-ink-soft mt-0.5">{selected.mime}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Uploaded</dt>
                  <dd className="text-ink-soft mt-0.5">{new Date(selected.createdAt).toLocaleDateString()}</dd>
                </div>
              </dl>

              <div>
                <div className="text-[12.5px] font-medium text-ink-soft mb-2">Used by</div>
                {usedBy(selected.id).length === 0 ? (
                  <p className="text-[13px] text-ink-faint">
                    No filler uses this track yet. Pick it as a filler's audio under Studio → Fillers.
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {usedBy(selected.id).map((f) => (
                      <li key={f.id} className="flex items-center gap-2.5 rounded-lg border border-edge bg-sunken/60 px-3 py-2 text-[13px]">
                        <Icon name="clip" size={15} className="text-ink-faint" />
                        <span className="truncate text-ink-soft">{f.name || fillerStyleLabel(f.style)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="pt-1">
                <Button variant="subtle" size="sm" icon="trash" onClick={() => del(selected)}>
                  Delete track
                </Button>
              </div>
            </div>
          )
        }
        inspectorTitle={selected?.name}
        inspectorSubtitle="Audio track"
        onCloseInspector={() => setSelectedId(null)}
        placeholder={
          <InspectorPlaceholder icon={<IconTile name="audio" size="lg" />} title="Select a track">
            Listen to it, see how long it runs, and which fillers play it.
          </InspectorPlaceholder>
        }
      >
        {assets == null ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <EmptyState
            icon="audio"
            title="No audio yet"
            description="Upload music to play under station breaks — a filler can use it as its soundtrack, and match its length to the track."
            action={
              <Button icon="upload" onClick={() => setUploading(true)}>
                Upload a track
              </Button>
            }
          />
        ) : (
          <div className="rounded-2xl border border-edge surface-card divide-y divide-edge/70 overflow-hidden">
            {shown.map((a, i) => {
              const on = a.id === selectedId
              const playing = playingId === a.id
              const users = usedBy(a.id).length
              return (
                <div
                  key={a.id}
                  className={cx('flex items-center gap-3.5 px-4 py-3 transition-colors', on ? 'bg-indigo-500/[0.08]' : 'hover:bg-white/[0.025]')}
                >
                  <button
                    onClick={() => toggle(a)}
                    aria-label={playing ? `Pause ${a.name}` : `Play ${a.name}`}
                    className={cx(
                      'grid place-items-center w-9 h-9 shrink-0 rounded-full transition-colors',
                      playing ? 'bg-pink-500 text-white' : 'bg-raised text-ink-soft hover:bg-white hover:text-black',
                    )}
                  >
                    {playing ? <Bars playing className="h-3.5" /> : <Icon name="play" size={14} className="translate-x-px fill-current" />}
                  </button>
                  <button onClick={() => setSelectedId(on ? null : a.id)} className="min-w-0 flex-1 text-left">
                    <div className={cx('text-[13.5px] font-medium truncate', on ? 'text-ink' : 'text-ink-soft')}>{a.name}</div>
                    <div className="text-[12px] text-ink-faint tabular-nums">
                      <span className="text-ink-ghost mr-1.5">{String(i + 1).padStart(2, '0')}</span>
                      {durations[a.id] ? fmtTime(durations[a.id]) : '—'} · {fmtSize(a.sizeBytes)}
                    </div>
                  </button>
                  {users > 0 ? <Badge tone="accent">{users} filler{users === 1 ? '' : 's'}</Badge> : <Badge>Unused</Badge>}
                  <Icon name="chevronRight" size={16} className={cx('shrink-0', on ? 'text-indigo-300' : 'text-ink-ghost')} />
                </div>
              )
            })}
            {shown.length === 0 && <p className="px-4 py-3 text-[13px] text-ink-faint">No track matches “{query}”.</p>}
          </div>
        )}
      </Workspace>

      {uploading && (
        <UploadDialog
          title="Upload audio"
          subtitle="Music for station breaks — MP3, AAC, FLAC or WAV."
          icon="audio"
          kind="audio"
          accept="audio/*"
          onClose={() => setUploading(false)}
          onUpload={async (name, file) => {
            const created = await api.uploadAsset('audio', name, file)
            toast.success(`Uploaded ${name}`)
            setUploading(false)
            await refresh()
            setSelectedId(created.id)
          }}
        />
      )}
    </>
  )
}
