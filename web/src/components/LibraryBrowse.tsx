import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, artworkUrl, type Library, type LibraryKind, type LibrarySample, type MediaItem, type Show } from '../lib/api'
import MediaDetailModal from './MediaDetailModal'
import PosterCard from './PosterCard'
import PosterRail, { RailItem } from './PosterRail'
import { posterGradient } from '../lib/format'
import { type IconName } from './Icon'
import Icon from './Icon'
import { EmptyState, IconTile, Skeleton, buttonClass } from './ui'

const KIND_ICON: Record<LibraryKind, IconName> = { tv: 'show', movie: 'movie', music: 'audio', other: 'clip' }
const KIND_LABEL: Record<LibraryKind, string> = {
  tv: 'TV Shows',
  movie: 'Movies',
  music: 'Music Videos',
  other: 'Other',
}
const KIND_NOUN: Record<LibraryKind, [string, string]> = {
  tv: ['episode', 'episodes'],
  movie: ['movie', 'movies'],
  music: ['video', 'videos'],
  other: ['clip', 'clips'],
}

/** A tilted wall of the library's own posters — the brand's mosaic, made of
 *  your media. Tiles fade in as they load; a missing one keeps its colour. */
function PosterMosaic({ sample, name }: { sample: LibrarySample | undefined; name: string }) {
  const tiles = sample?.items ?? []
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: posterGradient(name) }}>
      <div className="absolute -inset-x-10 -top-16 -bottom-6 grid grid-cols-6 gap-2 -rotate-[8deg] opacity-90 transition-transform duration-700 ease-out group-hover:scale-[1.04] group-hover:-rotate-[6deg]">
        {Array.from({ length: 18 }, (_, i) => {
          const t = tiles.length ? tiles[i % tiles.length] : null
          return (
            <div
              key={i}
              className="aspect-[2/3] rounded-md overflow-hidden bg-white/[0.04] ring-1 ring-white/10"
              style={{ background: t ? posterGradient(t.title) : undefined }}
            >
              {t && (
                <img
                  src={artworkUrl(t.id, t.art)}
                  alt=""
                  loading="lazy"
                  className="w-full h-full object-cover opacity-0 transition-opacity duration-500"
                  onLoad={(e) => (e.currentTarget.style.opacity = '1')}
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              )}
            </div>
          )
        })}
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/55 to-transparent" />
    </div>
  )
}

/** A shelf under the library cards: a movie library's newest additions, or a
 *  TV library's best-rated shows — something to click on the landing page
 *  rather than only a way through it. */
function LibraryRail({ library, onOpen }: { library: Library; onOpen: (id: number) => void }) {
  const navigate = useNavigate()
  const [items, setItems] = useState<MediaItem[] | null>(null)
  const [shows, setShows] = useState<Show[] | null>(null)

  useEffect(() => {
    if (library.kind === 'tv') {
      api
        .shows(library.id)
        .then((r) =>
          setShows(
            r.shows
              .filter((s) => (s.rating ?? 0) > 0 && (s.posterItemId != null || s.tmdbPosterPath))
              .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
              .slice(0, 18),
          ),
        )
        .catch(() => setShows([]))
    } else {
      const type = library.kind === 'movie' ? 'movie' : library.kind === 'music' ? 'music' : 'other'
      api
        .media({ libraryId: library.id, type, sort: 'added', pageSize: 18 })
        .then((r) => setItems(r.items))
        .catch(() => setItems([]))
    }
  }, [library])

  if (library.kind === 'tv') {
    if (!shows || shows.length === 0) return null
    return (
      <PosterRail
        title={`Top rated in ${library.name}`}
        actions={
          <Link to={`/library/${library.id}`} className="text-[13px] text-indigo-300 hover:text-indigo-200 mr-1">
            See all
          </Link>
        }
      >
        {shows.map((s) => (
          <RailItem key={s.showTitle}>
            <PosterCard
              title={s.showTitle}
              subtitle={`${s.seasonCount} season${s.seasonCount === 1 ? '' : 's'}`}
              badge={s.year ? String(s.year) : undefined}
              rating={s.rating}
              icon="show"
              imageUrl={
                s.posterItemId != null
                  ? artworkUrl(s.posterItemId, 'show')
                  : s.artItemId != null
                    ? artworkUrl(s.artItemId, 'show')
                    : undefined
              }
              onClick={() => navigate(`/library/${library.id}/show/${encodeURIComponent(s.showTitle)}`)}
            />
          </RailItem>
        ))}
      </PosterRail>
    )
  }

  if (!items || items.length === 0) return null
  return (
    <PosterRail
      title={`Recently added to ${library.name}`}
      actions={
        <Link to={`/library/${library.id}`} className="text-[13px] text-indigo-300 hover:text-indigo-200 mr-1">
          See all
        </Link>
      }
    >
      {items.map((m) => (
        <RailItem key={m.id}>
          <PosterCard
            title={m.title}
            subtitle={m.year ? String(m.year) : undefined}
            rating={m.rating}
            icon={library.kind === 'movie' ? 'movie' : 'clip'}
            imageUrl={m.posterPath || m.tmdbPosterPath ? artworkUrl(m.id, 'poster') : undefined}
            onClick={() => onOpen(m.id)}
          />
        </RailItem>
      ))}
    </PosterRail>
  )
}

/** The "Browse" half of the Library page: one card per library, leading into
 *  its contents, then a shelf from each. Managing and scanning lives in Sources. */
export default function LibraryBrowse({ onAddLibrary }: { onAddLibrary: () => void }) {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [samples, setSamples] = useState<Record<number, LibrarySample>>({})
  const [loaded, setLoaded] = useState(false)
  const [detailId, setDetailId] = useState<number | null>(null)

  useEffect(() => {
    api
      .libraries()
      .then((libs) => {
        setLibraries(libs)
        for (const l of libs)
          api
            .librarySample(l.id, 18)
            .then((s) => setSamples((prev) => ({ ...prev, [l.id]: s })))
            .catch(() => {})
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  if (!loaded) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 2 }, (_, i) => (
          <Skeleton key={i} className="h-72 rounded-2xl" />
        ))}
      </div>
    )
  }

  if (libraries.length === 0) {
    return (
      <EmptyState
        icon="libraries"
        title="No libraries yet"
        description="A library points MosaicTV at a folder of media. Add one and scan it, and your shows and movies show up here."
        action={
          <button onClick={onAddLibrary} className={buttonClass('primary', 'md')}>
            Add your first library
          </button>
        }
      />
    )
  }

  return (
    <div className="space-y-10">
    <div className={`grid gap-5 ${libraries.length <= 2 ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
      {libraries.map((l, i) => {
        const [one, many] = KIND_NOUN[l.kind]
        return (
          <Link
            key={l.id}
            to={`/library/${l.id}`}
            style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
            className="group relative block overflow-hidden rounded-2xl border border-edge surface-card card-interactive rise-in"
          >
            <div className={`relative ${libraries.length <= 2 ? 'h-60' : 'h-52'}`}>
              <PosterMosaic sample={samples[l.id]} name={l.name} />
            </div>
            <div className="relative -mt-12 flex items-end gap-4 px-5 pb-5">
              <IconTile name={KIND_ICON[l.kind]} size="lg" className="backdrop-blur-md" />
              <div className="min-w-0 flex-1 pb-0.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">{KIND_LABEL[l.kind]}</div>
                <div className="text-lg font-semibold tracking-tight truncate">{l.name}</div>
                <div className="text-[12.5px] text-ink-muted tabular-nums">
                  {l.itemCount.toLocaleString()} {l.itemCount === 1 ? one : many} · {l.folders.length}{' '}
                  {l.folders.length === 1 ? 'folder' : 'folders'}
                </div>
              </div>
              <span className="mb-1 grid place-items-center w-8 h-8 rounded-full bg-white/[0.06] text-ink-muted group-hover:bg-indigo-500 group-hover:text-white transition-colors">
                <Icon name="chevronRight" size={16} />
              </span>
            </div>
          </Link>
        )
      })}
    </div>
    {libraries.map((l) => (
      <LibraryRail key={l.id} library={l} onOpen={setDetailId} />
    ))}
    {detailId != null && <MediaDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
