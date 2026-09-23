import { useCallback, useEffect, useRef, useState } from 'react'
import { api, assetFileUrl, type Asset, type Channel, type Filler, type FillerInput } from '../lib/api'
import { toast } from '../lib/toast'
import { errorMessage } from '../lib/errors'
import FillerEditor, { fillerStyleLabel as styleLabel } from './FillerEditor'
import { Badge, Banner, Button, EmptyState, IconTile, Menu, ProgressBar, Select } from './ui'
import Icon from './Icon'
import { confirmDialog } from '../lib/confirm'

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

/**
 * The whole filler surface: the shared library of what plays, plus the clip
 * uploads that back a "custom" filler.
 *
 * Uploads used to live on their own tab, which made them a dead end — a clip
 * of kind "filler" is only ever read through Filler.assetId, so it did nothing
 * until you switched tabs and wrapped it. Uploading here creates the filler in
 * the same step; the leftover uploads that nothing points at are tucked into a
 * disclosure at the bottom so they can still be cleaned up.
 */
export default function FillerManager() {
  const [fillers, setFillers] = useState<Filler[]>([])
  const [fillerAssets, setFillerAssets] = useState<Asset[]>([])
  const [audioAssets, setAudioAssets] = useState<Asset[]>([])
  const [draft, setDraft] = useState<FillerInput | undefined>(undefined)
  const [editId, setEditId] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [previewId, setPreviewId] = useState<number | null>(null)
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

  const refresh = () => api.fillers().then(setFillers).catch(() => {})
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
      // Only pop the preview open for a build this page was watching — not for
      // one that finished ten minutes ago in another tab.
      else if (watched.current.has(j.fillerId)) setPreviewId(j.fillerId)
    }
    for (const id of starting.current) if (!(id in active)) active[id] = 0
    setJobs(active)
    if (finished) {
      refresh()
      refreshAssets()
    }
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

  function startNew() {
    setEditId(null)
    setDraft(undefined)
    setOpen(true)
  }
  function startEdit(f: Filler) {
    setEditId(f.id)
    setDraft({ name: f.name, style: f.style, assetId: f.assetId, audioAssetId: f.audioAssetId, logoId: f.logoId, durationMode: f.durationMode, durationSec: f.durationSec, resolution: f.resolution, logoScale: f.logoScale })
    setOpen(true)
  }
  function closeEditor() {
    setOpen(false)
    setEditId(null)
    setDraft(undefined)
  }
  function saved() {
    closeEditor()
    refresh()
    refreshAssets()
    toast.success('Filler saved')
  }

  // Upload + wrap in one action: the clip is only ever useful as a filler.
  async function uploadClip(file: File) {
    const name = file.name.replace(/\.[^.]+$/, '')
    setUploading(true)
    try {
      const asset = await api.uploadAsset('filler', name, file)
      await api.addFiller({ name, style: 'custom', assetId: asset.id, audioAssetId: null, durationMode: 'fixed', durationSec: 30, resolution: '1080p', logoScale: 1 })
      toast.success(`Added ${name}`)
      refresh()
      refreshAssets()
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
    const shared = src != null && fillers.some((o) => o.id !== f.id && o.assetId === src.id)
    const msg = src && !shared
      ? `Delete "${f.name || src.name}" and its uploaded clip? It's removed from every channel and block using it.`
      : `Delete "${f.name || styleLabel(f.style)}"? It's removed from every channel and block using it.`
    if (!(await confirmDialog({ title: 'Delete this filler?', message: msg, confirmLabel: 'Delete filler', danger: true }))) return
    await api.deleteFiller(f.id).catch(() => {})
    if (previewId === f.id) setPreviewId(null)
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
  // Uploads nothing points at — normally empty, but a failed wrap or an older
  // install can leave some, and they'd be unreachable without this.
  const unused = fillerAssets.filter((a) => !a.generated && !fillers.some((f) => f.assetId === a.id))

  return (
    <div className="rounded-2xl border border-edge surface-card p-5">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-[15px] tracking-tight">
            Filler library
            {fillers.length > 0 && <span className="ml-2 text-[13px] font-normal text-ink-faint tabular-nums">{fillers.length}</span>}
          </h2>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {channels.length > 0 && (
            <label className="flex items-center gap-2 text-[12.5px] text-ink-faint">
              Preview as
              <Select
                className="h-8 text-[13px]"
                value={previewChannelId ?? ''}
                onChange={(e) => setPreviewChannelId(e.target.value ? Number(e.target.value) : null)}
                title="Generated fillers are branded with a channel's logo — pick which one to build the preview for"
              >
                <option value="">where it's assigned</option>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>{c.number != null ? `${c.number} · ` : ''}{c.name}</option>
                ))}
              </Select>
            </label>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon="upload"
            loading={uploading}
            onClick={() => uploadRef.current?.click()}
            title="Upload your own bumper or ident — it becomes a filler you can assign straight away"
          >
            Upload clip
          </Button>
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
          {!open && (
            <Button size="sm" icon="plus" onClick={startNew}>
              Add filler
            </Button>
          )}
        </div>
      </div>
      {genError && <Banner tone="error" className="mb-3">{genError}</Banner>}

      {fillers.length > 0 && (
        <div className="space-y-2 mb-3">
          {fillers.map((f) => {
            const pct = jobs[f.id]
            const generating = pct != null
            const src = f.style === 'custom' ? clipOf(f.assetId) : undefined
            return (
              <div key={f.id}>
                <div className="flex items-center gap-3 rounded-xl bg-sunken/60 border border-edge px-3 py-2.5 hover:border-edge-strong transition-colors">
                  <IconTile name={f.style === 'custom' ? 'clip' : 'wand'} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium truncate">
                      {f.name || (f.style === 'custom' ? src?.name ?? 'Custom clip' : styleLabel(f.style))}
                    </div>
                    <div className="text-[12px] text-ink-faint truncate">
                      {styleLabel(f.style)} · {f.durationMode === 'audio' ? 'matches its audio' : `${f.durationSec}s`}
                      {src && ` · ${fmtSize(src.sizeBytes)}`}
                      {f.audioAssetId != null && ` · ♪ ${audioName(f.audioAssetId) ?? 'audio'}`}
                    </div>
                  </div>
                  {generating ? (
                    <Badge tone="accent">Building {pct}%</Badge>
                  ) : f.generatedAssetId != null || (f.style === 'custom' && src) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="play"
                      onClick={() => setPreviewId(previewId === f.id ? null : f.id)}
                    >
                      {previewId === f.id ? 'Hide' : 'Preview'}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="sparkles"
                      onClick={() => generate(f.id)}
                      title="Build a clip to watch here. Optional — this filler already plays on air whether or not you generate a preview."
                    >
                      Generate preview
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" icon="edit" onClick={() => startEdit(f)}>
                    Edit
                  </Button>
                  <Menu
                    items={[
                      ...(f.generatedAssetId != null && !generating
                        ? [
                            {
                              label: 'Regenerate clip',
                              icon: 'refresh' as const,
                              hint: 'new logo',
                              onSelect: () => generate(f.id),
                            },
                            'divider' as const,
                          ]
                        : []),
                      { label: 'Delete filler', icon: 'trash' as const, danger: true, onSelect: () => del(f) },
                    ]}
                  />
                </div>

                {generating && (
                  <div className="mt-1.5 px-1">
                    <ProgressBar value={pct / 100} className="h-1.5" />
                    <p className="text-[11px] text-ink-faint mt-1">
                      Building the clip{pct === 0 ? ' (starting…)' : ''} — this runs on the server, so you can leave
                      this page and come back.
                    </p>
                  </div>
                )}

                {previewId === f.id && (f.generatedAssetId ?? src?.id) != null && (
                  <div className="mt-2 rounded-xl border border-edge bg-black p-2">
                    <video key={f.generatedAssetId ?? src?.id} controls src={assetFileUrl((f.generatedAssetId ?? src?.id) as number)} className="w-full max-h-72 rounded-lg" />
                    <p className="text-[11px] text-ink-faint mt-1">
                      {f.style === 'custom'
                        ? 'Your uploaded clip, with the chosen audio mixed over it at playback.'
                        : `Built for ${previewChannelName ?? "the channel it's assigned to"} — the same filler is rebuilt with each channel's own logo when it airs. Saved on the Studio page as a generated filler asset.`}
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {open && (
        <FillerEditor
          key={editId ?? 'new'}
          editId={editId}
          initial={draft}
          previewOwner={previewChannelId != null ? { channelId: previewChannelId } : undefined}
          onCancel={closeEditor}
          onSaved={saved}
        />
      )}

      {fillers.length === 0 && !open && (
        <EmptyState
          icon="clip"
          title="No fillers yet"
          description="Upload your own bumper, or add a filler to have one generated from a channel's logo. Assign them to channels or blocks from a channel's Fillers tab."
        />
      )}

      {unused.length > 0 && (
        <div className="mt-3 border-t border-edge pt-2">
          <button onClick={() => setShowUnused(!showUnused)} className="inline-flex items-center gap-1.5 text-[12px] text-ink-faint hover:text-ink-soft">
            <Icon name={showUnused ? 'chevronDown' : 'chevronRight'} size={14} /> Unused clips ({unused.length}) — uploaded but no filler uses them
          </button>
          {showUnused && (
            <div className="space-y-1 mt-1.5">
              {unused.map((a) => (
                <div key={a.id} className="flex items-center gap-2 text-xs rounded bg-surface/40 border border-edge px-2.5 py-1.5">
                  <span className="flex-1 min-w-0 truncate text-ink-muted">{a.name}</span>
                  <span className="text-[11px] text-ink-faint shrink-0">{fmtSize(a.sizeBytes)}</span>
                  <button onClick={() => delUnused(a.id)} className="text-ink-faint hover:text-rose-400" aria-label="Delete">×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
