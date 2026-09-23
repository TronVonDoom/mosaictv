import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import GuideGrid from '../components/GuideGrid'
import MediaDetailModal from '../components/MediaDetailModal'
import { api, type Channel, type Playout } from '../lib/api'
import { useNow, usePolling } from '../lib/hooks'
import { Button, EmptyState, PageHeader, Segmented, Skeleton, buttonClass } from '../components/ui'

type Span = '12' | '24' | '48'
type Zoom = 'compact' | 'standard' | 'wide'
const PX: Record<Zoom, number> = { compact: 3.2, standard: 5.5, wide: 9 }

/**
 * The full TV guide — every on-air channel on one time axis, as far ahead as
 * the schedule horizon has been built. The same listings the XMLTV feed hands
 * to Plex and Jellyfin, drawn the way a set-top box draws them.
 */
export default function Guide() {
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [guides, setGuides] = useState<Record<number, Playout>>({})
  const [span, setSpan] = useState<Span>('24')
  const [zoom, setZoom] = useState<Zoom>('standard')
  const [jump, setJump] = useState(0)
  const [detailId, setDetailId] = useState<number | null>(null)
  const nowMs = useNow(30000)

  useEffect(() => {
    api.channels().then(setChannels).catch(() => setChannels([]))
  }, [])

  const onAir = (channels ?? []).filter((c) => c.number != null)
  const key = onAir.map((c) => c.id).join(',')
  const load = useCallback(() => {
    const ids = key ? key.split(',').map(Number) : []
    Promise.all(ids.map((id) => api.playout(id, Number(span) + 1).then((p) => [id, p] as const).catch(() => null))).then(
      (entries) => {
        const map: Record<number, Playout> = {}
        for (const e of entries) if (e) map[e[0]] = e[1]
        setGuides(map)
      },
    )
  }, [key, span])
  useEffect(() => {
    load()
  }, [load])
  usePolling(load, 300000)

  return (
    <div>
      <PageHeader
        title="TV Guide"
        icon="guide"
        description="Everything airing across your channels — the same listings your players receive."
        actions={
          <>
            <Segmented<Span>
              size="sm"
              value={span}
              onChange={setSpan}
              options={[
                { value: '12', label: '12h' },
                { value: '24', label: '24h' },
                { value: '48', label: '48h' },
              ]}
            />
            <Segmented<Zoom>
              size="sm"
              value={zoom}
              onChange={setZoom}
              options={[
                { value: 'compact', label: 'Compact', icon: 'list' },
                { value: 'standard', label: 'Standard', icon: 'grid' },
                { value: 'wide', label: 'Wide', icon: 'layers' },
              ]}
            />
            <Button variant="secondary" size="sm" icon="clock" onClick={() => setJump((j) => j + 1)}>
              Now
            </Button>
          </>
        }
      />

      {channels == null ? (
        <Skeleton className="h-[420px] rounded-2xl" />
      ) : onAir.length === 0 ? (
        <EmptyState
          icon="guide"
          title="No channels on air"
          description="The guide lists channels that have a number. Give one a number and build its schedule, and its listings appear here."
          action={
            <Link to="/channels" className={buttonClass('primary', 'md')}>
              Go to Channels
            </Link>
          }
        />
      ) : (
        <GuideGrid
          channels={onAir}
          guides={guides}
          nowMs={nowMs}
          hours={Number(span)}
          pxPerMin={PX[zoom]}
          rowHeight={zoom === 'compact' ? 52 : 76}
          maxHeight="calc(100vh - 13rem)"
          jump={jump}
          onSelect={(e) => e.mediaItem && setDetailId(e.mediaItem.id)}
        />
      )}

      <p className="mt-3 text-xs text-ink-faint">
        Listings extend as far as each channel's schedule has been built — see Settings → Streaming → Schedule horizon.
      </p>

      {detailId != null && <MediaDetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
