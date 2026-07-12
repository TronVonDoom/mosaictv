import { useEffect, useRef, useState } from 'react'
import {
  api,
  type Library,
  type LibraryKind,
  type ScanStatus,
} from '../lib/api'

const KIND_LABELS: Record<LibraryKind, string> = {
  tv: 'TV Shows',
  movie: 'Movies',
  other: 'Other / Bumpers',
}

function ScanProgress({ status }: { status: ScanStatus }) {
  const pct =
    status.total > 0 ? Math.round((status.processed / status.total) * 100) : 0
  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-4 mb-5">
      <div className="flex justify-between text-sm mb-2">
        <span className="font-medium text-indigo-300">
          Scanning {status.libraryName}…
        </span>
        <span className="text-slate-400">
          {status.processed} / {status.total} ({pct}%)
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
        <div
          className="h-full bg-indigo-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex gap-4 text-xs text-slate-400 mt-2">
        <span className="text-emerald-400">+{status.added} new</span>
        <span className="text-sky-400">{status.updated} updated</span>
        <span>{status.skipped} unchanged</span>
        {status.removed > 0 && (
          <span className="text-amber-400">{status.removed} missing</span>
        )}
      </div>
      {status.currentPath && (
        <div className="text-xs text-slate-600 mt-1 truncate">
          {status.currentPath}
        </div>
      )}
    </div>
  )
}

export default function Libraries() {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [scan, setScan] = useState<ScanStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', path: '', kind: 'tv' as LibraryKind })
  const [submitting, setSubmitting] = useState(false)
  const pollRef = useRef<number | null>(null)

  const refresh = () => api.libraries().then(setLibraries).catch(() => {})

  useEffect(() => {
    refresh()
    // Pick up an in-progress scan on mount.
    api.scanStatus().then((s) => {
      setScan(s)
      if (s.running) startPolling()
    })
    return () => stopPolling()
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

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.addLibrary(form)
      setForm({ name: '', path: '', kind: 'tv' })
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add library')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleScan(id: number) {
    setError(null)
    try {
      await api.startScan(id)
      startPolling()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scan')
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

  const scanning = scan?.running ?? false

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Libraries</h1>
      <p className="text-slate-400 text-sm mb-6">
        Register folders under your mounted <code className="text-slate-500">/media</code>{' '}
        volume, then scan them to index your videos.
      </p>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm p-3 mb-5">
          {error}
        </div>
      )}

      {scan?.running && <ScanProgress status={scan} />}

      <form
        onSubmit={handleAdd}
        className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mb-6 grid grid-cols-1 md:grid-cols-[1fr_1.5fr_auto_auto] gap-3 items-end"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Name</span>
          <input
            className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 focus:border-indigo-500 outline-none"
            placeholder="TV Shows"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Path (inside container)</span>
          <input
            className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 font-mono text-sm focus:border-indigo-500 outline-none"
            placeholder="/media/TV"
            value={form.path}
            onChange={(e) => setForm({ ...form, path: e.target.value })}
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
            <option value="other">Other</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 px-4 py-2 font-medium transition-colors"
        >
          Add
        </button>
      </form>

      {libraries.length === 0 ? (
        <div className="text-slate-500 text-sm">No libraries yet.</div>
      ) : (
        <div className="space-y-3">
          {libraries.map((lib) => (
            <div
              key={lib.id}
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{lib.name}</span>
                  <span className="text-xs rounded-full bg-slate-800 text-slate-400 px-2 py-0.5">
                    {KIND_LABELS[lib.kind]}
                  </span>
                </div>
                <div className="text-xs text-slate-500 font-mono truncate">{lib.path}</div>
                <div className="text-xs text-slate-400 mt-1">{lib.itemCount} items indexed</div>
              </div>
              <button
                onClick={() => handleScan(lib.id)}
                disabled={scanning}
                className="rounded-lg border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 disabled:opacity-40 px-3 py-1.5 text-sm transition-colors"
              >
                {scanning ? 'Scanning…' : 'Scan'}
              </button>
              <button
                onClick={() => handleDelete(lib.id)}
                disabled={scanning}
                className="rounded-lg border border-slate-800 text-slate-500 hover:border-rose-500/50 hover:text-rose-400 disabled:opacity-40 px-3 py-1.5 text-sm transition-colors"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
