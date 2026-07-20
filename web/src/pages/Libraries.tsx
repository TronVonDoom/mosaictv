import { useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon'
import { Link } from 'react-router-dom'
import {
  api,
  type Library,
  type LibraryKind,
  type MetadataStatus,
  type ScanStatus,
} from '../lib/api'
import DirectoryPicker from '../components/DirectoryPicker'

const KIND_LABELS: Record<LibraryKind, string> = {
  tv: 'TV Shows',
  movie: 'Movies',
  music: 'Music Videos',
  other: 'Other / Bumpers',
}

// Where a picked folder path should go.
type PickerTarget =
  | { mode: 'new'; index: number }
  | { mode: 'add'; libraryId: number }

function ScanProgress({ status }: { status: ScanStatus }) {
  const pct = status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0
  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 mb-5">
      <div className="flex justify-between text-sm mb-2">
        <span className="font-medium text-indigo-300">Scanning {status.libraryName}…</span>
        <span className="text-slate-400">
          {status.processed} / {status.total} ({pct}%)
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex gap-4 text-xs text-slate-400 mt-2">
        <span className="text-emerald-400">+{status.added} new</span>
        <span className="text-sky-400">{status.updated} updated</span>
        <span>{status.skipped} unchanged</span>
        {status.removed > 0 && <span className="text-amber-400">{status.removed} missing</span>}
      </div>
      {status.currentPath && (
        <div className="text-xs text-slate-600 mt-1 truncate">{status.currentPath}</div>
      )}
    </div>
  )
}

function MetadataProgress({ status }: { status: MetadataStatus }) {
  const pct = status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0
  return (
    <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 mb-5">
      <div className="flex justify-between text-sm mb-2">
        <span className="font-medium text-violet-300">
          Fetching TMDB metadata for {status.libraryName}…
        </span>
        <span className="text-slate-400">
          {status.processed} / {status.total} ({pct}%)
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full bg-violet-500 transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <div className="flex gap-4 text-xs text-slate-400 mt-2">
        <span className="text-emerald-400">{status.matched} matched</span>
        {status.unmatched > 0 && <span className="text-amber-400">{status.unmatched} no match</span>}
      </div>
      {status.currentTitle && (
        <div className="text-xs text-slate-600 mt-1 truncate">{status.currentTitle}</div>
      )}
    </div>
  )
}

export default function Libraries() {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [scan, setScan] = useState<ScanStatus | null>(null)
  const [meta, setMeta] = useState<MetadataStatus | null>(null)
  const [tmdbConfigured, setTmdbConfigured] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<{ name: string; kind: LibraryKind; folders: string[] }>({
    name: '',
    kind: 'tv',
    folders: [''],
  })
  const [submitting, setSubmitting] = useState(false)
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const pollRef = useRef<number | null>(null)
  const metaPollRef = useRef<number | null>(null)

  const refresh = () => api.libraries().then(setLibraries).catch(() => {})

  useEffect(() => {
    refresh()
    api.settings().then((s) => setTmdbConfigured(s.tmdbConfigured)).catch(() => {})
    api.scanStatus().then((s) => {
      setScan(s)
      if (s.running) startPolling()
    })
    api.metadataStatus().then((m) => {
      setMeta(m)
      if (m.running) startMetaPolling()
    })
    return () => {
      stopPolling()
      stopMetaPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startPolling() {
    if (pollRef.current != null) return
    pollRef.current = window.setInterval(async () => {
      const s = await api.scanStatus()
      setScan(s)
      if (!s.running) {
        stopPolling()
        refresh()
      }
    }, 1000)
  }
  function stopPolling() {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }
  function startMetaPolling() {
    if (metaPollRef.current != null) return
    metaPollRef.current = window.setInterval(async () => {
      const m = await api.metadataStatus()
      setMeta(m)
      if (!m.running) {
        stopMetaPolling()
        refresh()
      }
    }, 1000)
  }
  function stopMetaPolling() {
    if (metaPollRef.current != null) {
      window.clearInterval(metaPollRef.current)
      metaPollRef.current = null
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const folders = form.folders.map((f) => f.trim()).filter(Boolean)
    if (folders.length === 0) {
      setError('Add at least one folder.')
      return
    }
    setSubmitting(true)
    try {
      await api.addLibrary({ name: form.name, kind: form.kind, folders })
      setForm({ name: '', kind: 'tv', folders: [''] })
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add library')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleScan(id: number, force = false) {
    setError(null)
    try {
      await api.startScan(id, force)
      startPolling()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scan')
    }
  }

  async function handleFetchMetadata(id: number) {
    setError(null)
    try {
      await api.startMetadata(id)
      startMetaPolling()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start metadata fetch')
    }
  }

  async function handleDelete(id: number) {
    setError(null)
    try {
      await api.deleteLibrary(id)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete library')
    }
  }

  async function handleRemoveFolder(libraryId: number, folderId: number) {
    setError(null)
    try {
      await api.removeFolder(libraryId, folderId)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove folder')
    }
  }

  async function onPick(path: string) {
    const target = picker
    setPicker(null)
    if (!target) return
    if (target.mode === 'new') {
      const folders = [...form.folders]
      folders[target.index] = path
      setForm({ ...form, folders })
    } else {
      try {
        await api.addFolder(target.libraryId, path)
        refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add folder')
      }
    }
  }

  const scanning = scan?.running ?? false
  const enriching = meta?.running ?? false
  const busy = scanning || enriching

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Libraries</h1>
      <p className="text-slate-400 text-sm mb-6">
        A library can span multiple folders under your mounted{' '}
        <code className="text-slate-500">/media</code> volume.
      </p>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm p-3 mb-5">
          {error}
        </div>
      )}

      {!tmdbConfigured && (
        <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 text-slate-300 text-sm p-3 mb-5">
          Add a TMDB API key in{' '}
          <Link to="/settings" className="text-violet-300 hover:text-violet-200 font-medium">
            Settings
          </Link>{' '}
          to fetch posters, overviews, and ratings for movies & shows.
        </div>
      )}

      {scan?.running && <ScanProgress status={scan} />}
      {meta?.running && <MetadataProgress status={meta} />}

      {/* Add-library form */}
      <form
        onSubmit={handleAdd}
        className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mb-6 space-y-3"
      >
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Name</span>
            <input
              className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 focus:border-indigo-500 outline-none"
              placeholder="Movies"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-slate-400">Type</span>
            <select
              className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 focus:border-indigo-500 outline-none"
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as LibraryKind })}
            >
              <option value="tv">TV Shows</option>
              <option value="movie">Movies</option>
              <option value="music">Music Videos</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>

        <div className="space-y-2">
          <span className="text-slate-400 text-sm">Folders</span>
          {form.folders.map((folder, i) => (
            <div key={i} className="flex gap-2">
              <input
                className="flex-1 min-w-0 rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm focus:border-indigo-500 outline-none"
                placeholder="/media/plex_media/movies"
                value={folder}
                onChange={(e) => {
                  const folders = [...form.folders]
                  folders[i] = e.target.value
                  setForm({ ...form, folders })
                }}
              />
              <button
                type="button"
                onClick={() => setPicker({ mode: 'new', index: i })}
                className="rounded-lg border border-slate-700 px-3 text-sm text-slate-300 hover:border-indigo-500 hover:text-indigo-300 shrink-0 transition-colors"
              >
                Browse…
              </button>
              {form.folders.length > 1 && (
                <button
                  type="button"
                  onClick={() =>
                    setForm({ ...form, folders: form.folders.filter((_, j) => j !== i) })
                  }
                  className="rounded-lg border border-slate-800 text-slate-500 hover:text-rose-400 hover:border-rose-500/50 px-3 shrink-0"
                  aria-label="Remove folder"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setForm({ ...form, folders: [...form.folders, ''] })}
            className="text-sm text-indigo-300 hover:text-indigo-200"
          >
            + Add another folder
          </button>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 px-5 py-2 font-medium transition-colors"
          >
            Add library
          </button>
        </div>
      </form>

      {/* Library list */}
      {libraries.length === 0 ? (
        <div className="text-slate-500 text-sm">No libraries yet.</div>
      ) : (
        <div className="space-y-3">
          {libraries.map((lib) => (
            <div key={lib.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{lib.name}</span>
                    <span className="text-xs rounded-full bg-slate-800 text-slate-400 px-2 py-0.5">
                      {KIND_LABELS[lib.kind]}
                    </span>
                    <span className="text-xs text-slate-500">{lib.itemCount} items</span>
                  </div>
                </div>
                <button
                  onClick={() => handleScan(lib.id)}
                  disabled={busy}
                  className="rounded-lg border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 disabled:opacity-40 px-3 py-1.5 text-sm transition-colors"
                >
                  {scanning ? 'Scanning…' : 'Scan'}
                </button>
                <button
                  onClick={() => handleScan(lib.id, true)}
                  disabled={busy}
                  title="Re-probe every file, ignoring the unchanged-file skip"
                  className="rounded-lg border border-slate-800 text-slate-500 hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-40 px-3 py-1.5 text-sm transition-colors"
                >
                  Force
                </button>
                {lib.kind !== 'other' && (
                  <button
                    onClick={() => handleFetchMetadata(lib.id)}
                    disabled={busy || !tmdbConfigured}
                    title={
                      tmdbConfigured
                        ? 'Fetch posters, overviews & ratings from TMDB'
                        : 'Set a TMDB API key in Settings first'
                    }
                    className="rounded-lg border border-slate-700 hover:border-violet-500 hover:text-violet-300 disabled:opacity-40 px-3 py-1.5 text-sm transition-colors"
                  >
                    {enriching ? 'Fetching…' : 'Metadata'}
                  </button>
                )}
                <button
                  onClick={() => handleDelete(lib.id)}
                  disabled={busy}
                  className="rounded-lg border border-slate-800 text-slate-500 hover:border-rose-500/50 hover:text-rose-400 disabled:opacity-40 px-3 py-1.5 text-sm transition-colors"
                >
                  Delete
                </button>
              </div>

              {/* Folders */}
              <div className="mt-3 pt-3 border-t border-slate-800/60 space-y-1.5">
                {lib.folders.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-xs">
                    <Icon name="folder" size={13} className="text-slate-600 shrink-0" />
                    <span className="font-mono text-slate-400 truncate flex-1">{f.path}</span>
                    {lib.folders.length > 1 && (
                      <button
                        onClick={() => handleRemoveFolder(lib.id, f.id)}
                        disabled={busy}
                        className="text-slate-600 hover:text-rose-400 disabled:opacity-40 px-1"
                        aria-label="Remove folder"
                        title="Remove folder (and its indexed media)"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => setPicker({ mode: 'add', libraryId: lib.id })}
                  disabled={busy}
                  className="text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-40"
                >
                  + Add folder
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {picker && (
        <DirectoryPicker
          initialPath={picker.mode === 'new' ? form.folders[picker.index] || '/media' : '/media'}
          onSelect={onPick}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}
