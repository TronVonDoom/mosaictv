import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type ChannelDetail, type Collection } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { toast } from '../lib/toast'
import { useHashTab, type DraftCache } from '../lib/hooks'
import CollectionManager from '../components/CollectionManager'
import GeneralTab from '../components/channel/GeneralTab'
import ScheduleTab from '../components/channel/ScheduleTab'
import FillersTab from '../components/channel/FillersTab'
import GuideTab from '../components/channel/GuideTab'
import { Badge, Banner, Skeleton, Tabs } from '../components/ui'

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

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-ink-faint mb-1">
        <Link to="/channels" className="hover:text-indigo-300">
          Channels
        </Link>
        <span>/</span>
        <span className="text-ink-soft">
          {ch.number != null ? `#${ch.number} ` : ''}
          {ch.name}
        </span>
      </div>

      <h1 className="text-2xl font-bold tracking-tight mb-4 flex items-center gap-2 flex-wrap">
        {ch.number != null ? (
          <span className="font-mono text-indigo-300 tabular-nums">{ch.number}</span>
        ) : (
          <Badge title="Give this channel a number to put it on air">draft</Badge>
        )}
        {ch.name}
      </h1>

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
    </div>
  )
}
