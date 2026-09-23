import { useEffect, useState } from 'react'
import SideNav, { type SideNavItem } from '../components/SideNav'
import LogosStudio from '../components/studio/LogosStudio'
import AudioStudio from '../components/studio/AudioStudio'
import FillersStudio from '../components/studio/FillersStudio'
import { api } from '../lib/api'
import { useHashTab } from '../lib/hooks'
import { PageHeader } from '../components/ui'

// Formerly "Media", which collided with the media in your *library*. This page
// is the station's own kit — the things the channels play around your content.
type Section = 'images' | 'audio' | 'fillers'
const IDS: Section[] = ['images', 'audio', 'fillers']

/**
 * The Studio: an editing suite for the station's branding. A section rail on
 * the left, that section's library in the middle, and an inspector on the
 * right for whatever is selected — the same shape for logos, music and
 * fillers, so each works the same way.
 */
export default function Studio() {
  // "clips" was the fillers tab before uploads merged into the library, and
  // "#fillers" is linked from the channel editor — keep both landing right.
  const [section, setSection] = useHashTab<Section>(IDS, 'images', { clips: 'fillers', logos: 'images' })
  const [counts, setCounts] = useState<Record<Section, number | null>>({ images: null, audio: null, fillers: null })
  const setCount = (s: Section) => (n: number) => setCounts((c) => (c[s] === n ? c : { ...c, [s]: n }))

  // Counts for the rail up front, so every section shows its size before it's opened.
  useEffect(() => {
    api.logos().then((l) => setCount('images')(l.length)).catch(() => {})
    api.assets('audio').then((a) => setCount('audio')(a.length)).catch(() => {})
    api.fillers().then((f) => setCount('fillers')(f.length)).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const items: SideNavItem<Section>[] = [
    { id: 'images', label: 'Logos', icon: 'image', description: 'Channel logos and their watermarks', count: counts.images },
    { id: 'audio', label: 'Audio', icon: 'audio', description: 'Music under station breaks', count: counts.audio },
    { id: 'fillers', label: 'Fillers', icon: 'clip', description: 'Station-ID clips between programs', count: counts.fillers },
  ]

  return (
    <div>
      <PageHeader
        title="Studio"
        icon="media"
        description="Your station's branding kit — the logos, music and station-ID clips your channels play around your content."
      />
      <div className="grid gap-6 grid-cols-[minmax(0,1fr)] lg:grid-cols-[232px_minmax(0,1fr)]">
        <SideNav label="Studio sections" items={items} active={section} onChange={setSection} />
        <div className="min-w-0">
          {section === 'images' && <LogosStudio onCount={setCount('images')} />}
          {section === 'audio' && <AudioStudio onCount={setCount('audio')} />}
          {section === 'fillers' && <FillersStudio onCount={setCount('fillers')} />}
        </div>
      </div>
    </div>
  )
}
