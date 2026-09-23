import { useCallback, useEffect, useRef, useState } from 'react'
import { api, assetFileUrl, type Asset, type Channel, type Filler, type FillerInput } from '../../lib/api'
import { confirmDialog } from '../../lib/confirm'
import { errorMessage } from '../../lib/errors'
import { toast } from '../../lib/toast'
import FillerEditor, { fillerStyleLabel as styleLabel } from '../FillerEditor'
import Icon from '../Icon'
import { Badge, Banner, Button, EmptyState, IconTile, Menu, ProgressBar, Select, Skeleton, cx } from '../ui'
import Workspace, { InspectorPlaceholder } from './Workspace'

function fmtSize(bytes: number | null): string {
  if (!bytes) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

const draftOf = (f: Filler): FillerInput => ({
  name: f.name,
  style: f.style,
  assetId: f.assetId,
  audioAssetId: f.audioAssetId,
  logoId: f.logoId,
  durationMode: f.durationMode,
  durationSec: f.durationSec,
  resolution: f.resolution,
  logoScale: f.logoScale,
})

/** A clip's first second as its thumbnail; plays muted while hovered. */
function ClipThumb({ assetId }: { assetId: number }) {
  const ref = useRef<HTMLVideoElement>(null)
  return (
    <video
      ref={ref}
      src={`${assetFileUrl(assetId)}#t=1.5`}
      preload="metadata"
      muted
      loop
      playsInline
      onMouseEnter={() => ref.current?.play().catch(() => {})}
      onMouseLeave={() => {
        const v = ref.current
        if (v) {
          v.pause()
          v.currentTime = 1.5
        }
      }}
      className="absolute inset-0 w-full h-full object-cover"
    />
  )
}

/**
 * Studio → Fillers: the shared library of station-ID clips, and the uploads
 * that back a "custom" one.
 *
 * Uploading a clip creates its filler in the same step — a clip of kind
 * "filler" is only ever read through Filler.assetId, so it did nothing until
 * wrapped. Leftover uploads nothing points at stay reachable at the bottom.
 */
export default function FillersStudio({ onCount }: { onCount: (n: number) => void }) {
  const [fillers, setFillers] = useState<Filler[] | null>(null)
  const [fillerAssets, setFillerAssets] = useState<Asset[]>([])
  const [audioAssets, setAudioAssets] = useState<Asset[]>([])
  const [selected, setSelected] = useState<number | 'new' | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [showUnused, setShowUnused] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  // A generated filler is branded with the logo of wherever it plays, so the
  // library — which is channel-agnostic — has to be told whose logo to preview.
  const [channels, setChannels] = useState<Channel[]>([])
  const [previewChannelId, setPreviewChannelId] = useState<number | null>(null)

  // fillerId -> percent, for whatever the SERVER is building. Generation
  // outlives this component, so the source of truth is the job list, never a
  // local "I clicked Generate" flag.
  const [jobs, setJobs] = useState<Record<number, number>>({})
  const watched = useRef<Set<number>>(new Set()) // jobs we saw run while mounted
  const settled = useRef<Set<number>>(new Set()) // finished jobs already acted on
  // Clicked but the POST hasn't come back yet, so the server can't report it.
  // Held separately or a poll landing in that window would blank the bar and,
  // with nothing left "in flight", stop polling a build that is really running.
  const starting = useRef<Set<number>>(new Set())

  const refresh = () =>
    api
      .fillers()
      .then((f) => {
        setFillers(f)
        onCount(f.length)
      })
      .catch(() => setFillers((x) => x ?? []))
  const refreshAssets = () => api.assets('filler').then(setFillerAssets).catch(() => {})

  useEffect(() => {
    refresh()
    refreshAssets()
    api.assets('audio').then(setAudioAssets).catch(() => {})
    api.channels().then(setChannels).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const poll = useCallback(async () => {
    const list = await api.fillerGenJobs().catch(() => null)
    if (!list) return
    const active: Record<number, number> = {}
    let finished = false
    for (const j of list) {
      if (!j.done) {
        active[j.fillerId] = j.percent
        watched.current.add(j.fillerId)
        continue
      }
      if (settled.current.has(j.fillerId)) continue // already handled this one
      settled.current.add(j.fillerId)
      finished = true
      if (j.error) setGenError(j.error)
      // Surface a build this page was watching — not one that finished ten
      // minutes ago in another tab.
      else if (watched.current.has(j.fillerId)) setSelected(j.fillerId)
    }
    for (const id of starting.current) if (!(id in active)) active[id] = 0
    setJobs(active)
    if (finished) {
      refresh()
      refreshAssets()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One poll on mount picks up anything already running (or just finished),
  // then keep polling only while something is in flight.
  useEffect(() => {
    poll()
  }, [poll])
  const busy = Object.keys(jobs).length > 0
  useEffect(() => {
    if (!busy) return
    const t = setInterval(poll, 700)
    return () => clearInterval(t)
  }, [busy, poll])

  // Upload + wrap in one action: the clip is only ever useful as a filler.
  async function uploadClip(file: File) {
    const name = file.name.replace(/\.[^.]+$/, '')
    setUploading(true)
    try {
      const asset = await api.uploadAsset('filler', name, file)
      const f = await api.addFiller({ name, style: 'custom', assetId: asset.id, audioAssetId: null, durationMode: 'fixed', durationSec: 30, resolution: '1080p', logoScale: 1 })
      toast.success(`Added ${name}`)
      await refresh()
      refreshAssets()
      setSelected(f.id)
    } catch (e) {
      toast.error(errorMessage(e, 'Upload failed'))
      refreshAssets() // the clip may have landed even if the filler didn't
    } finally {
      setUploading(false)
      if (uploadRef.current) uploadRef.current.value = ''
    }
  }

  async function del(f: Filler) {
    const src = f.style === 'custom' ? fillerAssets.find((a) => a.id === f.assetId) : undefined
    const shared = src != null && (fillers ?? []).some((o) => o.id !== f.id && o.assetId === src.id)
    const msg =
      src && !shared
        ? `“${f.name || src.name}” and its uploaded clip are deleted, and it's removed from every channel and block using it.`
        : `“${f.name || styleLabel(f.style)}” is removed from every channel and block using it.`
    if (!(await confirmDialog({ title: 'Delete this filler?', message: msg, confirmLabel: 'Delete filler', danger: true }))) return
    await api.deleteFiller(f.id).catch(() => {})
    setSelected(null)
    refresh()
    refreshAssets()
  }

  async function generate(id: number) {
    setGenError(null)
    settled.current.delete(id)
    watched.current.add(id)
    starting.current.add(id)
    setJobs((j) => ({ ...j, [id]: 0 })) // bar appears on click; polling takes over
    try {
      await api.generateFillerClip(id, previewChannelId != null ? { channelId: previewChannelId } : undefined)
      starting.current.delete(id) // the server owns it now
      poll()
    } catch (e) {
      starting.current.delete(id)
      setGenError(errorMessage(e, 'Generation failed'))
      setJobs((j) => {
        const n = { ...j }
        delete n[id]
        return n
      })
    }
  }

  async function delUnused(id: number) {
    await api.deleteAsset(id).catch(() => {})
    refreshAssets()
  }

  const audioName = (id: number | null) => audioAssets.find((a) => a.id === id)?.name
  const clipOf = (id: number | null) => fillerAssets.find((a) => a.id === id)
  const previewChannelName = channels.find((c) => c.id === previewChannelId)?.name
  const unused = fillerAssets.filter((a) => !a.generated && !(fillers ?? []).some((f) => f.assetId === a.id))
  const current = typeof selected === 'number' ? (fillers ?? []).find((f) => f.id === selected) ?? null : null
  const clipId = (f: Filler) => f.generatedAssetId ?? (f.style === 'custom' ? clipOf(f.assetId)?.id ?? null : null)

  const inspector =
    selected === 'new' ? (
      <FillerEditor
        key="new"
        previewOwner={previewChannelId != null ? { channelId: previewChannelId } : undefined}
        onCancel={() => setSelected(null)}
        onSaved={(f) => {
          toast.success('Filler added')
          refresh()
          setSelected(f.id)
        }}
      />
    ) : current ? (
      <div className="space-y-5">
        {/* The clip, or how to get one */}
        <div>
          <div className="relative aspect-video rounded-xl overflow-hidden bg-black ring-1 ring-white/10">
            {jobs[current.id] != null ? (
              <div className="absolute inset-0 grid place-items-center p-6">
                <div className="w-full max-w-60 text-center">
                  <Icon name="sparkles" size={22} className="mx-auto mb-3 text-indigo-300" />
                  <ProgressBar value={jobs[current.id] / 100} className="h-1.5" />
                  <div className="mt-2 text-[12.5px] text-ink-soft tabular-nums">Building the clip… {jobs[current.id]}%</div>
                  <div className="mt-1 text-[11.5px] text-ink-faint">Runs on the server — you can leave this page.</div>
                </div>
              </div>
            ) : clipId(current) != null ? (
              <video key={clipId(current)} controls src={assetFileUrl(clipId(current) as number)} className="w-full h-full" />
            ) : (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <div>
                  <p className="text-[12.5px] text-ink-muted mb-3 max-w-64">
                    Airs as-is — a preview is optional. Build one to watch it here
                    {previewChannelName ? `, branded for ${previewChannelName}` : ''}.
                  </p>
                  <Button size="sm" icon="sparkles" onClick={() => generate(current.id)}>
                    Generate preview
                  </Button>
                </div>
              </div>
            )}
          </div>
          {current.generatedAssetId != null && jobs[current.id] == null && (
            <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-ink-faint">
              <span>Rebuilt with each channel's own logo when it airs.</span>
              <Button variant="ghost" size="sm" icon="refresh" onClick={() => generate(current.id)}>
                Regenerate
              </Button>
            </div>
          )}
        </div>

        <FillerEditor
          key={current.id}
          editId={current.id}
          initial={draftOf(current)}
          previewOwner={previewChannelId != null ? { channelId: previewChannelId } : undefined}
          onCancel={() => setSelected(null)}
          onSaved={() => {
            toast.success('Filler saved')
            refresh()
            refreshAssets()
          }}
        />

        <div className="pt-1 border-t border-edge">
          <Button variant="subtle" size="sm" icon="trash" onClick={() => del(current)} className="mt-4">
            Delete filler
          </Button>
        </div>
      </div>
    ) : null

  return (
    <>
      <input
        ref={uploadRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) uploadClip(f)
        }}
      />
      <Workspace
        toolbar={
          <>
            {channels.length > 0 && (
              <label className="flex items-center gap-2 text-[12.5px] text-ink-faint">
                <span className="whitespace-nowrap">Preview as</span>
                <Select
                  value={previewChannelId ?? ''}
                  onChange={(e) => setPreviewChannelId(e.target.value ? Number(e.target.value) : null)}
                  title="Generated fillers are branded with a channel's logo — pick which one to build the preview for"
                >
                  <option value="">where it's assigned</option>
                  {channels.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.number != null ? `${c.number} · ` : ''}
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="secondary"
                icon="upload"
                loading={uploading}
                onClick={() => uploadRef.current?.click()}
                title="Upload your own bumper or ident — it becomes a filler you can assign straight away"
              >
                Upload clip
              </Button>
              <Button icon="plus" onClick={() => setSelected('new')}>
                New filler
              </Button>
            </div>
          </>
        }
        inspector={inspector}
        inspectorTitle={selected === 'new' ? 'New filler' : current ? current.name || styleLabel(current.style) : undefined}
        inspectorSubtitle={selected === 'new' ? 'Generated from a logo, or your own clip' : current ? styleLabel(current.style) : undefined}
        onCloseInspector={() => setSelected(null)}
        placeholder={
          <InspectorPlaceholder icon={<IconTile name="clip" size="lg" />} title="Select a filler">
            Watch it, change its look, music and length, or build a fresh preview. Assign fillers from a channel's Fillers
            tab.
          </InspectorPlaceholder>
        }
      >
        {genError && <Banner className="mb-4">{genError}</Banner>}
        {fillers == null ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
            ))}
          </div>
        ) : fillers.length === 0 ? (
          <EmptyState
            icon="clip"
            title="No fillers yet"
            description="Station-ID clips cover the gaps between programs. Upload your own bumper, or have one generated from a channel's logo."
            action={
              <Button icon="plus" onClick={() => setSelected('new')}>
                New filler
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {fillers.map((f) => {
              const on = f.id === selected
              const pct = jobs[f.id]
              const clip = clipId(f)
              const src = f.style === 'custom' ? clipOf(f.assetId) : undefined
              return (
                <div
                  key={f.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={on}
                  onClick={() => setSelected(on ? null : f.id)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      setSelected(on ? null : f.id)
                    }
                  }}
                  className={cx(
                    'group cursor-pointer rounded-2xl border overflow-hidden surface-card transition-[border-color,box-shadow]',
                    on
                      ? 'border-indigo-400/70 shadow-[0_0_0_1px_rgb(139_92_246/0.45),0_12px_30px_-14px_rgb(139_92_246/0.6)]'
                      : 'border-edge hover:border-edge-strong',
                  )}
                >
                  <div className="relative aspect-video bg-gradient-to-br from-indigo-950 via-[#0d0f18] to-cyan-950/60 border-b border-edge">
                    {clip != null ? (
                      <ClipThumb assetId={clip} />
                    ) : (
                      <div className="absolute inset-0 grid place-items-center">
                        <IconTile name={f.style === 'custom' ? 'clip' : 'wand'} size="lg" />
                      </div>
                    )}
                    <div className="absolute top-2 left-2">
                      {pct != null ? (
                        <Badge tone="accent">Building {pct}%</Badge>
                      ) : clip != null ? (
                        <Badge tone="good" dot>
                          Preview ready
                        </Badge>
                      ) : (
                        <Badge>No preview</Badge>
                      )}
                    </div>
                    {pct != null && <ProgressBar value={pct / 100} className="absolute inset-x-0 bottom-0 h-1 rounded-none" />}
                  </div>
                  <div className="px-3.5 py-3 flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium truncate">
                        {f.name || (f.style === 'custom' ? src?.name ?? 'Custom clip' : styleLabel(f.style))}
                      </div>
                      <div className="text-[12px] text-ink-faint truncate">
                        {styleLabel(f.style)} · {f.durationMode === 'audio' ? 'matches its audio' : `${f.durationSec}s`}
                        {f.audioAssetId != null && ` · ♪ ${audioName(f.audioAssetId) ?? 'audio'}`}
                      </div>
                    </div>
                    <span onClick={(e) => e.stopPropagation()}>
                      <Menu
                        items={[
                          { label: 'Edit', icon: 'edit', onSelect: () => setSelected(f.id) },
                          {
                            label: clip != null && f.style !== 'custom' ? 'Regenerate preview' : 'Generate preview',
                            icon: 'sparkles',
                            disabled: pct != null || f.style === 'custom',
                            onSelect: () => generate(f.id),
                          },
                          'divider',
                          { label: 'Delete filler', icon: 'trash', danger: true, onSelect: () => del(f) },
                        ]}
                      />
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {unused.length > 0 && (
          <div className="mt-6">
            <button
              onClick={() => setShowUnused(!showUnused)}
              className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-faint hover:text-ink-soft"
            >
              <Icon name={showUnused ? 'chevronDown' : 'chevronRight'} size={14} /> Unused clips ({unused.length}) — uploaded,
              but no filler uses them
            </button>
            {showUnused && (
              <div className="mt-2 space-y-1.5">
                {unused.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-xl border border-edge bg-sunken/60 px-3 py-2 text-[13px]">
                    <Icon name="clip" size={15} className="text-ink-faint" />
                    <span className="flex-1 min-w-0 truncate text-ink-muted">{a.name}</span>
                    <span className="text-[12px] text-ink-faint shrink-0">{fmtSize(a.sizeBytes)}</span>
                    <Button variant="subtle" size="sm" icon="trash" onClick={() => delUnused(a.id)}>
                      Delete
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Workspace>
    </>
  )
}
