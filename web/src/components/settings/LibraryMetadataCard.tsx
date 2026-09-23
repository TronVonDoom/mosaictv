import { useCallback, useEffect, useState } from 'react'
import { api, type Library, type LibraryKind, type MetadataStatus } from '../../lib/api'
import { confirmDialog } from '../../lib/confirm'
import { errorMessage } from '../../lib/errors'
import { toast } from '../../lib/toast'
import { type IconName } from '../Icon'
import { Button, Card, CardHeader, IconTile, Menu, ProgressPanel } from '../ui'

const KIND_ICON: Record<LibraryKind, IconName> = { tv: 'show', movie: 'movie', music: 'audio', other: 'clip' }

function ago(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.round(min / 60)
  return h < 48 ? `${h} hr ago` : `${Math.round(h / 24)} days ago`
}

/**
 * Fetch TMDB artwork and descriptions per library, from Settings — including
 * the forced re-match (which corrects titles an older search matched wrongly)
 * that used to be reachable only through the API.
 */
export default function LibraryMetadataCard({ configured }: { configured: boolean | null }) {
  const [libs, setLibs] = useState<Library[]>([])
  const [status, setStatus] = useState<MetadataStatus | null>(null)

  const poll = useCallback(() => api.metadataStatus().then(setStatus).catch(() => {}), [])
  useEffect(() => {
    api.libraries().then(setLibs).catch(() => {})
    poll()
  }, [poll])
  // Only poll while a fetch is running.
  useEffect(() => {
    if (!status?.running) return
    const t = setInterval(poll, 1000)
    return () => clearInterval(t)
  }, [status?.running, poll])

  async function start(lib: Library, force: boolean) {
    if (
      force &&
      !(await confirmDialog({
        title: `Re-match everything in ${lib.name}?`,
        message:
          'Every title is looked up again on TMDB, replacing its artwork, description and rating — including ones already matched. Takes a minute or two for a big library.',
        confirmLabel: 'Re-match all',
      }))
    )
      return
    try {
      await api.startMetadata(lib.id, force)
      toast.info(`Fetching metadata for ${lib.name}…`)
      poll()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not start the fetch'))
    }
  }

  const running = status?.running ? status : null
  const last = !status?.running && status?.finishedAt ? status : null

  return (
    <Card className="p-6">
      <CardHeader
        icon="sparkles"
        title="Library metadata"
        description="Posters, backdrops, descriptions and ratings, fetched from TMDB per library. Only what's missing is fetched — unless you re-match."
      />
      {running && (
        <ProgressPanel
          tone="violet"
          className="mb-4"
          title={`Fetching ${running.libraryName ?? 'metadata'}`}
          processed={running.processed}
          total={running.total}
          stats={
            <>
              <span className="text-emerald-300">{running.matched} matched</span>
              <span>{running.unmatched} not found</span>
            </>
          }
          detail={running.currentTitle}
        />
      )}
      <ul className="divide-y divide-edge/70 rounded-xl border border-edge bg-sunken/50">
        {libs.map((l) => {
          const busy = running?.libraryId === l.id
          return (
            <li key={l.id} className="flex items-center gap-3 px-3.5 py-3">
              <IconTile name={KIND_ICON[l.kind]} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium truncate">{l.name}</div>
                <div className="text-[12px] text-ink-faint tabular-nums">{l.itemCount.toLocaleString()} items</div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon="download"
                loading={busy}
                disabled={!configured || !!running || l.kind === 'other'}
                onClick={() => start(l, false)}
                title={configured ? undefined : 'Save a TMDB key first'}
              >
                {busy ? 'Fetching' : 'Fetch missing'}
              </Button>
              <Menu
                items={[
                  {
                    label: 'Re-match everything',
                    icon: 'refresh',
                    hint: 'force',
                    disabled: !configured || !!running || l.kind === 'other',
                    onSelect: () => start(l, true),
                  },
                ]}
              />
            </li>
          )
        })}
        {libs.length === 0 && <li className="px-3.5 py-3 text-[13px] text-ink-faint">No libraries yet.</li>}
      </ul>
      {last && last.libraryName && (
        <p className="mt-3 text-[12px] text-ink-faint">
          Last run: {last.libraryName} — {last.matched.toLocaleString()} matched, {last.unmatched.toLocaleString()} not
          found{last.finishedAt ? `, ${ago(last.finishedAt)}` : ''}.{last.error ? ` Error: ${last.error}` : ''}
        </p>
      )}
    </Card>
  )
}
