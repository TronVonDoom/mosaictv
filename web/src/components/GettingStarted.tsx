import { Link } from 'react-router-dom'
import Icon, { type IconName } from './Icon'
import type { Channel, Stats } from '../lib/api'
import { cx } from './ui'

type Step = { title: string; hint: string; to: string; done: boolean; icon: IconName }

/** A progress ring: the share of setup done, drawn in the brand gradient. */
function Ring({ pct }: { pct: number }) {
  const r = 26
  const c = 2 * Math.PI * r
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="shrink-0 -rotate-90">
      <defs>
        <linearGradient id="gs-ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="55%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="url(#gs-ring)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
        className="transition-[stroke-dashoffset] duration-700"
      />
    </svg>
  )
}

/**
 * The first-run checklist, computed from live data rather than stored progress
 * — so it reflects the instance's actual state, and undoing something (deleting
 * the last channel, say) brings the relevant step back.
 *
 * Returns null once every step is done; the Dashboard renders it above the fold
 * while it's incomplete and nowhere at all afterwards.
 */
export default function GettingStarted({ stats, channels }: { stats: Stats; channels: Channel[] }) {
  const scheduled = channels.some((c) => c.rotationCount + c.blockCount > 0)
  const built = channels.some((c) => c.playoutCount > 0)
  const onAir = channels.some((c) => c.number != null)
  const firstChannel = channels[0]
  const channelPath = firstChannel ? `/channels/${firstChannel.id}` : '/channels'

  const steps: Step[] = [
    { title: 'Add a library', hint: 'Point at a folder under /media', to: '/library#sources', done: stats.libraries > 0, icon: 'folder' },
    { title: 'Scan your media', hint: 'Index shows & movies, then grab TMDB art', to: '/library#sources', done: stats.items > 0, icon: 'libraries' },
    { title: 'Create a channel', hint: 'Name it — the number can wait', to: '/channels', done: channels.length > 0, icon: 'channels' },
    { title: 'Schedule it', hint: 'Collections, then a rotation or time blocks', to: `${channelPath}#schedule`, done: scheduled, icon: 'calendar' },
    { title: 'Build the guide', hint: 'Guide tab → Build', to: `${channelPath}#guide`, done: built, icon: 'guide' },
    { title: 'Go live', hint: 'Give it a number to join the M3U & guide', to: channelPath, done: onAir, icon: 'live' },
  ]
  if (steps.every((s) => s.done)) return null

  const doneCount = steps.filter((s) => s.done).length
  const pct = Math.round((doneCount / steps.length) * 100)
  // The first unfinished step — the only one that's actually actionable, so it
  // gets the accent while the rest stay quiet.
  const nextIndex = steps.findIndex((s) => !s.done)
  const next = steps[nextIndex]

  return (
    <section className="relative overflow-hidden rounded-2xl border border-indigo-500/25 surface-card">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-brand opacity-80" />
      <div
        className="absolute -top-32 -right-24 w-96 h-96 rounded-full blur-3xl opacity-25 pointer-events-none"
        style={{ background: 'radial-gradient(circle, #8b5cf6, transparent 70%)' }}
      />

      <div className="relative p-6">
        <div className="flex items-center gap-5 flex-wrap">
          <div className="relative">
            <Ring pct={pct} />
            <span className="absolute inset-0 grid place-items-center text-[13px] font-semibold tabular-nums">
              {doneCount}/{steps.length}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">
              <span className="text-gradient-brand">Welcome to MosaicTV</span>
            </h2>
            <p className="text-[13.5px] text-ink-muted mt-0.5">
              Six steps from a folder of media to your own live TV channel.
            </p>
          </div>
          {next && (
            <Link
              to={next.to}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-lg text-sm font-medium text-white bg-gradient-to-b from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 glow-brand"
            >
              Next: {next.title}
              <Icon name="chevronRight" size={16} />
            </Link>
          )}
        </div>

        <ol className="mt-6 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title}>
              <Link
                to={s.to}
                className={cx(
                  'group flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors h-full',
                  s.done
                    ? 'border-emerald-500/20 bg-emerald-500/[0.04]'
                    : i === nextIndex
                      ? 'border-indigo-500/50 bg-indigo-500/[0.08] hover:border-indigo-400'
                      : 'border-edge bg-sunken/60 hover:border-edge-strong',
                )}
              >
                <span
                  className={cx(
                    'grid place-items-center w-9 h-9 shrink-0 rounded-lg',
                    s.done
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : i === nextIndex
                        ? 'bg-indigo-500 text-white shadow-[0_6px_20px_-6px_rgb(139_92_246/0.8)]'
                        : 'bg-raised text-ink-faint',
                  )}
                >
                  <Icon name={s.done ? 'check' : s.icon} size={17} />
                </span>
                <span className="min-w-0">
                  <span className={cx('block text-[13.5px] font-medium', s.done ? 'text-ink-muted' : 'text-ink')}>
                    <span className="text-ink-ghost tabular-nums mr-1.5">{i + 1}.</span>
                    {s.title}
                  </span>
                  <span className="block text-[12px] text-ink-faint truncate">{s.hint}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>

        <p className="text-xs text-ink-faint mt-5">
          Then connect Jellyfin, Plex, Emby or VLC with the <span className="text-ink-soft">Connect a player</span>{' '}
          button at the top — or read the{' '}
          <a
            href="https://github.com/TronVonDoom/mosaictv/blob/main/docs/getting-started.md"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-300 hover:text-indigo-200"
          >
            Getting Started guide
          </a>
          .
        </p>
      </div>
    </section>
  )
}
