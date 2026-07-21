import LogoManager from '../components/LogoManager'
import AssetManager from '../components/AssetManager'
import FillerManager from '../components/FillerManager'
import { InfoHint, PageHeader, Tabs } from '../components/ui'
import { useHashTab } from '../lib/hooks'
import type { ReactNode } from 'react'

// Formerly "Media", which collided with the media in your *library*. This page
// is the station's own kit — the things the channels play around your content.
const TABS = [
  { id: 'images', label: 'Logos', icon: 'image' },
  { id: 'audio', label: 'Audio', icon: 'audio' },
  { id: 'fillers', label: 'Fillers', icon: 'clip' },
] as const

type Tab = (typeof TABS)[number]['id']
const TAB_IDS = TABS.map((t) => t.id)

const DESCRIPTIONS: Record<Tab, ReactNode> = {
  images: (
    <>
      Channel logos and on-screen watermarks. Upload once, then pick them per channel.{' '}
      <InfoHint>
        Each logo carries its own watermark settings — hit <span className="text-ink">Watermark</span>{' '}
        on a logo to tune its size, position, opacity and timing. Logos without their own settings
        fall back to the default under Settings → Watermark.
      </InfoHint>
    </>
  ),
  audio: 'Ambient tracks for intermissions — what plays when a channel is between programmes.',
  fillers: (
    <>
      Short station-ID clips that cover the gaps between scheduled programmes. Assign them from a
      channel's Fillers tab.{' '}
      <InfoHint>
        This is the shared library — a filler deleted here disappears from every channel and block
        using it. Generating a preview is optional: a filler airs whether or not you build one here.
      </InfoHint>
    </>
  ),
}

export default function Studio() {
  // "clips" was the fillers tab before uploads merged into the library, and
  // "#fillers" is linked from the channel editor — keep both landing right.
  const [tab, setTab] = useHashTab<Tab>(TAB_IDS, 'images', { clips: 'fillers', logos: 'images' })

  return (
    <div>
      <PageHeader title="Studio" icon="media" description={DESCRIPTIONS[tab]}>
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </PageHeader>

      {tab === 'images' && <LogoManager />}

      {tab === 'audio' && (
        <AssetManager
          kind="audio"
          accept="audio/*"
          emptyText="No audio uploaded yet. Add ambient tracks to play during intermissions."
          hint="Choose a track on a channel or block filler (channel editor → Fillers) to play it during intermissions."
        />
      )}

      {tab === 'fillers' && (
        <div className="max-w-2xl">
          <FillerManager />
        </div>
      )}
    </div>
  )
}
