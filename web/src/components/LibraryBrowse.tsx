import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Library, type LibraryKind } from '../lib/api'

import Icon, { type IconName } from './Icon'
import { EmptyState, SkeletonCards, buttonClass, cardClass } from './ui'

const KIND_ICON: Record<LibraryKind, IconName> = { tv: 'show', movie: 'movie', music: 'audio', other: 'clip' }
const KIND_LABEL: Record<LibraryKind, string> = {
  tv: 'TV Shows',
  movie: 'Movies',
  music: 'Music Videos',
  other: 'Other',
}

/** The "Browse" half of the Library page: one card per library, leading into
 *  its contents. Pure navigation — managing and scanning lives in Sources. */
export default function LibraryBrowse({ onAddLibrary }: { onAddLibrary: () => void }) {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api
      .libraries()
      .then(setLibraries)
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  if (!loaded) {
    return <SkeletonCards count={3} className="sm:grid-cols-2 lg:grid-cols-3" />
  }

  if (libraries.length === 0) {
    return (
      <EmptyState
        icon="libraries"
        title="No libraries yet"
        description="A library points MosaicTV at a folder of media. Add one and scan it, and your shows and movies show up here."
        action={
          <button onClick={onAddLibrary} className={buttonClass('primary', 'md')}>
            Add your first library
          </button>
        }
      />
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {libraries.map((l, i) => (
        <Link
          key={l.id}
          to={`/library/${l.id}`}
          style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
          className={cardClass('rise-in card-interactive p-5 flex items-center gap-4')}
        >
          <Icon name={KIND_ICON[l.kind]} size={36} colored />
          <div className="min-w-0">
            <div className="font-medium truncate">{l.name}</div>
            <div className="text-xs text-ink-faint">
              {KIND_LABEL[l.kind]} · {l.itemCount} {l.itemCount === 1 ? 'item' : 'items'}
            </div>
          </div>
        </Link>
      ))}
    </div>
  )
}
