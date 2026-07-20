import { NavLink, Outlet } from 'react-router-dom'
import Icon, { type IconName } from './Icon'

const navItems: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/browse', label: 'Browse', icon: 'browse' },
  { to: '/channels', label: 'Channels', icon: 'channels' },
  { to: '/libraries', label: 'Libraries', icon: 'libraries' },
  { to: '/media', label: 'Media', icon: 'media' },
  { to: '/logs', label: 'Logs', icon: 'logs' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

export default function Layout() {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return (
    <div className="min-h-screen text-slate-100 flex bg-slate-950 bg-[radial-gradient(1000px_600px_at_8%_-10%,rgba(139,92,246,0.10),transparent_60%),radial-gradient(900px_600px_at_100%_0%,rgba(34,211,238,0.06),transparent_55%)]">
      <aside className="w-56 shrink-0 border-r border-slate-800 bg-slate-900/40 flex flex-col">
        <div className="h-1 bg-gradient-brand" />
        <div className="px-4 py-5 border-b border-slate-800">
          <img src="/logo-wide.png" alt="MosaicTV" className="w-full max-w-[190px]" />
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ' +
                (isActive
                  ? 'bg-gradient-to-r from-violet-500/20 to-cyan-500/10 text-white ring-1 ring-violet-500/30'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200')
              }
            >
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-800 space-y-0.5">
          <div className="px-3 pb-1 text-[10px] uppercase tracking-wide text-slate-600">
            IPTV
          </div>
          <a
            href={`${origin}/iptv/channels.m3u`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 transition-colors"
          >
            <Icon name="m3u" size={16} /> M3U playlist
          </a>
          <a
            href={`${origin}/iptv/xmltv.xml`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 transition-colors"
          >
            <Icon name="xmltv" size={16} /> XMLTV guide
          </a>
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto">
        <div className="max-w-[1800px] mx-auto px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
