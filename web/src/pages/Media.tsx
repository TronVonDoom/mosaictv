import { useState } from 'react'
import Logos from './Logos'
import AssetManager from '../components/AssetManager'
import Icon, { type IconName } from '../components/Icon'

type Tab = 'images' | 'audio' | 'filler'
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'images', label: 'Logos / Images', icon: 'image' },
  { id: 'audio', label: 'Audio', icon: 'audio' },
  { id: 'filler', label: 'Filler clips', icon: 'clip' },
]

export default function Media() {
  const [tab, setTab] = useState<Tab>('images')

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Media</h1>
      <p className="text-slate-400 text-sm mb-5">
        All uploaded assets: logo/watermark images, ambient audio for intermissions, and custom filler
        clips.
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
      {tab === 'filler' && (
        <AssetManager
          kind="filler"
          accept="video/*"
          emptyText="No filler clips uploaded yet. Upload a video to play during gaps between programs."
          hint="Use a clip via a channel or block filler with the “Custom clip” visual. Generated fillers also land here."
        />
      )}
    </div>
  )
}
