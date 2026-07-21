import { useCallback, useEffect, useState } from 'react'
import { api, type Playout } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { programLabel } from '../../lib/format'
import TimelineView from '../TimelineView'
import { Button, Card, EmptyState, InfoHint, Skeleton, cx } from '../ui'
import type { ChannelTabProps } from './types'

function fmtClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fmtDur(sec: number | null): string {
  if (!sec) return ''
  const m = Math.round(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

/** The built schedule: a 24h timeline or a running list, plus the controls that
 *  build, rebuild, and restart it. */
export default function GuideTab({
  channelId,
  ch,
  onReload,
  onError,
}: Omit<ChannelTabProps, 'guard' | 'drafts'> & {
  onReload: () => void
  onError: (msg: string | null) => void
}) {
  const [playout, setPlayout] = useState<Playout | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'timeline' | 'list'>('timeline')
  const [building, setBuilding] = useState(false)

  const hasSchedule = ch.rotationItems.length > 0 || ch.timeBlocks.length > 0

  const loadPlayout = useCallback(
    () =>
      api
        .playout(channelId, 24)
        .then(setPlayout)
        .catch(() => {})
        .finally(() => setLoading(false)),
    [channelId],
  )

  useEffect(() => {
    loadPlayout()
  }, [loadPlayout])

  /** Run a build-ish action, keeping the button state and errors in one place. */
  async function run(fn: () => Promise<unknown>, fallback: string) {
    onError(null)
    setBuilding(true)
    try {
      await fn()
      onReload()
      await loadPlayout()
    } catch (err) {
      onError(errorMessage(err, fallback))
    } finally {
      setBuilding(false)
    }
  }

  const build = () => run(() => api.buildPlayout(channelId, 48), 'Build failed')

  const reset = (hard = false) => {
    if (
      hard &&
      !confirm(
        'Restart every show/rotation from the beginning? This loses all saved playback positions on this channel.',
      )
    )
      return
    return run(async () => {
      await api.resetPlayout(channelId, hard)
      await api.buildPlayout(channelId, 48)
    }, 'Reset failed')
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold">Guide preview</h2>
          <div className="flex rounded-lg border border-edge-strong overflow-hidden text-xs">
            {(['timeline', 'list'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                aria-pressed={view === v}
                className={cx(
                  'px-2.5 py-1 capitalize transition-colors',
                  view === v ? 'bg-indigo-500/20 text-indigo-200' : 'text-ink-muted hover:text-ink-soft',
                )}
              >
                {v}
              </button>
            ))}
          </div>
          <InfoHint>
            The guide is generated ahead of time, 48 hours at a stretch. It's what the XMLTV feed
            publishes and what the channel actually plays.
          </InfoHint>
        </div>

        <div className="flex gap-2">
          <Button onClick={build} disabled={building || !hasSchedule}>
            {building ? 'Building…' : 'Build 48h'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => reset(false)}
            disabled={building || !hasSchedule}
            title="Clears the schedule and rebuilds — shows continue where they left off"
            className="hover:border-amber-500/60 hover:text-amber-300"
          >
            Rebuild
          </Button>
          <Button
            variant="subtle"
            onClick={() => reset(true)}
            disabled={building || !hasSchedule}
            title="Restart every show from episode 1"
          >
            Restart from S1E1
          </Button>
        </div>
      </div>

      {!hasSchedule ? (
        <EmptyState
          icon="clock"
          title="Nothing scheduled yet"
          description="Add a rotation item or a time block on the Schedule tab, then build the guide here."
        />
      ) : loading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !playout || playout.items.length === 0 ? (
        <EmptyState
          icon="upnext"
          title="No guide built yet"
          description="Build 48 hours of schedule to see what this channel will play — and to publish it to the XMLTV guide."
          action={
            <Button onClick={build} disabled={building}>
              {building ? 'Building…' : 'Build 48h'}
            </Button>
          }
        />
      ) : view === 'timeline' ? (
        <TimelineView playout={playout} />
      ) : (
        <div className="divide-y divide-edge/60">
          {playout.items.slice(0, 60).map((it, i) => {
            const isNow =
              new Date(it.startTime) <= new Date(playout.now) &&
              new Date(it.stopTime) > new Date(playout.now)
            return (
              <div
                key={it.id}
                className={cx('flex items-center gap-3 py-2 text-sm', isNow && 'text-indigo-200')}
              >
                <span className="font-mono text-xs text-ink-faint w-16 shrink-0 tabular-nums">
                  {fmtClock(it.startTime)}
                </span>
                {isNow && (
                  <span className="text-[10px] bg-indigo-500/20 text-indigo-300 rounded px-1.5 py-0.5 shrink-0">
                    NOW
                  </span>
                )}
                <span
                  className={cx(
                    'flex-1 min-w-0 truncate',
                    !it.mediaItem && 'text-ink-faint italic',
                  )}
                >
                  {it.mediaItem
                    ? programLabel(it.mediaItem, { withTitle: true })
                    : it.title || 'Station ID'}
                </span>
                <span className="text-xs text-ink-ghost shrink-0 tabular-nums">
                  {fmtDur(
                    it.mediaItem?.durationSec ??
                      (new Date(it.stopTime).getTime() - new Date(it.startTime).getTime()) / 1000,
                  )}
                </span>
                {i === 0 && !isNow && <span className="text-[10px] text-ink-ghost shrink-0">next</span>}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
