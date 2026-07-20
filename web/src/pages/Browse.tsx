import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Library, type LibraryKind } from '../lib/api'

import Icon, { type IconName } from '../components/Icon'
import { cardClass } from '../components/ui'

const KIND_ICON: Record<LibraryKind, IconName> = { tv: 'show', movie: 'movie', music: 'audio', other: 'clip' }
const KIND_LABEL: Record<LibraryKind, string> = {
  tv: 'TV Shows',
  movie: 'Movies',
  music: 'Music Videos',
  other: 'Other',
}

export default function Browse() {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api
      .libraries()
      .then(setLibraries)
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Browse</h1>
      <p className="text-slate-400 text-sm mb-6">Pick a library to explore.</p>

      {loaded && libraries.length === 0 ? (
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5 text-sm text-slate-300">
          No libraries yet. Add one under{' '}
          <Link to="/libraries" className="text-indigo-300 font-medium">
            Libraries
          </Link>{' '}
          and scan it.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {libraries.map((l) => (
            <Link
              key={l.id}
              to={`/browse/${l.id}`}
              className={cardClass('p-5 flex items-center gap-4 hover:border-indigo-500 hover:bg-slate-900 transition-colors')}
            >
              <div className="text-slate-200"><Icon name={KIND_ICON[l.kind]} size={36} colored /></div>
              <div className="min-w-0">
                <div className="font-medium truncate">{l.name}</div>
                <div className="text-xs text-slate-500">
                  {KIND_LABEL[l.kind]} · {l.itemCount} items
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
