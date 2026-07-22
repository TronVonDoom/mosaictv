import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  api,
  artworkUrl,
  tmdbImage,
  type Airing,
  type AiringAppearance,
  type AiringSegmentInfo,
  type SeasonGroup,
  type ShowDetail,
} from '../lib/api'
import { formatDuration, formatSize } from '../lib/format'
import MediaDetailModal from '../components/MediaDetailModal'
import PosterCard from '../components/PosterCard'
import AiringsEditor from '../components/AiringsEditor'
import { Badge, Banner, Button, cx } from '../components/ui'

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
  // True while the editor has unsaved groupings — guards leaving grouping mode.
  const [editorDirty, setEditorDirty] = useState(false)
  // The show's defined broadcast episodes, for the "grouped" markers.
  const [airings, setAirings] = useState<Airing[]>([])
  // Places episodes of THIS show are woven into OTHER shows' broadcast episodes.
  const [appearances, setAppearances] = useState<AiringAppearance[]>([])
  // Only for the breadcrumb — the show payload doesn't carry its library's name.
  const [libraryName, setLibraryName] = useState<string | null>(null)

  const reloadAirings = () =>
    api
      .airings(id, showTitle)
      .then((r) => setAirings(r.airings))
      .catch(() => setAirings([]))

  useEffect(() => {
    if (!showTitle) return
    setOpenSeason(undefined)
    api.showDetail(id, showTitle).then(setDetail).catch(() => {})
    reloadAirings()
    api
      .airingAppearances(id, showTitle)
      .then((r) => setAppearances(r.appearances))
      .catch(() => setAppearances([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, showTitle])

  // Leave grouping mode whenever the chosen season changes.
  useEffect(() => setGrouping(false), [openSeason])

  const current: SeasonGroup | undefined = useMemo(
    () => detail?.seasons.find((s) => s.season === openSeason),
    [detail, openSeason],
  )

  // Which broadcast episode each grouped file belongs to, for the current season.
  const groupInfo = useMemo(() => {
    const map = new Map<number, { groupNo: number; index: number; size: number }>()
    airings
      .filter((a) => (a.season ?? null) === (current?.season ?? null))
      .forEach((a, gi) =>
        a.segments.forEach((s, idx) =>
          map.set(s.mediaItemId, { groupNo: gi + 1, index: idx + 1, size: a.segments.length }),
        ),
      )
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airings, current?.season])

  // This show's episodes that air inside other shows, keyed by episode id (an
  // episode borrowed into two hosts has two entries).
  const borrowedInfo = useMemo(() => {
    const map = new Map<number, AiringAppearance[]>()
    for (const a of appearances) {
      const arr = map.get(a.mediaItemId)
      if (arr) arr.push(a)
      else map.set(a.mediaItemId, [a])
    }
    return map
  }, [appearances])

  // Distinct host shows, for the show-level banner.
  const borrowHosts = useMemo(
    () => [...new Set(appearances.map((a) => a.host.showTitle))].sort(),
    [appearances],
  )

  // Borrowed (foreign) segments woven into this season's broadcast episodes, hung
  // under the owned episode they follow so the read list shows the full running
  // order. `groupNo` matches the badge on the anchoring episode.
  const foreignSegs = useMemo(() => {
    const ownedIds = new Set(current?.episodes.map((e) => e.id) ?? [])
    const map = new Map<number, { seg: AiringSegmentInfo; groupNo: number }[]>()
    airings
      .filter((a) => (a.season ?? null) === (current?.season ?? null))
      .forEach((a, gi) => {
        const firstOwned = a.segments.find((s) => ownedIds.has(s.mediaItemId))?.mediaItemId
        let anchor: number | undefined
        for (const s of a.segments) {
          if (ownedIds.has(s.mediaItemId)) {
            anchor = s.mediaItemId
            continue
          }
          const key = anchor ?? firstOwned
          if (key == null) continue // no owned episode to hang this segment on
          const entry = { seg: s, groupNo: gi + 1 }
          const arr = map.get(key)
          if (arr) arr.push(entry)
          else map.set(key, [entry])
        }
      })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [airings, current?.season, current?.episodes])

  const leaveGrouping = () => {
    if (editorDirty && !window.confirm('You have unsaved groupings. Leave without saving?')) return
    setGrouping(false)
    setEditorDirty(false)
  }

  useEffect(() => {
    api
      .libraries()
      .then((ls) => setLibraryName(ls.find((l) => l.id === id)?.name ?? null))
      .catch(() => {})
  }, [id])

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

      {appearances.length > 0 && (
        <Banner tone="accent" className="mb-6 max-w-3xl">
          {borrowedInfo.size} episode{borrowedInfo.size === 1 ? '' : 's'} of this show{' '}
          {borrowedInfo.size === 1 ? 'airs' : 'air'} as segments inside other broadcasts:{' '}
          <span className="text-ink">{borrowHosts.join(', ')}</span>.
        </Banner>
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
            <div className="flex items-center gap-2">
              {!grouping && groupInfo.size > 0 && (
                <Badge tone="accent">
                  {new Set([...groupInfo.values()].map((g) => g.groupNo)).size} broadcast episode
                  {new Set([...groupInfo.values()].map((g) => g.groupNo)).size === 1 ? '' : 's'}
                </Badge>
              )}
              <Button
                size="sm"
                variant={grouping ? 'primary' : 'secondary'}
                onClick={() => (grouping ? leaveGrouping() : setGrouping(true))}
              >
                {grouping ? 'Done grouping' : 'Group broadcast episodes'}
              </Button>
            </div>
          </div>
          {grouping ? (
            <AiringsEditor
              libraryId={id}
              show={showTitle}
              season={current.season}
              episodes={current.episodes}
              onSaved={reloadAirings}
              onDirtyChange={setEditorDirty}
            />
          ) : (
          <div className="rounded-xl border border-edge overflow-hidden divide-y divide-edge/60">
            {current.episodes.map((ep) => {
              const g = groupInfo.get(ep.id)
              const woven = foreignSegs.get(ep.id)
              const airsIn = borrowedInfo.get(ep.id)
              return (
              <div key={ep.id}>
              <button
                onClick={() => setSelectedId(ep.id)}
                className={cx(
                  'w-full flex items-center gap-4 px-4 py-3 hover:bg-surface/60 text-left transition-colors',
                  g && 'border-l-2 border-indigo-500 bg-indigo-500/5',
                )}
              >
                <div className="w-10 text-center text-ink-faint font-mono text-sm shrink-0">
                  {ep.episode != null ? String(ep.episode).padStart(2, '0') : '—'}
                </div>
                <div className={'flex-1 min-w-0 ' + (ep.missing ? 'opacity-50' : '')}>
                  <div className="truncate text-ink flex items-center gap-2">
                    <span className="truncate">{ep.title}</span>
                    {g && (
                      <Badge tone="accent" className="shrink-0">
                        Broadcast ep {g.groupNo} · {g.index}/{g.size}
                      </Badge>
                    )}
                    {airsIn && (
                      <Badge tone="good" className="shrink-0">
                        Airs in {[...new Set(airsIn.map((x) => x.host.showTitle))].join(', ')}
                      </Badge>
                    )}
                  </div>
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
              {woven?.map(({ seg, groupNo }) => (
                <button
                  key={'seg' + seg.mediaItemId}
                  onClick={() => setSelectedId(seg.mediaItemId)}
                  className="w-full flex items-center gap-3 pl-12 pr-4 py-2 hover:bg-surface/60 text-left transition-colors bg-indigo-500/5 border-l-2 border-indigo-500"
                >
                  <span className="text-ink-faint shrink-0">↳</span>
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm text-ink-soft flex items-center gap-2">
                      <span className="truncate">{seg.title}</span>
                      <Badge tone="accent" className="shrink-0">
                        {seg.showTitle ?? 'Other show'}
                      </Badge>
                    </div>
                    <div className="text-xs text-ink-faint">Woven into broadcast ep {groupNo}</div>
                  </div>
                  <span className="text-sm text-ink-muted shrink-0">
                    {formatDuration(seg.durationSec)}
                  </span>
                </button>
              ))}
              </div>
              )
            })}
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
