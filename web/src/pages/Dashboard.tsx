import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import GettingStarted from '../components/GettingStarted'
import ChannelCard from '../components/ChannelCard'
import GuideGrid from '../components/GuideGrid'
import MediaDetailModal from '../components/MediaDetailModal'
import ResourceChart from '../components/ResourceChart'
import { api, type Channel, type ChannelNow, type Playout, type Stats } from '../lib/api'
import { formatLongDuration, greeting } from '../lib/format'
import { useNow, usePolling } from '../lib/hooks'
import { EmptyState, SectionHeading, Skeleton, StatTile, buttonClass } from '../components/ui'
import Icon from '../components/Icon'

// hls.js is only needed once a preview is actually opened.
const ChannelPreview = lazy(() => import('../components/ChannelPreview'))

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [nowRows, setNowRows] = useState<Record<number, ChannelNow>>({})
  const [guides, setGuides] = useState<Record<number, Playout>>({})
  const [watching, setWatching] = useState<Channel | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const nowMs = useNow(15000)

  const load = useCallback(() => {
    api.stats().then(setStats).catch(() => {})
    api.channels().then(setChannels).catch(() => {})
    api
      .channelsNow()
      .then((rows) => setNowRows(Object.fromEntries(rows.map((r) => [r.channelId, r]))))
      .catch(() => {})
  }, [])

  useEffect(() => {
    load()
  }, [load])
  usePolling(load, 20000)

  const onAir = (channels ?? []).filter((c) => c.number != null)

  // Guides are heavier and change slowly: fetch when the set of on-air
  // channels changes, and refresh every few minutes rather than every poll.
  const onAirKey = onAir.map((c) => c.id).join(',')
  const loadGuides = useCallback(() => {
    const ids = onAirKey ? onAirKey.split(',').map(Number) : []
    Promise.all(ids.map((id) => api.playout(id, 14).then((p) => [id, p] as const).catch(() => null))).then((entries) => {
      const map: Record<number, Playout> = {}
      for (const e of entries) if (e) map[e[0]] = e[1]
      setGuides(map)
    })
  }, [onAirKey])
  useEffect(() => {
    loadGuides()
  }, [loadGuides])
  usePolling(loadGuides, 300000)

  const viewers = onAir.reduce((n, c) => n + c.viewers, 0)
  // Rows that come out even — never one orphan under a row of three — and
  // every channel above the fold on a desktop, so the guide below stays in
  // view: four channels sit in one row from 1280px, pairing up below that.
  const liveCols =
    onAir.length <= 2
      ? 'sm:grid-cols-2'
      : onAir.length === 3
        ? 'sm:grid-cols-2 lg:grid-cols-3'
        : onAir.length === 4
          ? 'sm:grid-cols-2 xl:grid-cols-4'
          : 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4'
  const summary = [
    channels == null ? null : onAir.length > 0 ? `${onAir.length} channel${onAir.length === 1 ? '' : 's'} on air` : 'Nothing on air yet',
    viewers > 0 ? `${viewers} watching now` : null,
    stats ? `${stats.items.toLocaleString()} titles in your library` : null,
  ].filter(Boolean)

  return (
    <div className="space-y-10">
      {/* Greeting */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[13px] font-medium text-ink-faint">
            {new Date(nowMs).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          <h1 className="mt-1 text-[30px] font-semibold tracking-[-0.025em] leading-tight">{greeting(new Date(nowMs))}</h1>
          <p className="mt-1 text-sm text-ink-muted">{summary.join(' · ') || ' '}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/channels" className={buttonClass('primary', 'md')}>
            <Icon name="channels" size={16} /> Channels &amp; guide
          </Link>
        </div>
      </header>

      {/* On a fresh instance the checklist is the point of this page, so it
          leads. It returns null once every step is done. */}
      {stats && channels && <GettingStarted stats={stats} channels={channels} />}

      {/* Live now */}
      <section>
        <SectionHeading
          title="Live now"
          description="What every channel is airing this minute. Click a channel's picture to watch it live."
          actions={
            onAir.length > 0 && (
              <Link to="/channels" className="text-[13px] text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1">
                Manage channels <Icon name="chevronRight" size={14} />
              </Link>
            )
          }
        />
        {channels == null ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="aspect-[16/12] rounded-2xl" />
            ))}
          </div>
        ) : onAir.length === 0 ? (
          <EmptyState
            icon="channels"
            title="Nothing on air yet"
            description="A channel goes live once you give it a number — that's what puts it in the M3U playlist and the XMLTV guide."
            action={
              <Link to="/channels" className={buttonClass('primary', 'md')}>
                Go to Channels
              </Link>
            }
          />
        ) : (
          <div className={`grid grid-cols-1 gap-4 ${liveCols}`}>
            {onAir.map((c, i) => (
              <ChannelCard
                key={c.id}
                channel={c}
                now={nowRows[c.id]}
                nowMs={nowMs}
                onWatch={() => setWatching(c)}
                style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
              />
            ))}
          </div>
        )}
      </section>

      {/* Tonight */}
      {onAir.length > 0 && (
        <section>
          <SectionHeading
            title="Coming up"
            description="The next few hours across every channel. Click a program for its details."
            actions={
              <Link to="/channels#guide" className="text-[13px] text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1">
                Full guide <Icon name="chevronRight" size={14} />
              </Link>
            }
          />
          <GuideGrid
            channels={onAir}
            guides={guides}
            nowMs={nowMs}
            hours={14}
            pxPerMin={4.5}
            rowHeight={64}
            onSelect={(e) => e.mediaItem && setDetailId(e.mediaItem.id)}
          />
        </section>
      )}

      {/* Library + system */}
      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <SectionHeading
            title="Library"
            actions={
              <Link to="/library" className="text-[13px] text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1">
                Browse <Icon name="chevronRight" size={14} />
              </Link>
            }
          />
          <div className="grid grid-cols-2 gap-3">
            {stats ? (
              <>
                <StatTile icon="show" label="Episodes" value={(stats.byType.episode ?? 0).toLocaleString()} />
                <StatTile icon="movie" label="Movies" value={(stats.byType.movie ?? 0).toLocaleString()} />
                <StatTile
                  icon="clock"
                  label="Total runtime"
                  value={formatLongDuration(stats.totalDurationSec)}
                  sub="Of watching, back to back"
                />
                <StatTile
                  icon="database"
                  label="Indexed files"
                  value={stats.items.toLocaleString()}
                  sub={
                    stats.missing > 0
                      ? `${stats.missing} missing on disk`
                      : `${stats.libraries} ${stats.libraries === 1 ? 'library' : 'libraries'} · all present`
                  }
                  tone={stats.missing > 0 ? 'warn' : 'neutral'}
                />
              </>
            ) : (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px] rounded-2xl" />)
            )}
          </div>
        </div>
        <div>
          <SectionHeading title="System" />
          <ResourceChart />
        </div>
      </section>

      {watching?.number != null && (
        <Suspense fallback={null}>
          <ChannelPreview
            key={watching.id}
            number={watching.number}
            name={watching.name}
            logoId={watching.logoId}
            nowPlaying={nowRows[watching.id]?.now ?? null}
            onClose={() => setWatching(null)}
          />
        </Suspense>
      )}
      {detailId != null && <MediaDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
