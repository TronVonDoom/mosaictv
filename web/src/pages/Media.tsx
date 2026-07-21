import { useState } from 'react'
import Logos from './Logos'
import AssetManager from '../components/AssetManager'
import FillerManager from '../components/FillerManager'
import Icon, { type IconName } from '../components/Icon'

type Tab = 'images' | 'audio' | 'fillers'
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'images', label: 'Logos / Images', icon: 'image' },
  { id: 'audio', label: 'Audio', icon: 'audio' },
  { id: 'fillers', label: 'Fillers', icon: 'clip' },
]

export default function Media() {
  // Deep-linkable tab (the channel editor links straight to #fillers).
  // "clips" was a separate tab for filler uploads before they merged into the
  // library; keep the old anchor working rather than dumping people on Images.
  const [tab, setTabState] = useState<Tab>(() => {
    const h = window.location.hash.replace('#', '')
    if (h === 'clips') return 'fillers'
    return TABS.some((t) => t.id === h) ? (h as Tab) : 'images'
  })
  const setTab = (t: Tab) => {
    setTabState(t)
    window.location.hash = t
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Media</h1>
      <p className="text-slate-400 text-sm mb-5">
        Everything the channels draw on besides your library: logo/watermark images, ambient audio for
        intermissions, and the station-ID fillers that cover the gaps.
      </p>

      <div className="flex gap-1 border-b border-slate-800 mb-6">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              'px-4 py-2 text-sm rounded-t-lg border-b-2 -mb-px transition-colors ' +
              (tab === t.id
                ? 'border-indigo-400 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200')
            }
          >
            <Icon name={t.icon} size={15} className="inline-block mr-1.5 align-[-2px]" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'images' && <Logos embedded />}
      {tab === 'audio' && (
        <AssetManager
          kind="audio"
          accept="audio/*"
          emptyText="No audio uploaded yet. Add ambient tracks to play during intermissions."
          hint="Pick a track in a channel or block filler (channel editor → Fillers) to play it during intermissions."
        />
      )}
      {tab === 'fillers' && (
        <div className="max-w-2xl">
          <p className="text-slate-400 text-sm mb-3">
            The shared library of station-ID fillers — upload your own clip or have one generated from a
            channel's logo. Assign them to channels or blocks from a channel's
            <span className="text-slate-300"> Fillers</span> tab, which can also create one on the spot.
            Generating is only for previewing; a filler plays whether or not you build a preview here.
            Deleting one removes it everywhere it's used.
          </p>
          <FillerManager />
        </div>
      )}
    </div>
  )
}
