import { useCallback, useEffect, useRef, useState } from 'react'
import { api, assetFileUrl, type Asset, type Channel, type Filler, type FillerInput } from '../lib/api'
import { toast } from '../lib/toast'
import { errorMessage } from '../lib/errors'
import FillerEditor, { fillerStyleLabel as styleLabel } from './FillerEditor'
import { Banner, Select } from './ui'

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
    if (!confirm(msg)) return
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
    <div className="rounded-lg border border-edge bg-canvas/40 p-3">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <span className="text-sm font-medium">Filler library</span>
        <div className="flex items-center gap-2 shrink-0">
          {channels.length > 0 && (
            <label className="flex items-center gap-1.5 text-[11px] text-ink-faint">
              Preview as
              <Select
                className="px-2 py-0.5 text-xs"
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
          <button
            onClick={() => uploadRef.current?.click()}
            disabled={uploading}
            className="text-xs rounded border border-edge-strong hover:border-indigo-500 hover:text-indigo-300 disabled:opacity-50 px-2 py-0.5"
            title="Upload your own bumper or ident — it becomes a filler you can assign straight away"
          >
            {uploading ? 'Uploading…' : '⤒ Upload clip'}
          </button>
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
          {!open && <button onClick={startNew} className="text-xs rounded border border-edge-strong hover:border-indigo-500 hover:text-indigo-300 px-2 py-0.5">+ Add filler</button>}
        </div>
      </div>
      {genError && <Banner tone="error" className="mb-2 text-xs">{genError}</Banner>}

      {fillers.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {fillers.map((f) => {
            const pct = jobs[f.id]
            const generating = pct != null
            const src = f.style === 'custom' ? clipOf(f.assetId) : undefined
            return (
              <div key={f.id}>
                <div className="flex items-center gap-2 text-sm rounded bg-surface/60 border border-edge px-2.5 py-1.5">
                  <span className="flex-1 min-w-0 truncate">
                    {f.name || (f.style === 'custom' ? src?.name ?? 'Custom clip' : styleLabel(f.style))}
                  </span>
                  <span className="text-[11px] text-ink-faint shrink-0">
                    {styleLabel(f.style)} · {f.durationMode === 'audio' ? 'match audio' : `${f.durationSec}s`}
                    {src && ` · ${fmtSize(src.sizeBytes)}`}
                    {f.audioAssetId != null && ` · ♪ ${audioName(f.audioAssetId) ?? 'audio'}`}
                  </span>
                  {generating ? (
                    <span className="text-xs text-indigo-300 shrink-0 tabular-nums">Building…</span>
                  ) : f.generatedAssetId != null ? (
                    <>
                      <button onClick={() => setPreviewId(previewId === f.id ? null : f.id)} className="text-xs text-ink-muted hover:text-indigo-300">{previewId === f.id ? 'Hide' : 'Preview'}</button>
                      <button onClick={() => generate(f.id)} className="text-xs text-ink-muted hover:text-indigo-300" title="Rebuild — e.g. for a different channel's logo">Regenerate</button>
                    </>
                  ) : f.style === 'custom' && src ? (
                    <button onClick={() => setPreviewId(previewId === f.id ? null : f.id)} className="text-xs text-ink-muted hover:text-indigo-300">{previewId === f.id ? 'Hide' : 'Preview'}</button>
                  ) : (
                    <button
                      onClick={() => generate(f.id)}
                      className="text-xs text-indigo-300 hover:text-indigo-200"
                      title="Build a clip to watch here. Optional — this filler already plays on air whether or not you generate a preview."
                    >
                      Generate preview
                    </button>
                  )}
                  <button onClick={() => startEdit(f)} className="text-xs text-ink-muted hover:text-indigo-300">Edit</button>
                  <button onClick={() => del(f)} className="text-ink-faint hover:text-rose-400" aria-label="Delete">×</button>
                </div>

                {generating && (
                  <div className="mt-1.5 px-1">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-raised overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-[width] duration-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-indigo-300 tabular-nums w-9 text-right">{pct}%</span>
                    </div>
                    <p className="text-[11px] text-ink-faint mt-1">
                      Building the clip{pct === 0 ? ' (starting…)' : ''} — this runs on the server, so you can leave
                      this page and come back.
                    </p>
                  </div>
                )}

                {previewId === f.id && (f.generatedAssetId ?? src?.id) != null && (
                  <div className="mt-1.5 rounded border border-edge bg-black p-2">
                    <video key={f.generatedAssetId ?? src?.id} controls src={assetFileUrl((f.generatedAssetId ?? src?.id) as number)} className="w-full max-h-64 rounded" />
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
        <p className="text-xs text-ink-faint">
          No fillers yet. <span className="text-ink-muted">Upload clip</span> to use your own bumper, or
          <span className="text-ink-muted"> + Add filler</span> to have one generated from a channel's logo. Assign
          them to channels or blocks from a channel's Fillers tab.
        </p>
      )}

      {unused.length > 0 && (
        <div className="mt-3 border-t border-edge pt-2">
          <button onClick={() => setShowUnused(!showUnused)} className="text-[11px] text-ink-faint hover:text-ink-soft">
            {showUnused ? '▾' : '▸'} Unused clips ({unused.length}) — uploaded but no filler uses them
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
