import { useEffect, useState } from 'react'
import Icon from './Icon'
import { api, artworkUrl, tmdbImage, type MediaItemDetail } from '../lib/api'
import { episodeCode, formatDuration, formatSize, posterGradient } from '../lib/format'
import { Badge, IconButton, Modal, Skeleton } from './ui'

function Spec({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{label}</dt>
      <dd className={`mt-0.5 text-[13px] text-ink-soft break-words ${mono ? 'font-mono text-[12px]' : ''}`}>{value}</dd>
    </div>
  )
}

/** The detail view for one file — a movie, an episode, a clip: its artwork,
 *  what TMDB knows about it, and what's on disk. */
export default function MediaDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const [item, setItem] = useState<MediaItemDetail | null>(null)
  const [backdropOk, setBackdropOk] = useState(true)

  useEffect(() => {
    setItem(null)
    setBackdropOk(true)
    api.mediaItem(id).then(setItem).catch(() => {})
  }, [id])

  const isEpisode = item?.type === 'episode'
  const sxe = (item && episodeCode(item)) || null
  const poster = !item
    ? null
    : item.posterPath
      ? artworkUrl(item.id, 'poster')
      : item.showPosterPath || isEpisode
        ? artworkUrl(item.id, 'show')
        : item.tmdbPosterPath
          ? artworkUrl(item.id, 'poster')
          : null
  // Episodes use their show's backdrop; the route resolves that server-side.
  const wantBackdrop = !!item && backdropOk && (item.tmdbBackdropPath != null || isEpisode)
  const genres = item?.genres ? item.genres.split(',').map((g) => g.trim()).filter(Boolean) : []

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-3xl overflow-hidden">
      {/* Backdrop banner */}
      <div className="relative h-52 sm:h-60" style={{ background: posterGradient(item?.showTitle || item?.title || 'x') }}>
        {wantBackdrop && (
          <img
            src={artworkUrl(item!.id, 'backdrop')}
            alt=""
            onError={() => setBackdropOk(false)}
            className="absolute inset-0 w-full h-full object-cover fade-in"
          />
        )}
        {!wantBackdrop && poster && (
          <img src={poster} alt="" className="absolute inset-0 w-full h-full object-cover blur-2xl scale-125 opacity-50" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-black/20" />
        <IconButton
          icon="close"
          label="Close"
          onClick={onClose}
          className="absolute top-3 right-3 bg-black/45 backdrop-blur-md text-white hover:bg-black/65 hover:text-white"
        />
      </div>

      <div className="relative px-6 pb-6 -mt-24 flex flex-col sm:flex-row gap-6">
        <div
          className="w-32 sm:w-40 shrink-0 aspect-[2/3] rounded-xl overflow-hidden self-center sm:self-start shadow-[0_24px_48px_-16px_rgb(0_0_0/0.9)] ring-1 ring-white/15 grid place-items-center"
          style={{ background: posterGradient(item?.showTitle || item?.title || 'x') }}
        >
          {poster ? (
            <img src={poster} alt="" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
          ) : item?.tmdbPosterPath ? (
            <img src={tmdbImage(item.tmdbPosterPath)} alt="" className="w-full h-full object-cover" />
          ) : (
            <Icon name={item?.type === 'movie' ? 'movie' : item?.type === 'episode' ? 'show' : 'clip'} size={36} className="text-white/60" />
          )}
        </div>

        <div className="flex-1 min-w-0 sm:pt-20">
          {!item ? (
            <div className="space-y-3 pt-2">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <>
              {isEpisode && item.showTitle && (
                <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-muted">{item.showTitle}</div>
              )}
              <h2 className="text-[22px] font-semibold tracking-tight leading-tight">
                {item.title}
                {item.year && !isEpisode && <span className="text-ink-faint font-normal"> ({item.year})</span>}
              </h2>
              <div className="mt-2 flex items-center gap-2 flex-wrap text-[13px] text-ink-muted">
                {sxe && <Badge tone="accent">{sxe}</Badge>}
                {item.rating ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
                    <Icon name="star" size={13} className="fill-current" /> {item.rating.toFixed(1)}
                  </span>
                ) : null}
                <span className="tabular-nums">{formatDuration(item.durationSec)}</span>
                {item.height ? <Badge>{item.height >= 2000 ? '4K' : `${item.height}p`}</Badge> : null}
                {item.missing && (
                  <Badge tone="warn" dot>
                    Missing on disk
                  </Badge>
                )}
              </div>
              {genres.length > 0 && (
                <div className="mt-3 flex gap-1.5 flex-wrap">
                  {genres.map((g) => (
                    <span key={g} className="rounded-full border border-edge-strong bg-raised/60 px-2.5 py-0.5 text-[11.5px] text-ink-soft">
                      {g}
                    </span>
                  ))}
                </div>
              )}
              {item.overview && <p className="mt-4 text-[13.5px] text-ink-soft leading-relaxed">{item.overview}</p>}

              <dl className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-3.5 rounded-xl border border-edge bg-sunken/60 p-4">
                <Spec label="Library" value={item.library.name} />
                <Spec label="Resolution" value={item.width && item.height ? `${item.width}×${item.height}` : '—'} />
                <Spec label="Codecs" value={[item.videoCodec, item.audioCodec].filter(Boolean).join(' / ') || '—'} />
                <Spec label="Container" value={item.container || '—'} />
                <Spec label="Size" value={formatSize(item.sizeBytes)} />
                <Spec label="Type" value={item.type} />
                <div className="col-span-2 sm:col-span-3">
                  <Spec label="Path" value={item.path} mono />
                </div>
              </dl>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
