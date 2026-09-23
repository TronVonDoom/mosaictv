import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, type ChannelDetail, type ChannelNow, type Collection } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { toast } from '../lib/toast'
import { useHashTab, useNow, usePolling, type DraftCache } from '../lib/hooks'
import { formatClock, formatRemaining } from '../lib/format'
import ChannelLogo from '../components/ChannelLogo'
import { ProgramArt } from '../components/ChannelCard'
import Icon from '../components/Icon'
import CollectionManager from '../components/CollectionManager'
import GeneralTab from '../components/channel/GeneralTab'
import ScheduleTab from '../components/channel/ScheduleTab'
import FillersTab from '../components/channel/FillersTab'
import GuideTab from '../components/channel/GuideTab'
import { Badge, Banner, Breadcrumbs, Button, LiveBadge, ProgressBar, Skeleton, Tabs } from '../components/ui'

// hls.js is only needed once a preview is actually opened.
const ChannelPreview = lazy(() => import('../components/ChannelPreview'))

const TAB_IDS = ['general', 'collections', 'schedule', 'fillers', 'guide'] as const
type Tab = (typeof TAB_IDS)[number]

/**
 * The channel editor is a shell: it owns the channel it's editing, the single
 * error banner, and the `guard` wrapper that every mutation goes through. Each
 * tab lives in its own component under components/channel and keeps its own
 * form state, which is what stopped this file from being 600 lines of five
 * unrelated forms sharing one scope.
 */
export default function ChannelEditor() {
  const { id } = useParams()
  const channelId = Number(id)

  const [ch, setCh] = useState<ChannelDetail | null>(null)
  const [cols, setCols] = useState<Collection[]>([])
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useHashTab<Tab>(TAB_IDS, 'general')
  const [now, setNow] = useState<ChannelNow | null>(null)
  const [watching, setWatching] = useState(false)
  const nowMs = useNow(15000)

  // In-progress form values for the tabs, held here so they survive a tab
  // unmounting — and die when you leave the channel. See useDraft.
  const drafts = useRef<DraftCache>(new Map()).current

  const load = useCallback(() => api.channel(channelId).then(setCh).catch(() => {}), [channelId])
  const loadCols = useCallback(
    () => api.collections(channelId).then(setCols).catch(() => {}),
    [channelId],
  )

  useEffect(() => {
    load()
    loadCols()
  }, [load, loadCols])

  // What's on air right now, for the header.
  const loadNow = useCallback(
    () =>
      api
        .channelsNow()
        .then((rows) => setNow(rows.find((r) => r.channelId === channelId) ?? null))
        .catch(() => {}),
    [channelId],
  )
  useEffect(() => {
    loadNow()
  }, [loadNow])
  usePolling(loadNow, 20000)

  /** Run a mutation, refresh the channel, and route any failure to the banner. */
  const guard = useCallback(
    async <T,>(fn: () => Promise<T>, successMsg?: string) => {
      setError(null)
      try {
        await fn()
        await load()
        if (successMsg) toast.success(successMsg)
      } catch (err) {
        setError(errorMessage(err, 'Something went wrong'))
      }
    },
    [load],
  )

  if (!ch) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  const tabs = [
    { id: 'general', label: 'General', icon: 'settings' } as const,
    { id: 'collections', label: 'Collections', icon: 'browse', badge: cols.length || undefined } as const,
    {
      id: 'schedule',
      label: 'Schedule',
      icon: 'clock',
      badge: ch.rotationItems.length + ch.timeBlocks.length || undefined,
    } as const,
    { id: 'fillers', label: 'Fillers', icon: 'clip' } as const,
    { id: 'guide', label: 'Guide', icon: 'xmltv' } as const,
  ]

  const unit = ch.number != null ? now?.now ?? null : null
  const progress = unit
    ? (nowMs - new Date(unit.startTime).getTime()) /
      Math.max(1, new Date(unit.stopTime).getTime() - new Date(unit.startTime).getTime())
    : 0

  return (
    <div>
      <div className="mb-4">
        <Breadcrumbs items={[{ label: 'Channels', to: '/channels' }, { label: ch.name }]} />
      </div>

      {/* Identity + what's on air */}
      <header className="relative overflow-hidden rounded-2xl border border-edge surface-card mb-6">
        {unit && (
          <div className="absolute inset-y-0 right-0 w-full md:w-3/5 opacity-60 pointer-events-none mask-fade-b [mask-image:linear-gradient(to_right,transparent,black_45%)]">
            <ProgramArt unit={unit} logoId={ch.logoId} name={ch.name} />
          </div>
        )}
        <div className="relative flex items-center gap-5 p-5 flex-wrap">
          <ChannelLogo logoId={ch.logoId} name={ch.name} size={72} className="rounded-2xl" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2.5 flex-wrap">
              {ch.number != null ? (
                <span className="font-mono text-[15px] font-semibold text-indigo-300 tabular-nums">{ch.number}</span>
              ) : (
                <Badge title="Give this channel a number to put it on air">Draft</Badge>
              )}
              <h1 className="text-[26px] font-semibold tracking-[-0.02em] leading-tight truncate">{ch.name}</h1>
              {ch.group && <Badge tone="neutral">{ch.group}</Badge>}
              {unit ? <LiveBadge /> : ch.number != null ? <Badge tone="warn" dot>Off air</Badge> : null}
              {(now?.viewers ?? 0) > 0 && (
                <Badge tone="live">
                  <Icon name="eye" size={12} /> {now!.viewers} watching
                </Badge>
              )}
            </div>
            {unit ? (
              <div className="mt-2 max-w-xl">
                <div className="text-[13.5px] text-ink-soft truncate">
                  <span className="text-ink-faint">Now · </span>
                  <span className="font-medium text-ink">{unit.title}</span>
                  {unit.subtitle && <span className="text-ink-muted"> · {unit.subtitle}</span>}
                </div>
                <div className="flex items-center gap-3 mt-2">
                  <ProgressBar value={progress} tone="live" className="flex-1 max-w-72" />
                  <span className="text-[11.5px] text-ink-faint tabular-nums whitespace-nowrap">
                    {formatClock(unit.startTime)} – {formatClock(unit.stopTime)} · {formatRemaining(new Date(unit.stopTime).getTime() - nowMs)}
                  </span>
                </div>
              </div>
            ) : (
              <p className="mt-1.5 text-[13.5px] text-ink-muted">
                {ch.number == null
                  ? 'A draft — hidden from players until you give it a number on the General tab.'
                  : ch.rotationItems.length + ch.timeBlocks.length === 0
                    ? 'Nothing scheduled yet — add collections, then a rotation or time blocks.'
                    : 'Nothing airing this minute.'}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {ch.number != null && (
              <Button variant="secondary" icon="play" onClick={() => setWatching(true)}>
                Watch
              </Button>
            )}
            <Button variant="secondary" icon="guide" onClick={() => setTab('guide')}>
              Guide
            </Button>
          </div>
        </div>
      </header>

      <Tabs tabs={tabs} active={tab} onChange={setTab} className="mb-6" />

      {error && <Banner className="mb-5">{error}</Banner>}

      {tab === 'general' && <GeneralTab channelId={channelId} ch={ch} guard={guard} drafts={drafts} />}

      {tab === 'collections' && <CollectionManager channelId={channelId} onChange={loadCols} />}

      {tab === 'schedule' && (
        <ScheduleTab channelId={channelId} ch={ch} guard={guard} drafts={drafts} cols={cols} onError={setError} />
      )}

      {tab === 'fillers' && (
        <FillersTab
          channelId={channelId}
          ch={ch}
          guard={guard}
          onGoToSchedule={() => setTab('schedule')}
        />
      )}

      {tab === 'guide' && (
        <GuideTab channelId={channelId} ch={ch} onReload={load} onError={setError} />
      )}

      {watching && ch.number != null && (
        <Suspense fallback={null}>
          <ChannelPreview
            number={ch.number}
            name={ch.name}
            logoId={ch.logoId}
            nowPlaying={unit}
            onClose={() => setWatching(false)}
          />
        </Suspense>
      )}
    </div>
  )
}
