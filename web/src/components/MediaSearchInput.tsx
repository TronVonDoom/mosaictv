import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { api, type MediaSearchResult } from '../lib/api'
import { episodeCode } from '../lib/format'
import { Input } from './ui'

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

  // Season/episode entries let a collection be a hand-picked running order
  // (a "best of" marathon), not just whole shows.
  const rowFor = (r: MediaSearchResult): { icon: 'show' | 'movie' | 'clip'; main: string; meta: string } => {
    switch (r.kind) {
      case 'show':
        return { icon: 'show', main: r.showTitle, meta: `${r.episodeCount} eps · ${r.libraryName}` }
      case 'season':
        return {
          icon: 'show',
          main: `${r.showTitle} — Season ${r.season}`,
          meta: `${r.episodeCount} eps · ${r.libraryName}`,
        }
      case 'episode':
        return {
          icon: 'clip',
          main: r.title,
          meta: `${r.showTitle ?? ''} ${episodeCode(r) || 'episode'}`.trim(),
        }
      case 'movie':
        return { icon: 'movie', main: r.title, meta: String(r.year ?? '') }
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <Icon name="plus" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
      <Input
        className="w-full pl-9"
        placeholder="Add a show, season, episode or movie…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          if (results.length) setOpen(true)
        }}
      />
      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1.5 w-full rounded-xl border border-edge-strong bg-overlay/95 backdrop-blur p-1 shadow-2xl shadow-black/60 max-h-80 overflow-y-auto modal-in">
          {results.map((r, i) => {
            const row = rowFor(r)
            return (
              <button
                key={i}
                type="button"
                onClick={() => pick(r)}
                className="group w-full text-left rounded-lg px-2.5 py-2 text-[13px] hover:bg-white/[0.06] flex items-center gap-2.5"
              >
                <span className="grid place-items-center w-7 h-7 shrink-0 rounded-md border border-edge bg-surface text-ink-muted">
                  <Icon name={row.icon} size={14} />
                </span>
                <span className="flex-1 min-w-0 truncate text-ink-soft group-hover:text-ink">{row.main}</span>
                <span className="text-[11.5px] text-ink-faint shrink-0">{row.meta}</span>
                <Icon name="plus" size={14} className="shrink-0 text-ink-ghost group-hover:text-indigo-300" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
