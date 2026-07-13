import { useEffect, useRef, useState } from 'react'
import { api, type MediaSearchResult } from '../lib/api'

export default function MediaSearchInput({
  onAdd,
}: {
  onAdd: (r: MediaSearchResult) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<MediaSearchResult[]>([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!q.trim()) {
      setResults([])
      return
    }
    const h = setTimeout(() => {
      api
        .searchMedia(q)
        .then((r) => {
          setResults(r.results)
          setOpen(true)
        })
        .catch(() => {})
    }, 200)
    return () => clearTimeout(h)
  }, [q])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  function pick(r: MediaSearchResult) {
    onAdd(r)
    setQ('')
    setResults([])
    setOpen(false)
  }

  return (
    <div className="relative" ref={boxRef}>
      <input
        className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none"
        placeholder="Add a show or movie…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          if (results.length) setOpen(true)
        }}
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 shadow-xl max-h-64 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={i}
              type="button"
              onClick={() => pick(r)}
              className="w-full text-left px-3 py-2 text-sm hover:bg-slate-800 flex items-center gap-2"
            >
              <span>{r.kind === 'show' ? '📺' : '🎬'}</span>
              <span className="flex-1 min-w-0 truncate">
                {r.kind === 'show' ? r.showTitle : r.title}
              </span>
              <span className="text-xs text-slate-500 shrink-0">
                {r.kind === 'show' ? `${r.episodeCount} eps · ${r.libraryName}` : (r.year ?? '')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
