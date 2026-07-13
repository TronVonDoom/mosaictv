import { useEffect, useState } from 'react'
import { api, type Collection, type Library, type MediaSearchResult } from '../lib/api'
import MediaSearchInput from '../components/MediaSearchInput'

const emptyForm = {
  name: '',
  libraryId: '',
  filterType: '',
  filterSearch: '',
  filterGenre: '',
}

export default function Collections() {
  const [cols, setCols] = useState<Collection[]>([])
  const [libs, setLibs] = useState<Library[]>([])
  const [form, setForm] = useState(emptyForm)
  const [advanced, setAdvanced] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => api.collections().then(setCols).catch(() => {})
  useEffect(() => {
    refresh()
    api.libraries().then(setLibs).catch(() => {})
  }, [])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await api.addCollection({
        name: form.name,
        libraryId: form.libraryId ? Number(form.libraryId) : null,
        filterType: form.filterType || null,
        filterSearch: form.filterSearch || null,
        filterGenre: form.filterGenre || null,
      })
      setForm(emptyForm)
      setAdvanced(false)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create collection')
    }
  }

  async function del(id: number) {
    setError(null)
    try {
      await api.deleteCollection(id)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete collection')
    }
  }

  async function addMember(collectionId: number, r: MediaSearchResult) {
    setError(null)
    try {
      if (r.kind === 'show') {
        await api.addCollectionItem(collectionId, {
          kind: 'show',
          showTitle: r.showTitle,
          libraryId: r.libraryId,
          label: r.showTitle,
        })
      } else {
        await api.addCollectionItem(collectionId, {
          kind: 'movie',
          mediaItemId: r.mediaItemId,
          label: r.title,
        })
      }
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add')
    }
  }

  async function removeMember(collectionId: number, itemId: number) {
    setError(null)
    try {
      await api.deleteCollectionItem(collectionId, itemId)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  const input = 'rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none'

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Collections</h1>
      <p className="text-slate-400 text-sm mb-6">
        Build a set of shows and movies, then program channels from it.
      </p>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm p-3 mb-5">
          {error}
        </div>
      )}

      {/* Create */}
      <form onSubmit={add} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mb-6 space-y-3">
        <div className="flex gap-2 items-end">
          <label className="flex flex-col gap-1 text-sm flex-1">
            <span className="text-slate-400">New collection name</span>
            <input className={input} placeholder="Saturday Morning Cartoons" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <button type="submit" className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-5 py-2 font-medium text-sm">Create</button>
        </div>
        <button type="button" onClick={() => setAdvanced(!advanced)} className="text-xs text-slate-500 hover:text-slate-300">
          {advanced ? '▾' : '▸'} Advanced: smart filter (auto-include matching media)
        </button>
        {advanced && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-1">
            <select className={input} value={form.libraryId} onChange={(e) => setForm({ ...form, libraryId: e.target.value })}>
              <option value="">Any library</option>
              {libs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select className={input} value={form.filterType} onChange={(e) => setForm({ ...form, filterType: e.target.value })}>
              <option value="">Any type</option>
              <option value="episode">Episodes</option>
              <option value="movie">Movies</option>
              <option value="other">Other</option>
            </select>
            <input className={input} placeholder="Title contains" value={form.filterSearch} onChange={(e) => setForm({ ...form, filterSearch: e.target.value })} />
            <input className={input} placeholder="Genre contains" value={form.filterGenre} onChange={(e) => setForm({ ...form, filterGenre: e.target.value })} />
          </div>
        )}
      </form>

      {/* List */}
      {cols.length === 0 ? (
        <div className="text-slate-500 text-sm">No collections yet.</div>
      ) : (
        <div className="space-y-4">
          {cols.map((c) => {
            const filterSummary = [
              c.libraryId ? libs.find((l) => l.id === c.libraryId)?.name : null,
              c.filterType,
              c.filterSearch && `"${c.filterSearch}"`,
              c.filterGenre && `genre: ${c.filterGenre}`,
            ]
              .filter(Boolean)
              .join(' · ')
            return (
              <div key={c.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="font-medium flex-1">{c.name}</div>
                  <span className="text-sm text-slate-400">{c.itemCount} items</span>
                  <button onClick={() => del(c.id)} className="rounded-lg border border-slate-800 text-slate-500 hover:border-rose-500/50 hover:text-rose-400 px-3 py-1.5 text-sm">Delete</button>
                </div>

                {filterSummary && (
                  <div className="text-xs text-violet-300/80 mb-3">smart filter: {filterSummary}</div>
                )}

                <div className="flex flex-wrap gap-2 mb-3">
                  {c.items.length === 0 && !filterSummary && (
                    <span className="text-slate-600 text-sm">No shows or movies yet — add some below.</span>
                  )}
                  {c.items.map((it) => (
                    <span key={it.id} className="inline-flex items-center gap-2 rounded-lg bg-slate-950/70 border border-slate-800 pl-2.5 pr-1.5 py-1 text-sm">
                      <span>{it.kind === 'show' ? '📺' : '🎬'}</span>
                      <span className="truncate max-w-48">{it.label ?? it.showTitle}</span>
                      <button onClick={() => removeMember(c.id, it.id)} className="text-slate-600 hover:text-rose-400" aria-label="Remove">×</button>
                    </span>
                  ))}
                </div>

                <div className="max-w-md">
                  <MediaSearchInput onAdd={(r) => addMember(c.id, r)} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
