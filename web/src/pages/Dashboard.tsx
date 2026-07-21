import { useCallback, useEffect, useState } from 'react'
import GettingStarted from '../components/GettingStarted'
import OnAirPanel from '../components/OnAirPanel'
import ResourceChart from '../components/ResourceChart'
import { api, type Channel, type Health, type Playout, type Stats } from '../lib/api'
import { formatDuration } from '../lib/format'
import { usePolling } from '../lib/hooks'
import { PageHeader, Skeleton, StatTile, cx } from '../components/ui'

/** The backend connection state, shown as a dot + label in the page header. */
function HealthChip({ reachable, health }: { reachable: boolean | null; health: Health | null }) {
  const tone =
    reachable === null
      ? { dot: 'bg-amber-400', text: 'Connecting…' }
      : reachable
        ? { dot: 'bg-emerald-400', text: 'MosaicTV is alive' }
        : { dot: 'bg-rose-500', text: 'Backend unreachable' }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-edge bg-surface/60 px-3 py-2">
      <span className={cx('inline-block w-2.5 h-2.5 rounded-full shrink-0', tone.dot)} />
      <span className="text-sm font-medium">{tone.text}</span>
      {health && (
        <span className="text-ink-faint text-xs border-l border-edge pl-3 hidden sm:block">
          v{health.version} · Node {health.node} · ffmpeg{' '}
          <span className={health.ffmpeg ? 'text-emerald-400' : 'text-rose-400'}>
            {health.ffmpeg ? 'ok' : 'missing'}
          </span>
        </span>
      )}
    </div>
  )
}

export default function Dashboard() {
  const [health, setHealth] = useState<Health | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [reachable, setReachable] = useState<boolean | null>(null)
  const [guides, setGuides] = useState<Record<number, Playout>>({})

  const load = useCallback(() => {
    Promise.all([api.health(), api.stats(), api.channels()])
      .then(([h, s, c]) => {
        setHealth(h)
        setStats(s)
        setChannels(c)
        setReachable(true)
      })
      .catch(() => setReachable(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])
  usePolling(load, 5000)

  const onAir = channels.filter((c) => c.number != null)
  // Fetch each on-air channel's guide once the set of on-air channels changes
  // (not on the 5s stats poll — guides are heavier and change slowly).
  const onAirKey = onAir.map((c) => c.id).join(',')
  useEffect(() => {
    let cancelled = false
    Promise.all(
      onAir.map((c) => api.playout(c.id, 24).then((p) => [c.id, p] as const).catch(() => null)),
    ).then((entries) => {
      if (cancelled) return
      const map: Record<number, Playout> = {}
      for (const e of entries) if (e) map[e[0]] = e[1]
      setGuides(map)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onAirKey])

  const loading = stats == null && reachable !== false

  return (
    <div>
      <PageHeader
        title="Dashboard"
        icon="dashboard"
        description="Your library. Your channels. Broadcasting live."
        actions={<HealthChip reachable={reachable} health={health} />}
      />

      <div className="space-y-6">
        {/* On a fresh instance the checklist is the point of this page, so it
            leads. It returns null once every step is done, and the live guide
            takes over the top slot for good. */}
        {stats && <GettingStarted stats={stats} channels={channels} />}

        <section>
          <h2 className="font-semibold mb-3">
            On air <span className="text-ink-faint font-normal text-sm">— live guide</span>
          </h2>
          {loading ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : (
            <OnAirPanel channels={onAir} guides={guides} />
          )}
        </section>

        <section>
          <h2 className="font-semibold mb-3">Library at a glance</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
            {stats ? (
              <>
                <StatTile icon="libraries" label="Libraries" value={stats.libraries} />
                <StatTile
                  icon="browse"
                  label="Indexed media"
                  value={stats.items}
                  sub={stats.missing > 0 ? `${stats.missing} missing` : 'all files present'}
                  tone={stats.missing > 0 ? 'warn' : 'neutral'}
                />
                <StatTile icon="show" label="Episodes" value={stats.byType.episode ?? 0} />
                <StatTile icon="movie" label="Movies" value={stats.byType.movie ?? 0} />
                <StatTile icon="clip" label="Other clips" value={stats.byType.other ?? 0} />
                <StatTile
                  icon="clock"
                  label="Total runtime"
                  value={formatDuration(stats.totalDurationSec)}
                  sub="across all indexed media"
                />
              </>
            ) : (
              Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[88px] rounded-xl" />)
            )}
          </div>
        </section>

        <section>
          <ResourceChart />
        </section>
      </div>
    </div>
  )
}
