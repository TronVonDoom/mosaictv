import { useEffect, useState } from 'react'
import { api, formatDuration, type Health, type Stats } from '../lib/api'

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
  const [reachable, setReachable] = useState<boolean | null>(null)

  useEffect(() => {
    const load = () => {
      Promise.all([api.health(), api.stats()])
        .then(([h, s]) => {
          setHealth(h)
          setStats(s)
          setReachable(true)
        })
        .catch(() => setReachable(false))
    }
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Dashboard</h1>
      <p className="text-slate-400 text-sm mb-6">
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
          {reachable ? 'MeSatzTV is alive' : reachable === false ? 'Backend unreachable' : 'Connecting…'}
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

      {stats && stats.libraries === 0 && (
        <div className="mt-6 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5 text-sm text-slate-300">
          No libraries yet. Head to <span className="text-indigo-300 font-medium">Libraries</span> to
          add a folder (like <code className="text-slate-400">/media/TV</code>) and scan it.
        </div>
      )}
    </div>
  )
}
