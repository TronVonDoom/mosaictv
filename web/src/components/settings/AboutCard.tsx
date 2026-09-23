import { useEffect, useState } from 'react'
import { api, type Health, type Stats } from '../../lib/api'
import Icon from '../Icon'
import { Card, CardHeader } from '../ui'

const REPO = 'https://github.com/TronVonDoom/mosaictv'

function uptime(s: number): string {
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** What's running, and where the manual is. */
export default function AboutCard() {
  const [health, setHealth] = useState<Health | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  useEffect(() => {
    api.health().then(setHealth).catch(() => {})
    api.stats().then(setStats).catch(() => {})
  }, [])

  const rows: [string, string][] = [
    ['Version', health ? `v${health.version}` : '—'],
    ['Uptime', health ? uptime(health.uptimeSeconds) : '—'],
    ['Node.js', health?.node ?? '—'],
    ['ffmpeg', health ? (health.ffmpeg ? 'Available' : 'Not found') : '—'],
    ['Libraries', stats ? String(stats.libraries) : '—'],
    ['Indexed files', stats ? stats.items.toLocaleString() : '—'],
  ]
  const links: [string, string][] = [
    ['Documentation', `${REPO}/tree/main/docs`],
    ['Release notes', `${REPO}/blob/main/CHANGELOG.md`],
    ['Troubleshooting', `${REPO}/blob/main/docs/troubleshooting.md`],
  ]

  return (
    <Card className="p-6">
      <div className="flex items-center gap-3 mb-5">
        <img src="/logo-icon.png" alt="" className="w-11 h-11 drop-shadow-[0_6px_16px_rgb(139_92_246/0.45)]" />
        <div>
          <div className="text-[17px] font-semibold tracking-tight">
            Mosaic<span className="text-gradient-brand">TV</span>
          </div>
          <div className="text-[12.5px] text-ink-muted">Your media. Your channels.</div>
        </div>
      </div>
      <CardHeader title="About this instance" className="mb-3" />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-edge bg-sunken/50 p-4">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{k}</dt>
            <dd className={`mt-0.5 text-[13px] tabular-nums ${v === 'Not found' ? 'text-rose-300' : 'text-ink-soft'}`}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 space-y-1">
        {links.map(([label, href]) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-lg px-2.5 py-2 -mx-1 text-[13px] text-ink-soft hover:bg-white/[0.04] hover:text-ink"
          >
            {label}
            <Icon name="external" size={14} className="text-ink-faint" />
          </a>
        ))}
      </div>
    </Card>
  )
}
