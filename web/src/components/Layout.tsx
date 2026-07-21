import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import Icon, { type IconName } from './Icon'
import ToastContainer from './ToastContainer'
import CommandPalette from './CommandPalette'
import { api } from '../lib/api'
import { usePolling } from '../lib/hooks'

/** Mac gets ⌘K, everyone else Ctrl-K — label it to match the actual keyboard. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
const PALETTE_HINT = IS_MAC ? '⌘K' : 'Ctrl K'

// Six destinations in three groups, rather than seven flat peers. The grouping
// answers the question the old flat list couldn't: "Browse" and "Libraries"
// were two names for one idea, and nothing said whether Logs was a feature or
// plumbing. Icon colours still flow violet→rose down the rail.
type NavItem = { to: string; label: string; icon: IconName; end?: boolean }
const NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Broadcast',
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
      { to: '/channels', label: 'Channels', icon: 'channels' },
    ],
  },
  {
    heading: 'Content',
    items: [
      { to: '/library', label: 'Library', icon: 'libraries' },
      { to: '/studio', label: 'Studio', icon: 'media' },
    ],
  },
  {
    heading: 'System',
    items: [
      { to: '/logs', label: 'Logs', icon: 'logs' },
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
]

const COLLAPSE_KEY = 'mosaictv.navCollapsed'

function navLinkClass(collapsed: boolean) {
  return ({ isActive }: { isActive: boolean }) =>
    'flex items-center gap-3 rounded-lg py-2.5 text-base transition-colors ' +
    (collapsed ? 'justify-center px-0' : 'px-3.5') +
    ' ' +
    (isActive
      ? 'bg-gradient-to-r from-violet-500/20 to-cyan-500/10 text-white ring-1 ring-violet-500/30'
      : 'text-ink-muted hover:bg-raised/60 hover:text-ink-soft')
}

export default function Layout() {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(COLLAPSE_KEY) === '1',
  )
  // How many channels are actually on air, so the rail can say so at a glance
  // instead of making the user open the Dashboard to find out.
  const [live, setLive] = useState<{ channels: number; viewers: number } | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

  // ⌘K / Ctrl-K from anywhere. Bound on the window rather than a focus trap so
  // it works while a form field has focus — which is most of the time.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const loadLive = () =>
    api
      .channels()
      .then((cs) => {
        const onAir = cs.filter((c) => c.number != null)
        setLive({
          channels: onAir.length,
          viewers: onAir.reduce((n, c) => n + c.viewers, 0),
        })
      })
      .catch(() => setLive(null))

  useEffect(() => {
    loadLive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  usePolling(loadLive, 10000)

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  const iptvLinks: { href: string; label: string; icon: IconName }[] = [
    { href: `${origin}/iptv/channels.m3u`, label: 'M3U playlist', icon: 'm3u' },
    { href: `${origin}/iptv/xmltv.xml`, label: 'XMLTV guide', icon: 'xmltv' },
  ]

  return (
    <div className="min-h-screen text-ink flex bg-canvas bg-[radial-gradient(1000px_600px_at_8%_-10%,rgba(139,92,246,0.10),transparent_60%),radial-gradient(900px_600px_at_100%_0%,rgba(34,211,238,0.06),transparent_55%)]">
      <aside
        className={
          'relative shrink-0 border-r border-edge bg-surface/40 flex flex-col transition-[width] duration-200 ' +
          (collapsed ? 'w-[76px]' : 'w-64')
        }
      >
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute top-1/2 -right-3 -translate-y-1/2 z-10 flex items-center justify-center w-6 h-6 rounded-full border border-edge-strong bg-raised text-ink-muted hover:text-ink hover:border-indigo-500 transition-colors shadow shadow-black/30"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={'transition-transform duration-200 ' + (collapsed ? 'rotate-180' : '')}
          >
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>

        <div className="h-1 bg-gradient-brand" />
        <div className="px-4 py-5 border-b border-edge flex items-center justify-center overflow-hidden">
          <img
            src={collapsed ? '/logo-icon.png' : '/logo-wide.png'}
            alt="MosaicTV"
            className={collapsed ? 'w-9 h-9' : 'w-full max-w-[210px]'}
          />
        </div>

        {/* A visible entry point for the palette — a shortcut nobody discovers
            is a shortcut nobody uses. */}
        <div className="px-3 pt-3">
          <button
            onClick={() => setPaletteOpen(true)}
            title={`Search (${PALETTE_HINT})`}
            aria-label="Search"
            className={
              'w-full flex items-center gap-2 rounded-lg border border-edge bg-canvas/60 text-ink-faint hover:border-edge-strong hover:text-ink-muted transition-colors ' +
              (collapsed ? 'justify-center py-2 px-0' : 'px-3 py-2')
            }
          >
            <Icon name="browse" size={16} />
            {!collapsed && (
              <>
                <span className="text-sm">Search…</span>
                <kbd className="ml-auto text-[10px] border border-edge-strong rounded px-1.5 py-0.5">
                  {PALETTE_HINT}
                </kbd>
              </>
            )}
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-4 overflow-y-auto">
          {NAV_GROUPS.map((group) => (
            <div key={group.heading} className="space-y-1.5">
              {!collapsed && (
                <div className="px-3.5 text-[10px] uppercase tracking-wider text-ink-ghost">
                  {group.heading}
                </div>
              )}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  title={collapsed ? item.label : undefined}
                  className={navLinkClass(collapsed)}
                >
                  <Icon name={item.icon} size={22} colored />
                  {!collapsed && item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* On-air status. Always visible, so "is it actually broadcasting?" is
            answered from anywhere in the app. */}
        {live && (
          <div className={'px-3 pb-2 ' + (collapsed ? 'flex justify-center' : '')}>
            <div
              className={
                'flex items-center gap-2 rounded-lg border px-3 py-2 ' +
                (live.channels > 0
                  ? 'border-emerald-500/25 bg-emerald-500/5'
                  : 'border-edge bg-surface/40')
              }
              title={
                live.channels > 0
                  ? `${live.channels} channel${live.channels === 1 ? '' : 's'} on air · ${live.viewers} viewer${live.viewers === 1 ? '' : 's'}`
                  : 'No channels on air'
              }
            >
              <span className="relative flex w-2 h-2 shrink-0">
                {live.channels > 0 && (
                  <span className="pulse-live absolute inset-0 rounded-full bg-emerald-400" />
                )}
                <span
                  className={
                    'relative w-2 h-2 rounded-full ' +
                    (live.channels > 0 ? 'bg-emerald-400' : 'bg-ink-ghost')
                  }
                />
              </span>
              {!collapsed && (
                <span className="text-xs text-ink-muted truncate">
                  {live.channels > 0 ? (
                    <>
                      <span className="text-emerald-300 font-medium">{live.channels} on air</span>
                      {live.viewers > 0 && ` · ${live.viewers} watching`}
                    </>
                  ) : (
                    'Nothing on air'
                  )}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="p-3 border-t border-edge space-y-0.5">
          {!collapsed && (
            <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-ink-ghost">IPTV</div>
          )}
          {iptvLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              title={collapsed ? l.label : undefined}
              className={
                'flex items-center gap-3 rounded-lg py-1.5 text-sm text-ink-muted hover:bg-raised/60 hover:text-ink-soft transition-colors ' +
                (collapsed ? 'justify-center px-0' : 'px-3')
              }
            >
              <Icon name={l.icon} size={16} /> {!collapsed && l.label}
            </a>
          ))}
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto">
        <div className="max-w-[1800px] mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ToastContainer />
    </div>
  )
}
