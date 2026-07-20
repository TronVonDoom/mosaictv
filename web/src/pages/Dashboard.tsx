import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import { api, formatDuration, type Channel, type Health, type Stats } from '../lib/api'

type Step = { title: string; hint: string; to: string; done: boolean }

// First-run checklist: computed from live data, disappears once the setup
// flow is complete (library → scan → channel → schedule → guide → on air).
function GettingStarted({ stats, channels }: { stats: Stats; channels: Channel[] }) {
  const scheduled = channels.some((c) => c.rotationCount + c.blockCount > 0)
  const built = channels.some((c) => c.playoutCount > 0)
  const onAir = channels.some((c) => c.number != null)
  const firstChannel = channels[0]
  const channelPath = firstChannel ? `/channels/${firstChannel.id}` : '/channels'

  const steps: Step[] = [
    { title: 'Add a library', hint: 'Point at a folder under /media', to: '/libraries', done: stats.libraries > 0 },
    { title: 'Scan your media', hint: 'Index shows & movies (grab TMDB posters after)', to: '/libraries', done: stats.items > 0 },
    { title: 'Create a channel', hint: 'Name it — leave the number blank for now', to: '/channels', done: channels.length > 0 },
    { title: 'Schedule it', hint: 'Add collections, then a rotation or time blocks', to: channelPath, done: scheduled },
    { title: 'Build the guide', hint: 'Guide tab → Build 48h to generate the timeline', to: channelPath, done: built },
    { title: 'Go live', hint: 'Give the channel a number — it joins the M3U & guide', to: channelPath, done: onAir },
  ]
  if (steps.every((s) => s.done)) return null
  const doneCount = steps.filter((s) => s.done).length

  return (
    <div className="mt-6 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Icon name="channels" size={19} colored />
          <span className="text-gradient-brand">Let's get started!</span>
        </h2>
        <span className="text-xs text-slate-400">{doneCount} / {steps.length} done</span>
      </div>
      <p className="text-slate-400 text-sm mb-4">
        Six steps from empty to your own live TV channel.
      </p>
      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Link
              to={s.to}
              className={
                'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ' +
                (s.done
                  ? 'border-emerald-500/20 bg-emerald-500/5 text-slate-500'
                  : 'border-slate-800 bg-slate-900/60 hover:border-indigo-500/50')
              }
            >
              <span
                className={
                  'w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ' +
                  (s.done ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400')
                }
              >
                {s.done ? '✓' : i + 1}
              </span>
              <span className={'font-medium ' + (s.done ? 'line-through decoration-slate-600' : '')}>{s.title}</span>
              <span className="text-xs text-slate-500 truncate ml-auto">{s.hint}</span>
            </Link>
          </li>
        ))}
      </ol>
      <p className="text-xs text-slate-500 mt-3">
        Then point Jellyfin, Plex (via Threadfin), or VLC at the M3U + XMLTV links on the{' '}
        <Link to="/channels" className="text-indigo-300">Channels</Link> page — full walkthrough in the{' '}
        <a
          href="https://github.com/TronVonDoom/mosaictv/blob/main/docs/getting-started.md"
          target="_blank"
          rel="noreferrer"
          className="text-indigo-300"
        >
          Getting Started guide
        </a>.
      </p>
    </div>
  )
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="text-slate-400 text-xs uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-slate-500 text-xs mt-1">{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const [health, setHealth] = useState<Health | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [reachable, setReachable] = useState<boolean | null>(null)

  useEffect(() => {
    const load = () => {
      Promise.all([api.health(), api.stats(), api.channels()])
        .then(([h, s, c]) => {
          setHealth(h)
          setStats(s)
          setChannels(c)
          setReachable(true)
        })
        .catch(() => setReachable(false))
    }
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  const onAir = channels.filter((c) => c.number != null)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-sm mb-6 font-medium text-gradient-brand inline-block">
        Your library. Your channels. Broadcasting live.
      </p>

      <div className="flex items-center gap-3 mb-6">
        <span
          className={
            'inline-block w-2.5 h-2.5 rounded-full ' +
            (reachable
              ? 'bg-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.6)]'
              : reachable === false
                ? 'bg-rose-500'
                : 'bg-amber-400')
          }
        />
        <span className="font-medium">
          {reachable ? 'MosaicTV is alive' : reachable === false ? 'Backend unreachable' : 'Connecting…'}
        </span>
        {health && (
          <span className="text-slate-500 text-sm ml-auto">
            v{health.version} · Node {health.node} · ffmpeg{' '}
            <span className={health.ffmpeg ? 'text-emerald-400' : 'text-rose-400'}>
              {health.ffmpeg ? 'ok' : 'missing'}
            </span>
          </span>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card label="Libraries" value={String(stats.libraries)} />
          <Card
            label="Indexed media"
            value={String(stats.items)}
            sub={stats.missing > 0 ? `${stats.missing} missing` : undefined}
          />
          <Card label="Episodes" value={String(stats.byType.episode ?? 0)} />
          <Card label="Movies" value={String(stats.byType.movie ?? 0)} />
          <Card
            label="Total runtime"
            value={formatDuration(stats.totalDurationSec)}
            sub="across all indexed media"
          />
          <Card label="Other clips" value={String(stats.byType.other ?? 0)} />
        </div>
      )}

      {onAir.length > 0 && (
        <div className="mt-6">
          <h2 className="font-semibold mb-3">On air</h2>
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 divide-y divide-slate-800/60">
            {onAir.map((c) => (
              <Link key={c.id} to={`/channels/${c.id}#guide`} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-800/40 transition-colors">
                <span className="font-mono text-indigo-300 w-10 shrink-0">{c.number}</span>
                <span className="font-medium w-44 shrink-0 truncate">{c.name}</span>
                <span className={'flex-1 min-w-0 truncate ' + (c.nowPlaying ? 'text-slate-300' : 'text-slate-600 italic')}>
                  {c.nowPlaying ? `▶ ${c.nowPlaying}` : c.playoutCount > 0 ? 'nothing airing right now' : 'guide not built'}
                </span>
                {c.viewers > 0 && (
                  <span className="shrink-0 inline-flex items-center gap-1.5 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-full px-2.5 py-0.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                    {c.viewers}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}

      {stats && <GettingStarted stats={stats} channels={channels} />}
    </div>
  )
}
