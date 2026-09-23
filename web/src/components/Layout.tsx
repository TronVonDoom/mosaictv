import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import Icon, { type IconName } from './Icon'
import ToastContainer from './ToastContainer'
import CommandPalette from './CommandPalette'
import ConnectPlayers from './ConnectPlayers'
import ConfirmHost from './ConfirmHost'
import { api, type Health } from '../lib/api'
import { usePolling } from '../lib/hooks'
import { Button, IconButton, Kbd, cx } from './ui'

/** Mac gets ⌘K, everyone else Ctrl-K — label it to match the actual keyboard. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
const PALETTE_HINT = IS_MAC ? '⌘K' : 'Ctrl K'

// Seven destinations in three groups. The grouping answers "is this a feature
// or plumbing?" at a glance: Broadcast is what airs, Content is what it's made
// of, System keeps it running.
type NavItem = { to: string; label: string; icon: IconName; end?: boolean }
const NAV_GROUPS: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Broadcast',
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
      { to: '/guide', label: 'TV Guide', icon: 'guide' },
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

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

type Live = { channels: number; viewers: number }

function Sidebar({
  collapsed,
  onToggle,
  live,
  version,
  className,
  onNavigate,
}: {
  collapsed: boolean
  onToggle?: () => void
  live: Live | null
  version: string | null
  className?: string
  onNavigate?: () => void
}) {
  return (
    <aside
      className={cx(
        'flex flex-col h-full border-r border-edge bg-[#090b10]/95 transition-[width] duration-200',
        collapsed ? 'w-[72px]' : 'w-[248px]',
        className,
      )}
    >
      {/* Brand */}
      <Link
        to="/"
        onClick={onNavigate}
        className={cx('flex items-center gap-2.5 h-16 shrink-0', collapsed ? 'justify-center px-0' : 'px-5')}
        title="MosaicTV"
      >
        <img src="/logo-icon.png" alt="" className="w-8 h-8 shrink-0 drop-shadow-[0_4px_12px_rgb(139_92_246/0.45)]" />
        {!collapsed && (
          <span className="flex items-baseline gap-2 min-w-0">
            <span className="text-[17px] font-semibold tracking-[-0.02em] text-ink">
              Mosaic<span className="text-gradient-brand">TV</span>
            </span>
            {version && /^\d/.test(version) && (
              <span className="text-[10.5px] font-medium text-ink-ghost tabular-nums">v{version}</span>
            )}
          </span>
        )}
      </Link>

      {/* Navigation */}
      <nav className={cx('flex-1 overflow-y-auto pb-4 space-y-5', collapsed ? 'px-3' : 'px-3')}>
        {NAV_GROUPS.map((group) => (
          <div key={group.heading}>
            {collapsed ? (
              <div className="mx-auto my-2 h-px w-6 bg-edge" />
            ) : (
              <div className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-ink-ghost">
                {group.heading}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={({ isActive }) =>
                    cx(
                      'group relative flex items-center gap-3 h-9 rounded-lg text-[13.5px] font-medium transition-colors',
                      collapsed ? 'justify-center' : 'px-2.5',
                      isActive
                        ? 'bg-white/[0.07] text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]'
                        : 'text-ink-muted hover:text-ink-soft hover:bg-white/[0.035]',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <span className="absolute -left-3 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-r-full bg-gradient-to-b from-indigo-400 to-sky-400" />
                      )}
                      <Icon
                        name={item.icon}
                        size={18}
                        className={cx(
                          'shrink-0 transition-colors',
                          isActive ? 'text-indigo-300' : 'text-ink-faint group-hover:text-ink-muted',
                        )}
                      />
                      {!collapsed && item.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* On-air status — "is it actually broadcasting?" answered from anywhere. */}
      <div className={cx('shrink-0 border-t border-edge', collapsed ? 'p-3' : 'p-3')}>
        {live && (
          <Link
            to="/guide"
            onClick={onNavigate}
            title={
              live.channels > 0
                ? `${live.channels} channel${live.channels === 1 ? '' : 's'} on air · ${live.viewers} watching`
                : 'Nothing on air'
            }
            className={cx(
              'flex items-center gap-3 rounded-xl border transition-colors',
              collapsed ? 'justify-center p-2.5' : 'px-3 py-2.5',
              live.channels > 0
                ? 'border-live/25 bg-live/[0.06] hover:bg-live/[0.1]'
                : 'border-edge bg-surface/60 hover:bg-surface',
            )}
          >
            <span className={cx('flex items-end gap-[3px] h-4 shrink-0', live.channels === 0 && 'opacity-40')}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={cx('w-[3px] h-4 rounded-full', live.channels > 0 ? 'bg-live eq-bar' : 'bg-ink-ghost scale-y-50 origin-bottom')}
                />
              ))}
            </span>
            {!collapsed && (
              <span className="min-w-0 leading-tight">
                <span className={cx('block text-[13px] font-semibold', live.channels > 0 ? 'text-ink' : 'text-ink-muted')}>
                  {live.channels > 0 ? `${live.channels} channel${live.channels === 1 ? '' : 's'} live` : 'Nothing on air'}
                </span>
                <span className="block text-[11.5px] text-ink-faint">
                  {live.viewers > 0 ? `${live.viewers} watching now` : 'No one watching'}
                </span>
              </span>
            )}
          </Link>
        )}
        {onToggle && (
          <button
            onClick={onToggle}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cx(
              'mt-2 flex items-center gap-2.5 h-8 w-full rounded-lg text-[12.5px] text-ink-faint hover:text-ink-soft hover:bg-white/[0.035] transition-colors',
              collapsed ? 'justify-center' : 'px-2.5',
            )}
          >
            <Icon name={collapsed ? 'expand' : 'collapse'} size={16} />
            {!collapsed && 'Collapse'}
          </button>
        )}
      </div>
    </aside>
  )
}

/** Server status in the top bar: a dot, and the details on click. */
function HealthButton({ health, reachable }: { health: Health | null; reachable: boolean | null }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const ok = reachable === true && (health?.ffmpeg ?? true)
  const tone =
    reachable === null
      ? { dot: 'bg-amber-400', label: 'Connecting…' }
      : !reachable
        ? { dot: 'bg-rose-500', label: 'Server unreachable' }
        : ok
          ? { dot: 'bg-emerald-400', label: 'All systems normal' }
          : { dot: 'bg-amber-400', label: 'ffmpeg missing' }

  const uptime = (s: number) => {
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 h-8 rounded-lg px-2.5 text-[12.5px] text-ink-muted hover:text-ink hover:bg-white/[0.05] transition-colors"
        aria-expanded={open}
      >
        <span className="relative flex w-2 h-2">
          {ok && <span className={cx('absolute inset-0 rounded-full pulse-live', tone.dot)} />}
          <span className={cx('relative w-2 h-2 rounded-full', tone.dot)} />
        </span>
        <span className="hidden md:inline">{tone.label}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-edge-strong bg-overlay/95 backdrop-blur p-3 shadow-2xl shadow-black/60 modal-in z-50">
          <div className="text-[13px] font-semibold text-ink mb-2">{tone.label}</div>
          {health ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
              <dt className="text-ink-faint">Version</dt>
              <dd className="text-ink-soft tabular-nums">v{health.version}</dd>
              <dt className="text-ink-faint">Uptime</dt>
              <dd className="text-ink-soft tabular-nums">{uptime(health.uptimeSeconds)}</dd>
              <dt className="text-ink-faint">Node</dt>
              <dd className="text-ink-soft tabular-nums">{health.node}</dd>
              <dt className="text-ink-faint">ffmpeg</dt>
              <dd className={health.ffmpeg ? 'text-emerald-300' : 'text-rose-300'}>
                {health.ffmpeg ? 'Available' : 'Not found'}
              </dd>
            </dl>
          ) : (
            <p className="text-[12.5px] text-ink-muted">The MosaicTV server isn't answering. Is the container running?</p>
          )}
          <Link
            to="/logs"
            onClick={() => setOpen(false)}
            className="mt-3 flex items-center justify-between rounded-lg px-2 py-1.5 -mx-1 text-[12.5px] text-indigo-300 hover:bg-white/[0.05]"
          >
            Open logs <Icon name="chevronRight" size={14} />
          </Link>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  // How many channels are actually on air, so the rail can say so at a glance
  // instead of making the user open the Dashboard to find out.
  const [live, setLive] = useState<Live | null>(null)
  const [health, setHealth] = useState<Health | null>(null)
  const [reachable, setReachable] = useState<boolean | null>(null)

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

  // The mobile drawer closes itself on navigation.
  useEffect(() => setMobileOpen(false), [location.pathname])

  const loadLive = () =>
    api
      .channels()
      .then((cs) => {
        const onAir = cs.filter((c) => c.number != null)
        setLive({ channels: onAir.length, viewers: onAir.reduce((n, c) => n + c.viewers, 0) })
      })
      .catch(() => setLive(null))
  const loadHealth = () =>
    api
      .health()
      .then((h) => {
        setHealth(h)
        setReachable(true)
      })
      .catch(() => setReachable(false))

  useEffect(() => {
    loadLive()
    loadHealth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  usePolling(loadLive, 10000)
  usePolling(loadHealth, 30000)

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* private mode — the preference just won't stick */
    }
  }, [collapsed])

  return (
    <div className="min-h-screen text-ink bg-canvas app-backdrop">
      {/* Desktop rail */}
      <div className={cx('hidden lg:block fixed inset-y-0 left-0 z-40', collapsed ? 'w-[72px]' : 'w-[248px]')}>
        <Sidebar
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          live={live}
          version={health?.version ?? null}
        />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px] fade-in" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 left-0 drawer-in shadow-2xl shadow-black/70">
            <Sidebar
              collapsed={false}
              live={live}
              version={health?.version ?? null}
              onNavigate={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      <div className={cx('flex flex-col min-h-screen transition-[padding] duration-200', collapsed ? 'lg:pl-[72px]' : 'lg:pl-[248px]')}>
        <header className="sticky top-0 z-30 glass border-b border-edge/70">
          <div className="flex items-center gap-3 h-14 px-4 sm:px-6 lg:px-8">
            <IconButton icon="menu" label="Open menu" className="lg:hidden -ml-1.5" onClick={() => setMobileOpen(true)} />
            <Link to="/" className="lg:hidden shrink-0 flex items-center gap-2 mr-1">
              <img src="/logo-icon.png" alt="MosaicTV" className="w-7 h-7 shrink-0" />
            </Link>

            {/* A visible entry point for the palette — a shortcut nobody
                discovers is a shortcut nobody uses. */}
            <button
              onClick={() => setPaletteOpen(true)}
              className="group flex items-center gap-2.5 h-9 flex-1 min-w-0 max-w-md rounded-lg border border-edge bg-surface/70 px-3 text-left text-[13px] text-ink-faint hover:border-edge-strong hover:text-ink-muted transition-colors"
            >
              <Icon name="search" size={16} className="shrink-0" />
              <span className="flex-1 truncate">
                <span className="sm:hidden">Search…</span>
                <span className="hidden sm:inline">Search channels, shows, settings…</span>
              </span>
              <span className="hidden sm:inline-flex">
                <Kbd>{PALETTE_HINT}</Kbd>
              </span>
            </button>

            <div className="ml-auto shrink-0 flex items-center gap-1.5">
              <HealthButton health={health} reachable={reachable} />
              <Button variant="secondary" size="sm" icon="cast" onClick={() => setConnectOpen(true)}>
                <span className="hidden sm:inline">Connect a player</span>
                <span className="sm:hidden">Connect</span>
              </Button>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-x-clip">
          <div key={location.pathname} className="max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8 py-7 fade-in">
            <Outlet context={{ openConnect: () => setConnectOpen(true) }} />
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} onConnect={() => setConnectOpen(true)} />
      {connectOpen && <ConnectPlayers onClose={() => setConnectOpen(false)} />}
      <ConfirmHost />
      <ToastContainer />
    </div>
  )
}
