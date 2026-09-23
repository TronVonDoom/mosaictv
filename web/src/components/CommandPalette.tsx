import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon, { type IconName } from './Icon'
import MediaDetailModal from './MediaDetailModal'
import { api, logoImageUrl, type Channel, type Library, type MediaSearchResult } from '../lib/api'
import { scoreMatch } from '../lib/search'
import { Kbd, cx } from './ui'

export type Command = {
  id: string
  label: string
  /** Where this sits in the app — shown dim after the label, and searchable, so
   *  typing "filler" finds "Studio › Fillers" without matching the label. */
  context?: string
  icon: IconName
  /** A picture instead of the icon — a channel's logo. */
  image?: string
  group: string
  /** Extra words that should match this command but don't belong in the label. */
  keywords?: string
  run: () => void
}

/** Everything about a command that a query should be able to match. */
const searchText = (c: Command) => `${c.label} ${c.context ?? ''} ${c.keywords ?? ''}`

/**
 * ⌘K / Ctrl-K jump-to-anything. Covers the fixed destinations, every channel
 * and library by name, and — once two letters are typed — the shows and movies
 * in the library itself, so getting to "channel 4's guide" or "that Halloween
 * movie" is a few keystrokes instead of a few clicks.
 *
 * The catalogue is fetched when the palette opens rather than kept live: it's
 * only read while the overlay is up, and a stale entry costs one wrong
 * navigation, not a broken app.
 */
export default function CommandPalette({
  open,
  onClose,
  onConnect,
}: {
  open: boolean
  onClose: () => void
  onConnect: () => void
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [channels, setChannels] = useState<Channel[]>([])
  const [libraries, setLibraries] = useState<Library[]>([])
  const [media, setMedia] = useState<MediaSearchResult[]>([])
  const [detailId, setDetailId] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    setMedia([])
    api.channels().then(setChannels).catch(() => {})
    api.libraries().then(setLibraries).catch(() => {})
  }, [open])

  // Library search, debounced — it's a server round-trip per keystroke otherwise.
  useEffect(() => {
    const q = query.trim()
    if (!open || q.length < 2) {
      setMedia([])
      return
    }
    const t = setTimeout(() => {
      api
        .searchMedia(q)
        .then((r) => setMedia(r.results.filter((x) => x.kind === 'show' || x.kind === 'movie')))
        .catch(() => setMedia([]))
    }, 180)
    return () => clearTimeout(t)
  }, [query, open])

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to)

    const statics: Command[] = [
      { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Go to', run: go('/'), keywords: 'home overview status live now' },
      { id: 'channels', label: 'Channels', icon: 'channels', group: 'Go to', run: go('/channels') },
      { id: 'guide', label: 'TV Guide', context: 'Channels', icon: 'guide', group: 'Go to', run: go('/channels#guide'), keywords: 'epg listings schedule what is on tonight' },
      { id: 'library', label: 'Library', context: 'Browse', icon: 'libraries', group: 'Go to', run: go('/library#browse'), keywords: 'shows movies media' },
      { id: 'sources', label: 'Library', context: 'Sources', icon: 'folder', group: 'Go to', run: go('/library#sources'), keywords: 'scan folders add library tmdb metadata' },
      { id: 'logos', label: 'Studio', context: 'Logos', icon: 'image', group: 'Go to', run: go('/studio#images'), keywords: 'watermark images' },
      { id: 'audio', label: 'Studio', context: 'Audio', icon: 'audio', group: 'Go to', run: go('/studio#audio'), keywords: 'music intermission ambient' },
      { id: 'fillers', label: 'Studio', context: 'Fillers', icon: 'clip', group: 'Go to', run: go('/studio#fillers'), keywords: 'bumper station id clips' },
      { id: 'logs', label: 'Logs', icon: 'logs', group: 'Go to', run: go('/logs'), keywords: 'errors ffmpeg diagnostics debug' },
      { id: 'set-metadata', label: 'Settings', context: 'Metadata', icon: 'settings', group: 'Settings', run: go('/settings#metadata'), keywords: 'tmdb api key posters' },
      { id: 'set-streaming', label: 'Settings', context: 'Streaming', icon: 'settings', group: 'Settings', run: go('/settings#streaming'), keywords: 'hls mpegts transcode mode tuner hdhomerun horizon audio language' },
      { id: 'set-watermark', label: 'Settings', context: 'Watermark', icon: 'settings', group: 'Settings', run: go('/settings#watermark'), keywords: 'logo overlay opacity' },
      { id: 'set-encoding', label: 'Settings', context: 'Encoding', icon: 'settings', group: 'Settings', run: go('/settings#encoding'), keywords: 'ffmpeg profile bitrate gpu nvenc' },
      { id: 'set-maintenance', label: 'Settings', context: 'Maintenance', icon: 'settings', group: 'Settings', run: go('/settings#maintenance'), keywords: 'backup reset wipe clean slate' },
    ]

    const channelCmds: Command[] = channels.map((c) => ({
      id: `channel-${c.id}`,
      label: c.name,
      context: c.number != null ? `Channel ${c.number}` : 'Draft',
      icon: 'channels',
      image: c.logoId ? logoImageUrl(c.logoId) : undefined,
      group: 'Channels',
      keywords: [c.group ?? '', c.number ?? ''].join(' '),
      run: go(`/channels/${c.id}`),
    }))

    const libraryCmds: Command[] = libraries.map((l) => ({
      id: `library-${l.id}`,
      label: l.name,
      context: `${l.itemCount.toLocaleString()} items`,
      icon: l.kind === 'movie' ? 'movie' : l.kind === 'tv' ? 'show' : 'libraries',
      group: 'Libraries',
      keywords: l.kind,
      run: go(`/library/${l.id}`),
    }))

    const actions: Command[] = [
      { id: 'connect', label: 'Live TV setup', icon: 'link', group: 'Actions', keywords: 'connect player m3u xmltv hdhomerun plex jellyfin emby vlc iptv playlist url', run: onConnect },
      {
        id: 'm3u',
        label: 'Open M3U playlist',
        icon: 'm3u',
        group: 'Actions',
        keywords: 'playlist export plex jellyfin',
        run: () => window.open(`${window.location.origin}/iptv/channels.m3u`, '_blank'),
      },
      {
        id: 'xmltv',
        label: 'Open XMLTV guide',
        icon: 'xmltv',
        group: 'Actions',
        keywords: 'epg guide export',
        run: () => window.open(`${window.location.origin}/iptv/xmltv.xml`, '_blank'),
      },
    ]

    return [...statics, ...channelCmds, ...libraryCmds, ...actions]
  }, [channels, libraries, navigate, onConnect])

  // Library titles always come after the app's own destinations: typing
  // "set" should land on Settings before a show called "Sunset".
  const mediaCmds = useMemo<Command[]>(
    () =>
      media.slice(0, 8).map((r): Command | null =>
        r.kind === 'show'
          ? {
              id: `show-${r.libraryId}-${r.showTitle}`,
              label: r.showTitle,
              context: `${r.episodeCount} episodes`,
              icon: 'show' as const,
              group: 'In your library',
              run: () => {
                navigate(`/library/${r.libraryId}/show/${encodeURIComponent(r.showTitle)}`)
              },
            }
          : r.kind === 'movie'
            ? {
                id: `movie-${r.mediaItemId}`,
                label: r.title,
                context: r.year ? String(r.year) : 'Movie',
                icon: 'movie' as const,
                group: 'In your library',
                run: () => setDetailId(r.mediaItemId),
              }
            : null,
      ).filter((c): c is Command => c !== null),
    [media, navigate],
  )

  const results = useMemo(() => {
    const ranked = commands
      .map((c) => ({ cmd: c, s: scoreMatch(query, searchText(c)) }))
      .filter((r): r is { cmd: Command; s: number } => r.s !== null)
      .sort((a, b) => b.s - a.s)
      .slice(0, query ? 9 : 14)
      .map((r) => r.cmd)
    // Group rows so each heading appears once, in first-hit order.
    const order: string[] = []
    for (const c of ranked) if (!order.includes(c.group)) order.push(c.group)
    const grouped = order.flatMap((g) => ranked.filter((c) => c.group === g))
    return [...grouped, ...mediaCmds]
  }, [commands, mediaCmds, query])

  // Keep the highlighted row in range as the result set shrinks.
  useEffect(() => setCursor(0), [query])

  // And keep it in view as the user arrows past the visible window.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, results.length])

  if (!open && detailId == null) return null
  if (!open) return <MediaDetailModal id={detailId as number} onClose={() => setDetailId(null)} />

  const pick = (cmd: Command | undefined) => {
    if (!cmd) return
    onClose()
    cmd.run()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => (c + 1) % Math.max(results.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => (c - 1 + results.length) % Math.max(results.length, 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(results[cursor])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  let lastGroup = ''

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh] bg-black/65 backdrop-blur-[3px] fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="modal-in w-full max-w-[620px] rounded-2xl border border-edge-strong bg-overlay/95 backdrop-blur-xl shadow-[0_40px_100px_-20px_rgb(0_0_0/0.9),inset_0_1px_0_rgb(255_255_255/0.06)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 border-b border-edge">
          <Icon name="search" size={18} className="text-ink-faint shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search pages, channels, shows and movies…"
            aria-label="Search"
            className="flex-1 bg-transparent h-14 text-[15px] text-ink outline-none placeholder:text-ink-ghost"
          />
          <Kbd>esc</Kbd>
        </div>

        <div ref={listRef} className="max-h-[56vh] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-ink-faint">
              Nothing matches “{query}”.
            </div>
          ) : (
            results.map((cmd, i) => {
              const showGroup = cmd.group !== lastGroup
              lastGroup = cmd.group
              const active = i === cursor
              return (
                <div key={cmd.id}>
                  {showGroup && (
                    <div className="px-3 pt-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-ghost">
                      {cmd.group}
                    </div>
                  )}
                  <button
                    data-active={active}
                    onMouseMove={() => setCursor(i)}
                    onClick={() => pick(cmd)}
                    className={cx(
                      'w-full flex items-center gap-3 rounded-lg px-3 h-10 text-left text-[13.5px] transition-colors',
                      active ? 'bg-white/[0.07] text-ink' : 'text-ink-soft',
                    )}
                  >
                    <span
                      className={cx(
                        'grid place-items-center w-7 h-7 rounded-md border shrink-0 overflow-hidden',
                        active ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200' : 'border-edge bg-surface text-ink-muted',
                      )}
                    >
                      {cmd.image ? (
                        <img src={cmd.image} alt="" className="w-full h-full object-contain p-0.5" />
                      ) : (
                        <Icon name={cmd.icon} size={15} />
                      )}
                    </span>
                    <span className="truncate font-medium">{cmd.label}</span>
                    {cmd.context && <span className="text-[12.5px] text-ink-faint truncate">{cmd.context}</span>}
                    {active && <Icon name="chevronRight" size={15} className="ml-auto text-ink-faint shrink-0" />}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center gap-4 px-4 h-10 border-t border-edge text-[11.5px] text-ink-faint">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↵</Kbd> to open
          </span>
          <span className="ml-auto">{query.trim().length >= 2 ? 'Searching your library too' : 'Type to search your library'}</span>
        </div>
      </div>
    </div>
  )
}
