import { useEffect, useState } from 'react'
import Icon from './Icon'
import { api, type Collection, type Library, type MediaItem, type MediaSearchResult } from '../lib/api'
import { PLAYBACK_ORDERS, orderLabel } from '../lib/playback'
import { programLabel } from '../lib/format'
import MediaSearchInput from './MediaSearchInput'
import LogoPicker from './LogoPicker'
import { toast } from '../lib/toast'
import { errorMessage } from '../lib/errors'
import { Banner, Card, Input, Select } from './ui'


// Create/edit the collections that belong to one channel (the "branded units":
// Nick Jr., Snick, …). Notifies the parent on any change so rotation/block
// dropdowns can refresh.
export default function CollectionManager({
  channelId,
  onChange,
}: {
  channelId: number
  onChange?: () => void
}) {
  const [cols, setCols] = useState<Collection[]>([])
  const [libs, setLibs] = useState<Library[]>([])
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [newLogoId, setNewLogoId] = useState<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [editId, setEditId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState({ name: '', logoId: null as number | null, defaultOrder: 'chronological', libraryId: '', filterType: '', filterSearch: '', filterGenre: '' })
  // Which collection's "what will this air?" panel is open, and its contents.
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ count: number; order: string; sample: MediaItem[] } | null>(null)

  const refresh = () =>
    api.collections(channelId).then((c) => {
      setCols(c)
      onChange?.()
      // Keep an open preview honest after a drag, an add, or a removal.
      if (previewId != null) api.collectionPreview(previewId).then(setPreview).catch(() => {})
    }).catch(() => {})
  useEffect(() => {
    refresh()
    api.libraries().then(setLibs).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])

  async function guard<T>(fn: () => Promise<T>) {
    setError(null)
    try {
      await fn()
      refresh()
    } catch (err) {
      setError(errorMessage(err, 'Something went wrong'))
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    await guard(async () => {
      await api.addCollection({ name: name.trim(), channelId, logoId: newLogoId })
      setName('')
      setNewLogoId(null)
    })
  }

  function startEdit(c: Collection) {
    setEditId(c.id)
    setEditForm({
      name: c.name,
      logoId: c.logoId,
      defaultOrder: c.defaultOrder,
      libraryId: c.libraryId ? String(c.libraryId) : '',
      filterType: c.filterType ?? '',
      filterSearch: c.filterSearch ?? '',
      filterGenre: c.filterGenre ?? '',
    })
  }
  async function saveEdit() {
    if (editId == null) return
    await guard(async () => {
      await api.updateCollection(editId, {
        name: editForm.name,
        logoId: editForm.logoId,
        defaultOrder: editForm.defaultOrder,
        libraryId: editForm.libraryId ? Number(editForm.libraryId) : null,
        filterType: editForm.filterType || null,
        filterSearch: editForm.filterSearch || null,
        filterGenre: editForm.filterGenre || null,
      })
      setEditId(null)
      toast.success('Collection saved')
    })
  }

  // What this collection actually airs, in its own default order — the answer
  // to "did my hand-picked arrangement come out the way I meant?".
  function showPreview(id: number) {
    if (previewId === id) {
      setPreviewId(null)
      return
    }
    setPreviewId(id)
    setPreview(null)
    api.collectionPreview(id).then(setPreview).catch(() => setPreview(null))
  }

  // Drop `fromId` onto `toId`'s slot. The member order is what the "hand-picked
  // order" playback mode airs, so persist it; the local swap is just so the
  // chips don't jump while the request is in flight.
  function moveMember(col: Collection, fromId: number, toId: number) {
    if (fromId === toId) return
    const ids = col.items.map((i) => i.id)
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ...ids.splice(from, 1))

    const byId = new Map(col.items.map((i) => [i.id, i]))
    setCols((cs) =>
      cs.map((c) => (c.id === col.id ? { ...c, items: ids.map((id) => byId.get(id)!) } : c)),
    )
    guard(() => api.reorderCollectionItems(col.id, ids))
  }

  async function addMember(collectionId: number, r: MediaSearchResult) {
    await guard(() => {
      switch (r.kind) {
        case 'show':
          return api.addCollectionItem(collectionId, { kind: 'show', showTitle: r.showTitle, libraryId: r.libraryId, label: r.showTitle })
        case 'season':
          return api.addCollectionItem(collectionId, { kind: 'season', showTitle: r.showTitle, libraryId: r.libraryId, season: r.season, label: `${r.showTitle} — Season ${r.season}` })
        case 'episode':
          return api.addCollectionItem(collectionId, { kind: 'episode', mediaItemId: r.mediaItemId, label: programLabel(r) })
        case 'movie':
          return api.addCollectionItem(collectionId, { kind: 'movie', mediaItemId: r.mediaItemId, label: r.title })
      }
    })
  }

  return (
    <Card className="p-5 mb-6">
      <h2 className="font-semibold mb-1">Collections</h2>
      <p className="text-ink-faint text-xs mb-4">
        This channel's programming units — e.g. “Nick Jr.”, “Snick”. Each has its own shows/movies and logo, and
        is used by the rotation and time blocks below.
      </p>

      {error && <Banner className="mb-4">{error}</Banner>}

      {/* Create */}
      <form onSubmit={add} className="flex flex-wrap gap-2 items-end border border-edge rounded-lg p-3 mb-4 bg-canvas/40">
        <label className="flex flex-col gap-1 text-sm flex-1 min-w-40">
          <span className="text-ink-muted">New collection</span>
          <Input placeholder="Nick Jr." value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-muted">Logo (optional)</span>
          <LogoPicker value={newLogoId} onChange={setNewLogoId} />
        </label>
        <button type="submit" className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-4 py-2 text-sm font-medium">Create</button>
      </form>

      {cols.length === 0 ? (
        <div className="text-ink-faint text-sm">No collections yet — create one above.</div>
      ) : (
        <div className="space-y-3">
          {cols.map((c) => {
            const filterSummary = [
              c.libraryId ? libs.find((l) => l.id === c.libraryId)?.name : null,
              c.filterType,
              c.filterSearch && `"${c.filterSearch}"`,
              c.filterGenre && `genre: ${c.filterGenre}`,
            ].filter(Boolean).join(' · ')
            return (
              <div key={c.id} className="rounded-xl border border-edge bg-canvas/50 p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="font-medium flex-1">{c.name}</div>
                  <span className="text-xs text-ink-faint">{c.itemCount} items · {orderLabel(c.defaultOrder)}</span>
                  <button onClick={() => showPreview(c.id)} className="rounded-lg border border-edge-strong hover:border-indigo-500 hover:text-indigo-300 px-3 py-1 text-sm">
                    {previewId === c.id ? 'Hide' : 'Preview'}
                  </button>
                  <button onClick={() => (editId === c.id ? setEditId(null) : startEdit(c))} className="rounded-lg border border-edge-strong hover:border-indigo-500 hover:text-indigo-300 px-3 py-1 text-sm">
                    {editId === c.id ? 'Close' : 'Edit'}
                  </button>
                  <button onClick={() => guard(() => api.deleteCollection(c.id))} className="rounded-lg border border-edge text-ink-faint hover:border-rose-500/50 hover:text-rose-400 px-3 py-1 text-sm">Delete</button>
                </div>

                {editId === c.id && (
                  <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 mb-3 space-y-2">
                    <div className="grid md:grid-cols-2 gap-2">
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-ink-muted">Name</span>
                        <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-ink-muted">Logo</span>
                        <LogoPicker value={editForm.logoId} onChange={(id) => setEditForm({ ...editForm, logoId: id })} />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-ink-muted">Plays in this order</span>
                        <Select value={editForm.defaultOrder} onChange={(e) => setEditForm({ ...editForm, defaultOrder: e.target.value })}>
                          {PLAYBACK_ORDERS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </Select>
                        <span className="text-[11px] text-ink-faint">
                          Used everywhere this collection is scheduled, unless a rotation item or block overrides it.
                        </span>
                      </label>
                    </div>
                    <details className="text-sm">
                      <summary className="text-xs text-ink-faint cursor-pointer">Advanced: smart filter (auto-include matching media)</summary>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                        <Select value={editForm.libraryId} onChange={(e) => setEditForm({ ...editForm, libraryId: e.target.value })}>
                          <option value="">Any library</option>
                          {libs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </Select>
                        <Select value={editForm.filterType} onChange={(e) => setEditForm({ ...editForm, filterType: e.target.value })}>
                          <option value="">Any type</option>
                          <option value="episode">Episodes</option>
                          <option value="movie">Movies</option>
                          <option value="other">Other</option>
                        </Select>
                        <Input placeholder="Title contains" value={editForm.filterSearch} onChange={(e) => setEditForm({ ...editForm, filterSearch: e.target.value })} />
                        <Input placeholder="Genre contains" value={editForm.filterGenre} onChange={(e) => setEditForm({ ...editForm, filterGenre: e.target.value })} />
                      </div>
                    </details>
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setEditId(null)} className="rounded-lg border border-edge-strong hover:border-ink-faint px-3 py-1.5 text-sm">Cancel</button>
                      <button onClick={saveEdit} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-4 py-1.5 text-sm font-medium">Save</button>
                    </div>
                  </div>
                )}

                {previewId === c.id && (
                  <div className="rounded-lg border border-edge bg-canvas/60 p-3 mb-3 text-sm">
                    {!preview ? (
                      <span className="text-ink-faint">Loading…</span>
                    ) : preview.count === 0 ? (
                      <span className="text-ink-faint">
                        Nothing playable here yet — add members, or check the files still exist.
                      </span>
                    ) : (
                      <>
                        <div className="text-xs text-ink-faint mb-2">
                          First {preview.sample.length} of {preview.count}, {orderLabel(preview.order)}
                        </div>
                        <ol className="space-y-0.5">
                          {preview.sample.map((m, i) => (
                            <li key={m.id} className="flex gap-2">
                              <span className="text-ink-ghost tabular-nums w-5 text-right">{i + 1}</span>
                              <span className="truncate">{programLabel(m, { withTitle: true })}</span>
                            </li>
                          ))}
                        </ol>
                      </>
                    )}
                  </div>
                )}

                {filterSummary && <div className="text-xs text-violet-300/80 mb-2">smart filter: {filterSummary}</div>}

                <div className="flex flex-wrap gap-2 mb-3">
                  {c.items.length === 0 && !filterSummary && <span className="text-ink-faint text-sm">No shows or movies yet — add some below.</span>}
                  {c.items.map((it, i) => (
                    <span
                      key={it.id}
                      draggable
                      onDragStart={() => setDragId(it.id)}
                      onDragEnd={() => setDragId(null)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        if (dragId != null) moveMember(c, dragId, it.id)
                        setDragId(null)
                      }}
                      title="Drag to reorder"
                      className={
                        'inline-flex items-center gap-2 rounded-lg bg-surface/70 border pl-2 pr-1.5 py-1 text-sm cursor-grab active:cursor-grabbing ' +
                        (dragId === it.id ? 'border-indigo-500 opacity-50' : 'border-edge')
                      }
                    >
                      <span className="text-[10px] tabular-nums text-ink-faint w-4 text-right">{i + 1}</span>
                      <Icon name={it.kind === 'show' ? 'show' : 'movie'} size={15} colored />
                      <span className="truncate max-w-48">{it.label ?? it.showTitle}</span>
                      <button onClick={() => guard(() => api.deleteCollectionItem(c.id, it.id))} className="text-ink-faint hover:text-rose-400" aria-label="Remove">×</button>
                    </span>
                  ))}
                </div>
                {c.items.length > 1 && (
                  <div className="text-[11px] text-ink-faint mb-3">
                    Drag to reorder — this is the sequence the “hand-picked order” playback mode airs.
                  </div>
                )}
                <div className="max-w-md">
                  <MediaSearchInput onAdd={(r) => addMember(c.id, r)} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
