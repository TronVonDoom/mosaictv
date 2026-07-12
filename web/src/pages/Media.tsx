import { useEffect, useState } from 'react'
import {
  api,
  formatDuration,
  formatSize,
  type Library,
  type MediaItem,
} from '../lib/api'

const PAGE_SIZE = 50

function TypeBadge({ type }: { type: MediaItem['type'] }) {
  const styles: Record<string, string> = {
    episode: 'bg-sky-500/15 text-sky-300',
    movie: 'bg-violet-500/15 text-violet-300',
    other: 'bg-slate-700/50 text-slate-300',
  }
  return (
    <span className={'text-xs rounded-full px-2 py-0.5 ' + (styles[type] ?? styles.other)}>
      {type}
    </span>
  )
}

export default function Media() {
  const [items, setItems] = useState<MediaItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [type, setType] = useState('')
  const [libraryId, setLibraryId] = useState('')
  const [libraries, setLibraries] = useState<Library[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.libraries().then(setLibraries).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const handle = setTimeout(() => {
      api
        .media({
          page,
          pageSize: PAGE_SIZE,
          q: q || undefined,
          type: type || undefined,
          libraryId: libraryId ? Number(libraryId) : undefined,
        })
        .then((res) => {
          setItems(res.items)
          setTotal(res.total)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    }, 250) // debounce search typing
    return () => clearTimeout(handle)
  }, [page, q, type, libraryId])

  // Reset to page 1 whenever a filter changes.
  useEffect(() => {
    setPage(1)
  }, [q, type, libraryId])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Media</h1>
      <p className="text-slate-400 text-sm mb-6">{total} indexed items</p>

      <div className="flex flex-wrap gap-3 mb-5">
        <input
          className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm flex-1 min-w-48 focus:border-indigo-500 outline-none"
          placeholder="Search title or show…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">All types</option>
          <option value="episode">Episodes</option>
          <option value="movie">Movies</option>
          <option value="other">Other</option>
        </select>
        <select
          className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none"
          value={libraryId}
          onChange={(e) => setLibraryId(e.target.value)}
        >
          <option value="">All libraries</option>
          {libraries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-900/80 text-slate-400 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-4 py-3">Title</th>
              <th className="text-left font-medium px-4 py-3">Type</th>
              <th className="text-left font-medium px-4 py-3">Info</th>
              <th className="text-right font-medium px-4 py-3">Duration</th>
              <th className="text-right font-medium px-4 py-3">Size</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No media found. Add a library and run a scan.
                </td>
              </tr>
            )}
            {items.map((m) => (
              <tr key={m.id} className="border-t border-slate-800/60 hover:bg-slate-900/40">
                <td className="px-4 py-2.5">
                  <div className={m.missing ? 'line-through text-slate-500' : ''}>
                    {m.showTitle && m.type === 'episode' ? (
                      <span>
                        <span className="text-slate-400">{m.showTitle}</span>
                        {m.season != null && m.episode != null && (
                          <span className="text-slate-600">
                            {' '}
                            S{String(m.season).padStart(2, '0')}E
                            {String(m.episode).padStart(2, '0')}
                          </span>
                        )}
                        {' — '}
                        {m.title}
                      </span>
                    ) : (
                      <>
                        {m.title}
                        {m.year && <span className="text-slate-600"> ({m.year})</span>}
                      </>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <TypeBadge type={m.type} />
                </td>
                <td className="px-4 py-2.5 text-slate-500 text-xs">
                  {m.width && m.height ? `${m.width}×${m.height}` : '—'}
                  {m.videoCodec && ` · ${m.videoCodec}`}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-400">
                  {formatDuration(m.durationSec)}
                </td>
                <td className="px-4 py-2.5 text-right text-slate-400">
                  {formatSize(m.sizeBytes)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-lg border border-slate-700 px-3 py-1.5 disabled:opacity-40 hover:border-slate-500"
          >
            Previous
          </button>
          <span className="text-slate-400">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded-lg border border-slate-700 px-3 py-1.5 disabled:opacity-40 hover:border-slate-500"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
