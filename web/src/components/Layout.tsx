import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import Icon, { type IconName } from './Icon'
import ToastContainer from './ToastContainer'

const navItems: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/browse', label: 'Browse', icon: 'browse' },
  { to: '/channels', label: 'Channels', icon: 'channels' },
  { to: '/libraries', label: 'Libraries', icon: 'libraries' },
  { to: '/media', label: 'Media', icon: 'media' },
  { to: '/logs', label: 'Logs', icon: 'logs' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

const COLLAPSE_KEY = 'mosaictv.navCollapsed'

export default function Layout() {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && localStorage.getItem(COLLAPSE_KEY) === '1',
  )

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  return (
    <div className="min-h-screen text-slate-100 flex bg-slate-950 bg-[radial-gradient(1000px_600px_at_8%_-10%,rgba(139,92,246,0.10),transparent_60%),radial-gradient(900px_600px_at_100%_0%,rgba(34,211,238,0.06),transparent_55%)]">
      <aside
        className={
          'relative shrink-0 border-r border-slate-800 bg-slate-900/40 flex flex-col transition-[width] duration-200 ' +
          (collapsed ? 'w-[76px]' : 'w-64')
        }
      >
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="absolute top-1/2 -right-3 -translate-y-1/2 z-10 flex items-center justify-center w-6 h-6 rounded-full border border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-100 hover:border-indigo-500 hover:bg-slate-700 transition-colors shadow shadow-black/30"
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
        <div className="px-4 py-5 border-b border-slate-800 flex items-center justify-center overflow-hidden">
          <img
            src={collapsed ? '/logo-icon.png' : '/logo-wide.png'}
            alt="MosaicTV"
            className={collapsed ? 'w-9 h-9' : 'w-full max-w-[210px]'}
          />
        </div>
        <nav className="flex-1 p-3 space-y-1.5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                'flex items-center gap-3 rounded-lg py-2.5 text-base transition-colors ' +
                (collapsed ? 'justify-center px-0' : 'px-3.5') +
                ' ' +
                (isActive
                  ? 'bg-gradient-to-r from-violet-500/20 to-cyan-500/10 text-white ring-1 ring-violet-500/30'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200')
              }
            >
              <Icon name={item.icon} size={22} colored />
              {!collapsed && item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-800 space-y-0.5">
          {!collapsed && (
            <div className="px-3 pb-1 text-[10px] uppercase tracking-wide text-slate-600">
              IPTV
            </div>
          )}
          <a
            href={`${origin}/iptv/channels.m3u`}
            target="_blank"
            rel="noreferrer"
            title={collapsed ? 'M3U playlist' : undefined}
            className={
              'flex items-center gap-3 rounded-lg py-1.5 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 transition-colors ' +
              (collapsed ? 'justify-center px-0' : 'px-3')
            }
          >
            <Icon name="m3u" size={16} /> {!collapsed && 'M3U playlist'}
          </a>
          <a
            href={`${origin}/iptv/xmltv.xml`}
            target="_blank"
            rel="noreferrer"
            title={collapsed ? 'XMLTV guide' : undefined}
            className={
              'flex items-center gap-3 rounded-lg py-1.5 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 transition-colors ' +
              (collapsed ? 'justify-center px-0' : 'px-3')
            }
          >
            <Icon name="xmltv" size={16} /> {!collapsed && 'XMLTV guide'}
          </a>
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto">
        <div className="max-w-[1800px] mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
      <ToastContainer />
    </div>
  )
}
