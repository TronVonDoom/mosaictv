import { useEffect, useState } from 'react'
import Icon from './Icon'
import {
  api,
  artworkUrl,
  tmdbImage,
  type MediaItemDetail,
} from '../lib/api'
import { formatDuration, formatSize, posterGradient } from '../lib/format'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 py-1.5 border-b border-slate-800/60 last:border-0">
      <span className="text-slate-500 text-xs uppercase tracking-wide w-24 shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-sm text-slate-200 break-words min-w-0">{value}</span>
    </div>
  )
}

export default function MediaDetailModal({
  id,
  onClose,
}: {
  id: number
  onClose: () => void
}) {
  const [item, setItem] = useState<MediaItemDetail | null>(null)

  useEffect(() => {
    setItem(null)
    api.mediaItem(id).then(setItem).catch(() => {})
  }, [id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isEpisode = item?.type === 'episode'
  const sxe =
    item?.season != null && item?.episode != null
      ? `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}`
      : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-2xl w-full p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {!item ? (
          <div className="text-slate-400 text-sm py-10 text-center">Loading…</div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-5">
            <div
              className="w-28 sm:w-32 shrink-0 aspect-[2/3] rounded-lg self-center sm:self-start flex items-center justify-center text-4xl overflow-hidden relative"
              style={{ background: posterGradient(item.showTitle || item.title) }}
            >
              {item.posterPath ? (
                <img src={artworkUrl(item.id, 'poster')} alt={item.title} className="absolute inset-0 w-full h-full object-cover" />
              ) : item.showPosterPath ? (
                <img src={artworkUrl(item.id, 'show')} alt={item.title} className="absolute inset-0 w-full h-full object-cover" />
              ) : item.tmdbPosterPath ? (
                <img src={tmdbImage(item.tmdbPosterPath)} alt={item.title} className="absolute inset-0 w-full h-full object-cover" />
              ) : (
                <Icon
                  name={item.type === 'movie' ? 'movie' : item.type === 'episode' ? 'show' : 'clip'}
                  size={40}
                  colored
                />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  {isEpisode && item.showTitle && (
                    <div className="text-slate-400 text-sm">{item.showTitle}</div>
                  )}
                  <h2 className="text-xl font-semibold">
                    {sxe && <span className="text-slate-500 mr-2">{sxe}</span>}
                    {item.title}
                    {item.year && !isEpisode && (
                      <span className="text-slate-500 font-normal"> ({item.year})</span>
                    )}
                  </h2>
                </div>
                <button
                  onClick={onClose}
                  className="text-slate-500 hover:text-slate-200 text-xl leading-none"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              {item.missing && (
                <div className="mt-2 text-xs text-amber-400">
                  ⚠ File is missing (not found on last scan)
                </div>
              )}
              {(item.rating || item.genres) && (
                <div className="mt-2 text-sm">
                  {item.rating ? <span className="text-amber-300">⭐ {item.rating.toFixed(1)}</span> : null}
                  {item.genres && (
                    <span className="text-slate-500">
                      {item.rating ? ' · ' : ''}
                      {item.genres}
                    </span>
                  )}
                </div>
              )}
              {item.overview && (
                <p className="mt-3 text-sm text-slate-300 leading-relaxed">{item.overview}</p>
              )}
              <div className="mt-4">
                <Row label="Library" value={item.library.name} />
                <Row label="Type" value={item.type} />
                <Row label="Duration" value={formatDuration(item.durationSec)} />
                <Row
                  label="Resolution"
                  value={item.width && item.height ? `${item.width}×${item.height}` : '—'}
                />
                <Row
                  label="Codecs"
                  value={[item.videoCodec, item.audioCodec].filter(Boolean).join(' / ') || '—'}
                />
                <Row label="Container" value={item.container || '—'} />
                <Row label="Size" value={formatSize(item.sizeBytes)} />
                <Row label="Path" value={item.path} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
