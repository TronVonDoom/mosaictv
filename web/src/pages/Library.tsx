import { useState } from 'react'
import LibraryBrowse from '../components/LibraryBrowse'
import LibrarySources from '../components/LibrarySources'
import { PageHeader, Tabs } from '../components/ui'
import { useHashTab } from '../lib/hooks'

// "Browse" and "Sources" used to be two sibling nav items (Browse / Libraries),
// which asked the user to already know that one showed contents and the other
// managed folders. They're two views of one thing, so they're two tabs now.
const TABS = [
  { id: 'browse', label: 'Browse', icon: 'browse' },
  { id: 'sources', label: 'Sources', icon: 'libraries' },
] as const

type Tab = (typeof TABS)[number]['id']
const TAB_IDS = TABS.map((t) => t.id)

const DESCRIPTIONS: Record<Tab, string> = {
  browse: 'Everything MosaicTV has indexed, by library. Open one to see its shows and movies.',
  sources: 'The folders MosaicTV reads from. Add a library, scan it for changes, and pull artwork from TMDB.',
}

export default function Library() {
  const [tab, setTab] = useHashTab<Tab>(TAB_IDS, 'browse', { libraries: 'sources' })
  // Bumped when Browse's empty state asks Sources to focus its add-library form.
  const [addRequest, setAddRequest] = useState(0)

  const startAddLibrary = () => {
    setTab('sources')
    setAddRequest((n) => n + 1)
  }

  return (
    <div>
      <PageHeader title="Library" icon="libraries" description={DESCRIPTIONS[tab]}>
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </PageHeader>

      {tab === 'browse' && <LibraryBrowse onAddLibrary={startAddLibrary} />}
      {tab === 'sources' && <LibrarySources focusAddForm={addRequest} />}
    </div>
  )
}
