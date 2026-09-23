import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  api,
  artworkUrl,
  tmdbImage,
  type Library,
  type MediaItem,
  type MediaSort,
  type Show,
} from '../lib/api'
import PosterCard from '../components/PosterCard'
import MediaDetailModal from '../components/MediaDetailModal'
import Icon from '../components/Icon'
import { Breadcrumbs, EmptyState, IconTile, Select, Skeleton, buttonClass } from '../components/ui'

const PAGE_SIZE = 60
type ShowSort = 'title' | 'year' | 'episodes' | 'rating'

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-5 gap-y-7'

export default function LibraryView() {
  const { libraryId } = useParams()
  const id = Number(libraryId)
  const navigate = useNavigate()

  const [library, setLibrary] = useState<Library | null>(null)
  const [shows, setShows] = useState<Show[]>([])
  const [items, setItems] = useState<MediaItem[]>([])
  const [total, setTotal] = useState(0)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [showSort, setShowSort] = useState<ShowSort>('title')
  // One object, so a new search or sort and "back to page 1" land together —
  // separately, a stale page-3 fetch could append to the new results.
  const [params, setParams] = useState<{ page: number; q: string; sort: MediaSort }>({ page: 1, q: '', sort: 'title' })
  const request = useRef(0)
  const sentinel = useRef<HTMLDivElement>(null)

  // Resolve which library this is.
  useEffect(() => {
    api
      .libraries()
      .then((libs) => setLibrary(libs.find((l) => l.id === id) ?? null))
      .catch(() => {})
  }, [id])

  // Server-side search for flat libraries; wait for typing to settle.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  const isTv = library?.kind === 'tv'

  // TV: one fetch, then filter and sort in the browser.
  useEffect(() => {
    if (!library || !isTv) return
    setLoading(true)
    api
      .shows(id)
      .then((r) => setShows(r.shows))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [library, isTv, id])

  // Movies and the rest: paged from the server. A new search or sort starts over.
  useEffect(() => {
    setParams((p) => (p.q === debounced ? p : { ...p, q: debounced, page: 1 }))
  }, [debounced])
  useEffect(() => {
    if (!library || isTv) return
    const mine = ++request.current
    setLoading(true)
    const type = library.kind === 'movie' ? 'movie' : library.kind === 'music' ? 'music' : 'other'
    api
      .media({ libraryId: id, type, page: params.page, pageSize: PAGE_SIZE, q: params.q || undefined, sort: params.sort })
      .then((r) => {
        if (mine !== request.current) return // superseded by a newer search/sort/page
        setItems((prev) => (params.page === 1 ? r.items : [...prev, ...r.items]))
        setTotal(r.total)
      })
      .catch(() => {})
      .finally(() => mine === request.current && setLoading(false))
  }, [library, isTv, id, params])

  // Infinite scroll: the next page loads as the end of the grid comes into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el || isTv) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && items.length < total) setParams((p) => ({ ...p, page: p.page + 1 }))
      },
      { rootMargin: '600px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [isTv, loading, items.length, total])

  const visibleShows = useMemo(() => {
    const q = debounced.toLowerCase()
    const list = q ? shows.filter((s) => s.showTitle.toLowerCase().includes(q)) : [...shows]
    const by: Record<ShowSort, (a: Show, b: Show) => number> = {
      title: (a, b) => a.showTitle.localeCompare(b.showTitle),
      year: (a, b) => (b.year ?? 0) - (a.year ?? 0) || a.showTitle.localeCompare(b.showTitle),
      episodes: (a, b) => b.episodeCount - a.episodeCount,
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0),
    }
    return list.sort(by[showSort])
  }, [shows, debounced, showSort])

  const kindLabel = library?.kind === 'tv' ? 'TV Shows' : library?.kind === 'movie' ? 'Movies' : library?.kind === 'music' ? 'Music Videos' : 'Other'
  const count = isTv ? visibleShows.length : total
  const noun = isTv ? (count === 1 ? 'show' : 'shows') : library?.kind === 'movie' ? (count === 1 ? 'movie' : 'movies') : count === 1 ? 'item' : 'items'
  const firstLoad = loading && shows.length === 0 && items.length === 0

  return (
    <div>
      <div className="mb-4">
        <Breadcrumbs items={[{ label: 'Library', to: '/library' }, { label: library?.name ?? '…' }]} />
      </div>

      <div className="flex items-center gap-4 flex-wrap mb-6">
        <IconTile name={isTv ? 'show' : library?.kind === 'movie' ? 'movie' : 'clip'} size="md" />
        <div className="min-w-0 flex-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] leading-tight">{library?.name ?? 'Library'}</h1>
          <p className="text-sm text-ink-muted tabular-nums">
            {kindLabel} · {firstLoad ? '…' : `${count.toLocaleString()} ${noun}${debounced ? ` matching “${debounced}”` : ''}`}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="sticky top-14 z-20 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-3 mb-6 glass border-b border-edge/60 flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-56 max-w-md">
          <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${kindLabel.toLowerCase()}…`}
            className="h-9 w-full rounded-lg bg-sunken border border-edge-strong pl-9 pr-8 text-sm text-ink placeholder:text-ink-ghost outline-none transition-[border-color,box-shadow] focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/20"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-6 h-6 rounded-md text-ink-faint hover:text-ink hover:bg-white/[0.06]"
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <Icon name="sort" size={15} className="text-ink-faint" />
          {isTv ? (
            <Select value={showSort} onChange={(e) => setShowSort(e.target.value as ShowSort)} aria-label="Sort shows">
              <option value="title">Title A–Z</option>
              <option value="year">Newest first</option>
              <option value="episodes">Most episodes</option>
              <option value="rating">Highest rated</option>
            </Select>
          ) : (
            <Select
              value={params.sort}
              onChange={(e) => setParams((p) => ({ ...p, sort: e.target.value as MediaSort, page: 1 }))}
              aria-label="Sort"
            >
              <option value="title">Title A–Z</option>
              <option value="year">Newest release</option>
              <option value="added">Recently added</option>
              <option value="rating">Highest rated</option>
            </Select>
          )}
        </div>
      </div>

      {firstLoad ? (
        <div className={GRID}>
          {Array.from({ length: 16 }, (_, i) => (
            <div key={i}>
              <Skeleton className="aspect-[2/3] rounded-xl" />
              <Skeleton className="h-3.5 w-3/4 mt-2.5" />
            </div>
          ))}
        </div>
      ) : isTv ? (
        visibleShows.length === 0 ? (
          <NothingHere searching={!!debounced} />
        ) : (
          <div className={GRID}>
            {visibleShows.map((s) => (
              <PosterCard
                key={s.showTitle}
                title={s.showTitle}
                subtitle={`${s.seasonCount} season${s.seasonCount === 1 ? '' : 's'} · ${s.episodeCount} ep`}
                badge={s.year ? String(s.year) : undefined}
                rating={s.rating}
                icon="show"
                imageUrl={
                  s.posterItemId
                    ? artworkUrl(s.posterItemId, 'show')
                    : s.tmdbPosterPath
                      ? s.artItemId
                        ? artworkUrl(s.artItemId, 'show')
                        : tmdbImage(s.tmdbPosterPath)
                      : undefined
                }
                onClick={() => navigate(`/library/${id}/show/${encodeURIComponent(s.showTitle)}`)}
              />
            ))}
          </div>
        )
      ) : items.length === 0 ? (
        <NothingHere searching={!!debounced} />
      ) : (
        <>
          <div className={GRID}>
            {items.map((m) => (
              <PosterCard
                key={m.id}
                title={m.title}
                subtitle={m.type === 'music' ? m.artist ?? m.album ?? undefined : m.year ? String(m.year) : undefined}
                badge={m.height ? (m.height >= 2000 ? '4K' : `${m.height >= 1000 ? 1080 : m.height >= 700 ? 720 : m.height}p`) : undefined}
                rating={m.rating}
                icon={library?.kind === 'movie' ? 'movie' : library?.kind === 'music' ? 'audio' : 'clip'}
                imageUrl={m.posterPath || m.tmdbPosterPath ? artworkUrl(m.id, 'poster') : undefined}
                onClick={() => setSelectedId(m.id)}
              />
            ))}
          </div>
          <div ref={sentinel} className="h-10" />
          {loading && items.length > 0 && (
            <div className="flex justify-center py-4 text-[13px] text-ink-faint">Loading more…</div>
          )}
        </>
      )}

      {selectedId != null && <MediaDetailModal id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

function NothingHere({ searching }: { searching: boolean }) {
  return searching ? (
    <EmptyState icon="search" title="No matches" description="Try a shorter search, or check the spelling." />
  ) : (
    <EmptyState
      icon="libraries"
      title="Nothing here yet"
      description="Scan this library to index its files — posters and descriptions come from TMDB afterwards."
      action={
        <Link to="/library#sources" className={buttonClass('primary', 'md')}>
          Go to Sources
        </Link>
      }
    />
  )
}
