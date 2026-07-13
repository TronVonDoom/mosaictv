import { NavLink, Outlet } from 'react-router-dom'

const navItems = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/browse', label: 'Browse', icon: '🎬' },
  { to: '/channels', label: 'Channels', icon: '📡' },
  { to: '/collections', label: 'Collections', icon: '🗂️' },
  { to: '/libraries', label: 'Libraries', icon: '📁' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

export default function Layout() {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex">
      <aside className="w-56 shrink-0 border-r border-slate-800 bg-slate-900/40 flex flex-col">
        <div className="flex items-center gap-2 px-5 py-5 border-b border-slate-800">
          <span className="text-2xl">📺</span>
          <span className="text-lg font-bold tracking-tight">
            Me<span className="text-indigo-400">Satz</span>TV
          </span>
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
                  ? 'bg-indigo-500/15 text-indigo-300'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200')
              }
            >
              <span>{item.icon}</span>
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
            <span>🎞️</span> M3U playlist
          </a>
          <a
            href={`${origin}/iptv/xmltv.xml`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 transition-colors"
          >
            <span>🗓️</span> XMLTV guide
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
