import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { Link } from 'react-router-dom'
import { api, type Library, type LibraryKind } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { useJobStatus } from '../lib/hooks'
import { toast } from '../lib/toast'
import DirectoryPicker from './DirectoryPicker'
import { Badge, Banner, Button, Card, Field, InfoHint, Input, ProgressPanel, Select } from './ui'

const KIND_LABELS: Record<LibraryKind, string> = {
  tv: 'TV Shows',
  movie: 'Movies',
  music: 'Music Videos',
  other: 'Other / Bumpers',
}

// Where a picked folder path should go.
type PickerTarget =
  | { mode: 'new'; index: number }
  | { mode: 'add'; libraryId: number }

/** The "Sources" half of the Library page: add libraries, point them at
 *  folders, scan them, and pull metadata. Browsing what's inside lives in
 *  LibraryBrowse. */
export default function LibrarySources({ focusAddForm }: { focusAddForm?: number }) {
  const [libraries, setLibraries] = useState<Library[]>([])
  const [tmdbConfigured, setTmdbConfigured] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<{ name: string; kind: LibraryKind; folders: string[] }>({
    name: '',
    kind: 'tv',
    folders: [''],
  })
  const [submitting, setSubmitting] = useState(false)
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  // The Browse tab's empty state sends people here to add their first library;
  // land them in the name field rather than at the top of an unfamiliar form.
  useEffect(() => {
    if (!focusAddForm) return
    nameRef.current?.focus()
    nameRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusAddForm])

  const refresh = () => api.libraries().then(setLibraries).catch(() => {})

  const scanJob = useJobStatus(api.scanStatus, refresh)
  const metaJob = useJobStatus(api.metadataStatus, refresh)
  const scan = scanJob.status
  const meta = metaJob.status

  useEffect(() => {
    refresh()
    api.settings().then((s) => setTmdbConfigured(s.tmdbConfigured)).catch(() => {})
  }, [])

  /** Run an action, surfacing any failure in the page's error banner. */
  async function guard(fallback: string, fn: () => Promise<void>) {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errorMessage(err, fallback))
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const folders = form.folders.map((f) => f.trim()).filter(Boolean)
    if (folders.length === 0) {
      setError('Add at least one folder.')
      return
    }
    setSubmitting(true)
    await guard('Failed to add library', async () => {
      await api.addLibrary({ name: form.name, kind: form.kind, folders })
      setForm({ name: '', kind: 'tv', folders: [''] })
      toast.success('Library added')
      refresh()
    })
    setSubmitting(false)
  }

  const handleScan = (id: number, force = false) =>
    guard('Failed to start scan', async () => {
      await api.startScan(id, force)
      scanJob.start()
    })

  const handleFetchMetadata = (id: number) =>
    guard('Failed to start metadata fetch', async () => {
      await api.startMetadata(id)
      metaJob.start()
    })

  const handleDelete = (id: number) =>
    guard('Failed to delete library', async () => {
      await api.deleteLibrary(id)
      toast.success('Library deleted')
      refresh()
    })

  const handleRemoveFolder = (libraryId: number, folderId: number) =>
    guard('Failed to remove folder', async () => {
      await api.removeFolder(libraryId, folderId)
      refresh()
    })

  async function onPick(path: string) {
    const target = picker
    setPicker(null)
    if (!target) return
    if (target.mode === 'new') {
      const folders = [...form.folders]
      folders[target.index] = path
      setForm({ ...form, folders })
    } else {
      await guard('Failed to add folder', async () => {
        await api.addFolder(target.libraryId, path)
        refresh()
      })
    }
  }

  const scanning = scan?.running ?? false
  const enriching = meta?.running ?? false
  const busy = scanning || enriching

  return (
    <div>
      {error && (
        <Banner className="mb-5">{error}</Banner>
      )}

      {!tmdbConfigured && (
        <Banner tone="accent" className="mb-5">
          Add a TMDB API key in{' '}
          <Link to="/settings" className="text-violet-300 hover:text-violet-200 font-medium">
            Settings
          </Link>{' '}
          to fetch posters, overviews, and ratings for movies &amp; shows.
        </Banner>
      )}

      {scan?.running && (
        <ProgressPanel
          tone="indigo"
          className="mb-5"
          title={`Scanning ${scan.libraryName}…`}
          processed={scan.processed}
          total={scan.total}
          detail={scan.currentPath}
          stats={
            <>
              <span className="text-emerald-400">+{scan.added} new</span>
              <span className="text-sky-400">{scan.updated} updated</span>
              <span>{scan.skipped} unchanged</span>
              {scan.removed > 0 && <span className="text-amber-400">{scan.removed} missing</span>}
            </>
          }
        />
      )}

      {meta?.running && (
        <ProgressPanel
          tone="violet"
          className="mb-5"
          title={`Fetching TMDB metadata for ${meta.libraryName}…`}
          processed={meta.processed}
          total={meta.total}
          detail={meta.currentTitle}
          stats={
            <>
              <span className="text-emerald-400">{meta.matched} matched</span>
              {meta.unmatched > 0 && <span className="text-amber-400">{meta.unmatched} no match</span>}
            </>
          }
        />
      )}

      {/* Add-library form */}
      <Card className="p-5 mb-6">
        <div className="mb-4">
          <h2 className="font-semibold">Add a library</h2>
          <p className="text-sm text-ink-muted mt-0.5">
            A library is one shelf of your collection — a name, a type, and the folders it lives in.
          </p>
        </div>
        <form onSubmit={handleAdd} className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
            <Field label="Name" hint="Shown in the guide and on the Browse tab.">
              <Input
                ref={nameRef}
                placeholder="Movies"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </Field>
            <Field label="Type">
              <Select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as LibraryKind })}
              >
                <option value="tv">TV Shows</option>
                <option value="movie">Movies</option>
                <option value="music">Music Videos</option>
                <option value="other">Other</option>
              </Select>
            </Field>
          </div>

          <div className="space-y-2">
            <span className="text-ink-muted text-sm inline-flex items-center gap-1.5">
              Folders
              <InfoHint>
                One library can span several folders — useful when a collection is split across
                drives. Paths are inside the container, so they start at your mounted{' '}
                <code className="text-ink">/media</code> volume, not your host filesystem.
              </InfoHint>
            </span>
            {form.folders.map((folder, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  className="flex-1 min-w-0 font-mono"
                  placeholder="/media/plex_media/movies"
                  value={folder}
                  onChange={(e) => {
                    const folders = [...form.folders]
                    folders[i] = e.target.value
                    setForm({ ...form, folders })
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPicker({ mode: 'new', index: i })}
                  className="shrink-0"
                >
                  Browse…
                </Button>
                {form.folders.length > 1 && (
                  <Button
                    type="button"
                    variant="subtle"
                    onClick={() =>
                      setForm({ ...form, folders: form.folders.filter((_, j) => j !== i) })
                    }
                    className="shrink-0"
                    aria-label="Remove folder"
                  >
                    ×
                  </Button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setForm({ ...form, folders: [...form.folders, ''] })}
              className="text-sm text-indigo-300 hover:text-indigo-200"
            >
              + Add another folder
            </button>
          </div>

          <div className="flex justify-end">
            <Button type="submit" size="lg" disabled={submitting}>
              Add library
            </Button>
          </div>
        </form>
      </Card>

      {/* Library list */}
      {libraries.length === 0 ? (
        <p className="text-ink-faint text-sm text-center py-6">
          No libraries yet — add one above to get started.
        </p>
      ) : (
        <div className="space-y-3">
          {libraries.map((lib) => (
            <Card key={lib.id} className="p-4">
              <div className="flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{lib.name}</span>
                    <Badge>{KIND_LABELS[lib.kind]}</Badge>
                    <span className="text-xs text-ink-faint">{lib.itemCount} items</span>
                  </div>
                </div>
                <Button variant="secondary" size="sm" onClick={() => handleScan(lib.id)} disabled={busy}>
                  {scanning ? 'Scanning…' : 'Scan'}
                </Button>
                <Button
                  variant="subtle"
                  size="sm"
                  onClick={() => handleScan(lib.id, true)}
                  disabled={busy}
                  title="Re-probe every file, ignoring the unchanged-file skip"
                  className="hover:border-amber-500/50 hover:text-amber-300"
                >
                  Force
                </Button>
                {lib.kind !== 'other' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleFetchMetadata(lib.id)}
                    disabled={busy || !tmdbConfigured}
                    title={
                      tmdbConfigured
                        ? 'Fetch posters, overviews & ratings from TMDB'
                        : 'Set a TMDB API key in Settings first'
                    }
                    className="hover:border-violet-500 hover:text-violet-300"
                  >
                    {enriching ? 'Fetching…' : 'Metadata'}
                  </Button>
                )}
                <Button variant="subtle" size="sm" onClick={() => handleDelete(lib.id)} disabled={busy}>
                  Delete
                </Button>
              </div>

              {/* Folders */}
              <div className="mt-3 pt-3 border-t border-edge/60 space-y-1.5">
                {lib.folders.map((f) => (
                  <div key={f.id} className="flex items-center gap-2 text-xs">
                    <Icon name="folder" size={13} className="text-ink-faint shrink-0" />
                    <span className="font-mono text-ink-muted truncate flex-1">{f.path}</span>
                    {lib.folders.length > 1 && (
                      <button
                        onClick={() => handleRemoveFolder(lib.id, f.id)}
                        disabled={busy}
                        className="text-ink-faint hover:text-rose-400 disabled:opacity-40 px-1"
                        aria-label="Remove folder"
                        title="Remove folder (and its indexed media)"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => setPicker({ mode: 'add', libraryId: lib.id })}
                  disabled={busy}
                  className="text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-40"
                >
                  + Add folder
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {picker && (
        <DirectoryPicker
          initialPath={picker.mode === 'new' ? form.folders[picker.index] || '/media' : '/media'}
          onSelect={onPick}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}
