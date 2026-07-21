import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon, { type IconName } from './Icon'
import { api, type Channel, type Library } from '../lib/api'
import { scoreMatch } from '../lib/search'
import { cx } from './ui'

export type Command = {
  id: string
  label: string
  /** Where this sits in the app — shown dim after the label, and searchable, so
   *  typing "filler" finds "Studio › Fillers" without matching the label. */
  context?: string
  icon: IconName
  group: string
  /** Extra words that should match this command but don't belong in the label. */
  keywords?: string
  run: () => void
}

/** Everything about a command that a query should be able to match. */
const searchText = (c: Command) => `${c.label} ${c.context ?? ''} ${c.keywords ?? ''}`

/**
 * ⌘K / Ctrl-K jump-to-anything. Covers the fixed destinations plus whatever
 * this instance actually contains — every channel and library by name — so
 * getting to "channel 4's guide" is three keystrokes instead of three clicks.
 *
 * The catalogue is fetched when the palette opens rather than kept live: it's
 * only read while the overlay is up, and a stale entry costs one wrong
 * navigation, not a broken app.
 */
export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [channels, setChannels] = useState<Channel[]>([])
  const [libraries, setLibraries] = useState<Library[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    api.channels().then(setChannels).catch(() => {})
    api.libraries().then(setLibraries).catch(() => {})
  }, [open])

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to)

    const statics: Command[] = [
      { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', group: 'Go to', run: go('/'), keywords: 'home overview status' },
      { id: 'channels', label: 'Channels', icon: 'channels', group: 'Go to', run: go('/channels') },
      { id: 'library', label: 'Library', context: 'Browse', icon: 'browse', group: 'Go to', run: go('/library#browse'), keywords: 'shows movies media' },
      { id: 'sources', label: 'Library', context: 'Sources', icon: 'libraries', group: 'Go to', run: go('/library#sources'), keywords: 'scan folders add library tmdb metadata' },
      { id: 'logos', label: 'Studio', context: 'Logos', icon: 'image', group: 'Go to', run: go('/studio#images'), keywords: 'watermark images' },
      { id: 'audio', label: 'Studio', context: 'Audio', icon: 'audio', group: 'Go to', run: go('/studio#audio'), keywords: 'music intermission ambient' },
      { id: 'fillers', label: 'Studio', context: 'Fillers', icon: 'clip', group: 'Go to', run: go('/studio#fillers'), keywords: 'bumper station id clips' },
      { id: 'logs', label: 'Logs', icon: 'logs', group: 'Go to', run: go('/logs'), keywords: 'errors ffmpeg diagnostics debug' },
      { id: 'set-metadata', label: 'Settings', context: 'Metadata', icon: 'settings', group: 'Settings', run: go('/settings#metadata'), keywords: 'tmdb api key posters' },
      { id: 'set-streaming', label: 'Settings', context: 'Streaming', icon: 'settings', group: 'Settings', run: go('/settings#streaming'), keywords: 'hls mpegts transcode mode' },
      { id: 'set-watermark', label: 'Settings', context: 'Watermark', icon: 'settings', group: 'Settings', run: go('/settings#watermark'), keywords: 'logo overlay opacity' },
      { id: 'set-encoding', label: 'Settings', context: 'Encoding', icon: 'settings', group: 'Settings', run: go('/settings#encoding'), keywords: 'ffmpeg profile bitrate' },
      { id: 'set-maintenance', label: 'Settings', context: 'Maintenance', icon: 'settings', group: 'Settings', run: go('/settings#maintenance'), keywords: 'backup reset wipe clean slate' },
    ]

    const channelCmds: Command[] = channels.map((c) => ({
      id: `channel-${c.id}`,
      label: c.name,
      context: c.number != null ? `Channel ${c.number}` : 'Draft',
      icon: 'channels',
      group: 'Channels',
      keywords: [c.group ?? '', c.number ?? ''].join(' '),
      run: go(`/channels/${c.id}`),
    }))

    const libraryCmds: Command[] = libraries.map((l) => ({
      id: `library-${l.id}`,
      label: l.name,
      context: `${l.itemCount} items`,
      icon: 'libraries',
      group: 'Libraries',
      keywords: l.kind,
      run: go(`/library/${l.id}`),
    }))

    const external: Command[] = [
      {
        id: 'm3u',
        label: 'Open M3U playlist',
        icon: 'm3u',
        group: 'IPTV',
        keywords: 'playlist export plex jellyfin',
        run: () => window.open(`${window.location.origin}/iptv/channels.m3u`, '_blank'),
      },
      {
        id: 'xmltv',
        label: 'Open XMLTV guide',
        icon: 'xmltv',
        group: 'IPTV',
        keywords: 'epg guide export',
        run: () => window.open(`${window.location.origin}/iptv/xmltv.xml`, '_blank'),
      },
    ]

    return [...statics, ...channelCmds, ...libraryCmds, ...external]
  }, [channels, libraries, navigate])

  const results = useMemo(() => {
    return commands
      .map((c) => ({ cmd: c, s: scoreMatch(query, searchText(c)) }))
      .filter((r): r is { cmd: Command; s: number } => r.s !== null)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((r) => r.cmd)
  }, [commands, query])

  // Keep the highlighted row in range as the result set shrinks.
  useEffect(() => setCursor(0), [query])

  // And keep it in view as the user arrows past the visible window.
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor, results.length])

  if (!open) return null

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
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh] bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl rounded-2xl border border-edge-strong bg-surface shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 border-b border-edge">
          <Icon name="browse" size={18} className="text-ink-faint shrink-0" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page, channel, or library…"
            aria-label="Search commands"
            className="flex-1 bg-transparent py-3.5 text-sm outline-none placeholder:text-ink-ghost"
          />
          <kbd className="text-[10px] text-ink-ghost border border-edge-strong rounded px-1.5 py-0.5 shrink-0">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-ink-faint">
              Nothing matches “{query}”.
            </div>
          ) : (
            results.map((cmd, i) => {
              const showGroup = cmd.group !== lastGroup
              lastGroup = cmd.group
              return (
                <div key={cmd.id}>
                  {showGroup && (
                    <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-ink-ghost">
                      {cmd.group}
                    </div>
                  )}
                  <button
                    data-active={i === cursor}
                    onMouseMove={() => setCursor(i)}
                    onClick={() => pick(cmd)}
                    className={cx(
                      'w-full flex items-center gap-3 px-4 py-2 text-left text-sm transition-colors',
                      i === cursor ? 'bg-indigo-500/15 text-ink' : 'text-ink-soft hover:bg-raised/60',
                    )}
                  >
                    <Icon name={cmd.icon} size={16} colored={i === cursor} />
                    <span className="truncate">{cmd.label}</span>
                    {cmd.context && (
                      <span className="text-xs text-ink-faint truncate">› {cmd.context}</span>
                    )}
                    {i === cursor && (
                      <kbd className="ml-auto text-[10px] text-ink-faint border border-edge-strong rounded px-1.5 py-0.5 shrink-0">
                        ↵
                      </kbd>
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
