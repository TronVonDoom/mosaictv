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
      <Input
        className="w-full"
        placeholder="Add a show, season, episode or movie…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          if (results.length) setOpen(true)
        }}
      />
      {open && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-edge-strong bg-surface shadow-xl max-h-64 overflow-y-auto">
          {results.map((r, i) => {
            const row = rowFor(r)
            return (
              <button
                key={i}
                type="button"
                onClick={() => pick(r)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-raised flex items-center gap-2"
              >
                <Icon name={row.icon} size={15} colored />
                <span className="flex-1 min-w-0 truncate">{row.main}</span>
                <span className="text-xs text-ink-faint shrink-0">{row.meta}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
