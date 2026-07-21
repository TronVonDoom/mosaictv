import { Link } from 'react-router-dom'
import Icon from './Icon'
import type { Channel, Stats } from '../lib/api'
import { cx } from './ui'

type Step = { title: string; hint: string; to: string; done: boolean }

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
    { title: 'Add a library', hint: 'Point at a folder under /media', to: '/library#sources', done: stats.libraries > 0 },
    { title: 'Scan your media', hint: 'Index shows & movies (grab TMDB posters after)', to: '/library#sources', done: stats.items > 0 },
    { title: 'Create a channel', hint: 'Name it — leave the number blank for now', to: '/channels', done: channels.length > 0 },
    { title: 'Schedule it', hint: 'Add collections, then a rotation or time blocks', to: channelPath, done: scheduled },
    { title: 'Build the guide', hint: 'Guide tab → Build 48h to generate the timeline', to: channelPath, done: built },
    { title: 'Go live', hint: 'Give the channel a number — it joins the M3U & guide', to: channelPath, done: onAir },
  ]
  if (steps.every((s) => s.done)) return null

  const doneCount = steps.filter((s) => s.done).length
  const pct = Math.round((doneCount / steps.length) * 100)
  // The first unfinished step — the only one that's actually actionable, so it
  // gets the accent while the rest stay quiet.
  const nextIndex = steps.findIndex((s) => !s.done)

  return (
    <section className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h2 className="font-semibold text-lg flex items-center gap-2">
          <Icon name="channels" size={19} colored />
          <span className="text-gradient-brand">Let's get started!</span>
        </h2>
        <span className="text-xs text-ink-muted tabular-nums">
          {doneCount} / {steps.length} done
        </span>
      </div>
      <p className="text-ink-muted text-sm mb-3">Six steps from empty to your own live TV channel.</p>

      <div className="h-1.5 rounded-full bg-raised overflow-hidden mb-4">
        <div
          className="h-full bg-gradient-brand transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ol className="space-y-1.5">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Link
              to={s.to}
              className={cx(
                'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors',
                s.done
                  ? 'border-emerald-500/20 bg-emerald-500/5 text-ink-faint'
                  : i === nextIndex
                    ? 'border-indigo-500/50 bg-surface/80 hover:border-indigo-400'
                    : 'border-edge bg-surface/60 hover:border-indigo-500/50',
              )}
            >
              <span
                className={cx(
                  'w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold',
                  s.done
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : i === nextIndex
                      ? 'bg-indigo-500 text-white'
                      : 'bg-raised text-ink-muted',
                )}
              >
                {s.done ? '✓' : i + 1}
              </span>
              <span className={cx('font-medium', s.done && 'line-through decoration-ink-ghost')}>
                {s.title}
              </span>
              {i === nextIndex && (
                <span className="text-[10px] uppercase tracking-wider text-indigo-300 shrink-0">
                  next
                </span>
              )}
              <span className="text-xs text-ink-faint truncate ml-auto hidden sm:block">{s.hint}</span>
            </Link>
          </li>
        ))}
      </ol>

      <p className="text-xs text-ink-faint mt-3">
        Then point Jellyfin, Plex (via Threadfin), or VLC at the M3U + XMLTV links in the sidebar — full
        walkthrough in the{' '}
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
    </section>
  )
}
