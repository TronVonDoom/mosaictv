import { useEffect, useState } from 'react'
import Icon from './Icon'
import { api, type FsListing } from '../lib/api'

export default function DirectoryPicker({
  initialPath,
  onSelect,
  onClose,
}: {
  initialPath?: string
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const [listing, setListing] = useState<FsListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = (path?: string) => {
    setLoading(true)
    setError(null)
    api
      .browse(path)
      .then((l) => setListing(l))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to open folder'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load(initialPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full shadow-2xl flex flex-col max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Choose a folder</h2>
            <button
              onClick={onClose}
              className="text-slate-500 hover:text-slate-200 text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="mt-2 text-xs font-mono text-slate-400 bg-slate-950 rounded px-2 py-1.5 truncate">
            {listing?.path ?? '…'}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 min-h-40">
          {error ? (
            <div className="text-rose-300 text-sm p-3">{error}</div>
          ) : loading ? (
            <div className="text-slate-500 text-sm p-3">Loading…</div>
          ) : (
            <div className="space-y-0.5">
              {listing?.parent && (
                <button
                  onClick={() => load(listing.parent!)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-800/60 text-left text-sm text-slate-400"
                >
                  <span>↩</span> ..
                </button>
              )}
              {listing?.dirs.length === 0 && (
                <div className="text-slate-600 text-sm px-3 py-2">No subfolders here.</div>
              )}
              {listing?.dirs.map((d) => (
                <button
                  key={d.path}
                  onClick={() => load(d.path)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-slate-800/60 text-left text-sm"
                >
                  <Icon name="folder" size={16} className="text-slate-400 shrink-0" />
                  <span className="truncate">{d.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-800 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            Navigate into the folder you want, then select it.
          </span>
          <button
            onClick={() => listing && onSelect(listing.path)}
            disabled={!listing}
            className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 px-4 py-2 text-sm font-medium shrink-0"
          >
            Select this folder
          </button>
        </div>
      </div>
    </div>
  )
}
