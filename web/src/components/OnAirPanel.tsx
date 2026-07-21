import { Link } from 'react-router-dom'
import TimelineView from './TimelineView'
import { logoImageUrl, type Channel, type Playout } from '../lib/api'
import { Card, EmptyState, buttonClass, cx } from './ui'

/**
 * The live guide for every channel that has a number — the one thing an
 * established instance opens the Dashboard to see, so it sits above the stats
 * rather than below them.
 *
 * `guides` is keyed by channel id and fills in asynchronously; a channel whose
 * guide hasn't arrived yet keeps its row and shows why it's empty, rather than
 * vanishing and reflowing the page when the fetch lands.
 */
export default function OnAirPanel({
  channels,
  guides,
}: {
  channels: Channel[]
  guides: Record<number, Playout>
}) {
  if (channels.length === 0) {
    return (
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
    )
  }

  return (
    <Card className="divide-y divide-edge/60 overflow-hidden">
      {channels.map((c) => {
        const g = guides[c.id]
        const logo = c.logoId ? logoImageUrl(c.logoId) : '/mosaictv-icon.png'
        return (
          <div key={c.id} className="p-3">
            <div className="flex items-center gap-3 mb-2 px-1">
              <span className="font-mono text-indigo-300 shrink-0 tabular-nums">{c.number}</span>
              <Link
                to={`/channels/${c.id}#guide`}
                className="font-medium hover:text-indigo-300 transition-colors truncate"
              >
                {c.name}
              </Link>
              <span
                className={cx(
                  'flex-1 min-w-0 truncate text-sm',
                  c.nowPlaying ? 'text-ink-muted' : 'text-ink-ghost italic',
                )}
              >
                {c.nowPlaying
                  ? `▶ ${c.nowPlaying}`
                  : c.playoutCount > 0
                    ? 'nothing airing right now'
                    : 'guide not built'}
              </span>
              {c.viewers > 0 && (
                <span
                  className="shrink-0 inline-flex items-center gap-1.5 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-full px-2.5 py-0.5"
                  title={`${c.viewers} ${c.viewers === 1 ? 'viewer' : 'viewers'} watching`}
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-400 pulse-live" />
                  {c.viewers}
                </span>
              )}
            </div>

            {g && g.items.length > 0 ? (
              <TimelineView playout={g} logo={logo} />
            ) : (
              <div className="text-xs text-ink-ghost px-1 py-3">
                {c.playoutCount > 0 ? (
                  'Loading guide…'
                ) : (
                  <>
                    Guide not built yet —{' '}
                    <Link to={`/channels/${c.id}#guide`} className="text-indigo-300 hover:text-indigo-200">
                      open the channel and Build
                    </Link>
                    .
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </Card>
  )
}
