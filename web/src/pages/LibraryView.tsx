import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  api,
  artworkUrl,
  tmdbImage,
  type Library,
  type MediaItem,
  type Show,
} from '../lib/api'
import PosterCard from '../components/PosterCard'
import MediaDetailModal from '../components/MediaDetailModal'

const PAGE_SIZE = 60

export default function LibraryView() {
  const { libraryId } = useParams()
  const id = Number(libraryId)
  const navigate = useNavigate()

  const [library, setLibrary] = useState<Library | null>(null)
  const [shows, setShows] = useState<Show[]>([])
  const [items, setItems] = useState<MediaItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  // Reset everything when the library id changes (React reuses this component
  // instance across /browse/:id param changes).
  useEffect(() => {
    setLibrary(null)
    setShows([])
    setItems([])
    setTotal(0)
    setPage(1)
    setLoading(true)
  }, [id])

  // Resolve which library this is.
  useEffect(() => {
    api
      .libraries()
      .then((libs) => setLibrary(libs.find((l) => l.id === id) ?? null))
      .catch(() => {})
  }, [id])

  // Load contents based on library kind.
  useEffect(() => {
    if (!library) return
    setLoading(true)
    if (library.kind === 'tv') {
      api
        .shows(id)
        .then((r) => setShows(r.shows))
        .catch(() => {})
        .finally(() => setLoading(false))
    } else {
      const type = library.kind === 'movie' ? 'movie' : 'other'
      api
        .media({ libraryId: id, type, page, pageSize: PAGE_SIZE })
        .then((r) => {
          setItems((prev) => (page === 1 ? r.items : [...prev, ...r.items]))
          setTotal(r.total)
        })
        .catch(() => {})
        .finally(() => setLoading(false))
    }
  }, [library, id, page])

  const kindLabel =
    library?.kind === 'tv' ? 'TV Shows' : library?.kind === 'movie' ? 'Movies' : 'Other'

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink-faint mb-1">
        <Link to="/library" className="hover:text-indigo-300">
          Library
        </Link>
        <span>/</span>
        <span className="text-slate-300">{library?.name ?? '…'}</span>
      </div>
      <h1 className="text-2xl font-bold mb-6">
        {library?.name ?? 'Library'}
        <span className="text-slate-500 text-base font-normal ml-2">{kindLabel}</span>
      </h1>

      {loading && (shows.length === 0 && items.length === 0) ? (
        <div className="text-slate-500 text-sm">Loading…</div>
      ) : library?.kind === 'tv' ? (
        shows.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10 gap-x-4 gap-y-5">
            {shows.map((s) => (
              <PosterCard
                key={s.showTitle}
                title={s.showTitle}
                subtitle={`${s.seasonCount} season${s.seasonCount === 1 ? '' : 's'} · ${s.episodeCount} ep`}
                badge={s.year ? String(s.year) : undefined}
                icon="show"
                imageUrl={
                  s.posterItemId
                    ? artworkUrl(s.posterItemId, 'show')
                    : s.tmdbPosterPath
                      ? tmdbImage(s.tmdbPosterPath)
                      : undefined
                }
                onClick={() =>
                  navigate(`/library/${id}/show/${encodeURIComponent(s.showTitle)}`)
                }
              />
            ))}
          </div>
        )
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 2xl:grid-cols-10 gap-x-4 gap-y-5">
            {items.map((m) => (
              <PosterCard
                key={m.id}
                title={m.title}
                subtitle={m.type === 'music' ? m.artist ?? m.album ?? undefined : m.year ? String(m.year) : undefined}
                badge={m.width && m.height ? `${m.height}p` : undefined}
                icon={library?.kind === 'movie' ? 'movie' : library?.kind === 'music' ? 'audio' : 'clip'}
                imageUrl={
                  m.posterPath
                    ? artworkUrl(m.id, 'poster')
                    : m.tmdbPosterPath
                      ? tmdbImage(m.tmdbPosterPath)
                      : undefined
                }
                onClick={() => setSelectedId(m.id)}
              />
            ))}
          </div>
          {items.length < total && (
            <div className="flex justify-center mt-6">
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={loading}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:border-indigo-500 disabled:opacity-50"
              >
                {loading ? 'Loading…' : `Load more (${items.length} of ${total})`}
              </button>
            </div>
          )}
        </>
      )}

      {selectedId != null && (
        <MediaDetailModal id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="text-ink-faint text-sm">
      Nothing here yet. Run a scan on this library from{' '}
      <Link to="/library#sources" className="text-indigo-300">
        Library → Sources
      </Link>
      .
    </div>
  )
}
