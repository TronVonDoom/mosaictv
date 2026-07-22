import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  api,
  artworkUrl,
  tmdbImage,
  type SeasonGroup,
  type ShowDetail,
} from '../lib/api'
import { formatDuration, formatSize } from '../lib/format'
import MediaDetailModal from '../components/MediaDetailModal'
import PosterCard from '../components/PosterCard'
import AiringsEditor from '../components/AiringsEditor'
import { Button } from '../components/ui'

function seasonLabel(season: number | null): string {
  return season == null ? 'Unsorted' : `Season ${season}`
}

export default function ShowView() {
  const { libraryId, show } = useParams()
  const id = Number(libraryId)
  const showTitle = show ? decodeURIComponent(show) : ''

  const [detail, setDetail] = useState<ShowDetail | null>(null)
  const [openSeason, setOpenSeason] = useState<number | null | undefined>(undefined)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  // Toggles the season view between the episode list and the airings editor.
  const [grouping, setGrouping] = useState(false)
  // Only for the breadcrumb — the show payload doesn't carry its library's name.
  const [libraryName, setLibraryName] = useState<string | null>(null)

  useEffect(() => {
    if (!showTitle) return
    setOpenSeason(undefined)
    api.showDetail(id, showTitle).then(setDetail).catch(() => {})
  }, [id, showTitle])

  // Leave grouping mode whenever the chosen season changes.
  useEffect(() => setGrouping(false), [openSeason])

  useEffect(() => {
    api
      .libraries()
      .then((ls) => setLibraryName(ls.find((l) => l.id === id)?.name ?? null))
      .catch(() => {})
  }, [id])

  const current: SeasonGroup | undefined = useMemo(
    () => detail?.seasons.find((s) => s.season === openSeason),
    [detail, openSeason],
  )

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink-faint mb-1 flex-wrap">
        <Link to="/library" className="hover:text-indigo-300">
          Library
        </Link>
        <span>/</span>
        <Link to={`/library/${id}`} className="hover:text-indigo-300">
          {libraryName ?? '…'}
        </Link>
        <span>/</span>
        {current ? (
          <button onClick={() => setOpenSeason(undefined)} className="hover:text-indigo-300">
            {showTitle}
          </button>
        ) : (
          <span className="text-ink-soft">{showTitle}</span>
        )}
        {current && (
          <>
            <span>/</span>
            <span className="text-ink-soft">{seasonLabel(current.season)}</span>
          </>
        )}
      </div>

      <h1 className="text-2xl font-bold mb-6">
        {showTitle}
        {detail?.year && (
          <span className="text-ink-faint text-base font-normal ml-2">({detail.year})</span>
        )}
        {detail && (
          <span className="text-ink-faint text-base font-normal ml-2">
            · {detail.seasons.length} season{detail.seasons.length === 1 ? '' : 's'} ·{' '}
            {detail.episodeCount} episodes
          </span>
        )}
      </h1>

      {detail && (detail.rating != null || detail.genres || detail.overview) && (
        <div className="mb-6 max-w-3xl space-y-1.5">
          {(detail.rating ? detail.rating > 0 : false) && (
            <div className="text-sm text-amber-300">
              ⭐ {detail.rating!.toFixed(1)}
              {detail.genres && <span className="text-ink-faint"> · {detail.genres}</span>}
            </div>
          )}
          {detail.overview && <p className="text-sm text-ink-soft">{detail.overview}</p>}
        </div>
      )}

      {!detail ? (
        <div className="text-ink-faint text-sm">Loading…</div>
      ) : current ? (
        // --- Episodes within a chosen season ---
        <div>
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <button
              onClick={() => setOpenSeason(undefined)}
              className="text-sm text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1"
            >
              ← All seasons
            </button>
            <Button
              size="sm"
              variant={grouping ? 'primary' : 'secondary'}
              onClick={() => setGrouping((g) => !g)}
            >
              {grouping ? 'Done grouping' : 'Group broadcast episodes'}
            </Button>
          </div>
          {grouping ? (
            <AiringsEditor
              libraryId={id}
              show={showTitle}
              season={current.season}
              episodes={current.episodes}
            />
          ) : (
          <div className="rounded-xl border border-edge overflow-hidden divide-y divide-edge/60">
            {current.episodes.map((ep) => (
              <button
                key={ep.id}
                onClick={() => setSelectedId(ep.id)}
                className="w-full flex items-center gap-4 px-4 py-3 hover:bg-surface/60 text-left transition-colors"
              >
                <div className="w-10 text-center text-ink-faint font-mono text-sm shrink-0">
                  {ep.episode != null ? String(ep.episode).padStart(2, '0') : '—'}
                </div>
                <div className={'flex-1 min-w-0 ' + (ep.missing ? 'opacity-50' : '')}>
                  <div className="truncate text-ink">{ep.title}</div>
                  <div className="text-xs text-ink-faint">
                    {ep.width && ep.height ? `${ep.width}×${ep.height}` : ''}
                    {ep.videoCodec ? ` · ${ep.videoCodec}` : ''}
                    {ep.sizeBytes ? ` · ${formatSize(ep.sizeBytes)}` : ''}
                    {ep.missing ? ' · missing' : ''}
                  </div>
                </div>
                <div className="text-sm text-ink-muted shrink-0">
                  {formatDuration(ep.durationSec)}
                </div>
              </button>
            ))}
          </div>
          )}
        </div>
      ) : (
        // --- Season tiles ---
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-x-4 gap-y-5">
          {detail.seasons.map((s) => {
            const totalDur = s.episodes.reduce((a, e) => a + (e.durationSec ?? 0), 0)
            const posterEp = s.episodes.find((e) => e.seasonPosterPath)
            return (
              <PosterCard
                key={s.season ?? 'none'}
                title={seasonLabel(s.season)}
                subtitle={`${s.episodes.length} ep · ${formatDuration(totalDur)}`}
                icon="show"
                imageUrl={
                  posterEp
                    ? artworkUrl(posterEp.id, 'season')
                    : s.tmdbPosterPath
                      ? tmdbImage(s.tmdbPosterPath)
                      : undefined
                }
                onClick={() => setOpenSeason(s.season)}
              />
            )
          })}
        </div>
      )}

      {selectedId != null && (
        <MediaDetailModal id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  )
}
