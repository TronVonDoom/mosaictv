import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api, ACTIVITY_EVENT, type Activity } from '../lib/api'
import { toast } from '../lib/toast'
import Icon, { type IconName } from './Icon'
import { cx } from './ui'

const KIND_ICON: Record<Activity['kind'], IconName> = { filler: 'clip', scan: 'folder', metadata: 'sparkles' }

// Finished items the viewer has already seen (opened the panel on) or cleared.
// Per-browser conveniences, so storage failing just means they show again.
const SEEN_KEY = 'mosaictv.activity.seen'
const CLEARED_KEY = 'mosaictv.activity.cleared'
function readSet(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
function writeSet(key: string, set: Set<string>) {
  try {
    // Only the most recent ids matter; the server forgets old jobs anyway.
    localStorage.setItem(key, JSON.stringify([...set].slice(-100)))
  } catch {
    /* storage unavailable */
  }
}

function ago(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} hr ago`
}

/**
 * The bell in the top bar: background work (filler generation, library scans,
 * metadata fetches) with live progress, and a toast when something finishes.
 * It polls quickly while anything runs and slowly otherwise, and looks straight
 * away when the app starts a job (ACTIVITY_EVENT).
 */
export default function NotificationBell() {
  const [items, setItems] = useState<Activity[]>([])
  const [open, setOpen] = useState(false)
  const [seen, setSeen] = useState(() => readSet(SEEN_KEY))
  const [cleared, setCleared] = useState(() => readSet(CLEARED_KEY))
  const ref = useRef<HTMLDivElement>(null)
  const states = useRef<Map<string, Activity['state']> | null>(null)
  const location = useLocation()
  const here = useRef(location.pathname)
  here.current = location.pathname

  const refresh = useCallback(async () => {
    let next: Activity[]
    try {
      next = await api.activity()
    } catch {
      return
    }
    // Toast what finished since the last look — but not what had already
    // finished before this page loaded.
    const before = states.current
    if (before) {
      for (const a of next) {
        if (before.get(a.id) !== 'running' || a.state === 'running') continue
        if (a.state === 'error') toast.error(a.detail ? `${a.title}: ${a.detail}` : a.title)
        else toast.success(a.title)
      }
    }
    states.current = new Map(next.map((a) => [a.id, a.state]))
    setItems(next)
  }, [])

  const running = items.some((a) => a.state === 'running')
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, running ? 2000 : 15000)
    window.addEventListener(ACTIVITY_EVENT, refresh)
    return () => {
      clearInterval(t)
      window.removeEventListener(ACTIVITY_EVENT, refresh)
    }
  }, [refresh, running])

  // Close on a click elsewhere.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const shown = items.filter((a) => !cleared.has(a.id))
  const unread = shown.filter((a) => a.state === 'running' || !seen.has(a.id)).length

  function toggle() {
    const next = !open
    setOpen(next)
    if (next) {
      // Opening the panel is reading it: everything finished counts as seen.
      const s = new Set(seen)
      for (const a of shown) if (a.state !== 'running') s.add(a.id)
      setSeen(s)
      writeSet(SEEN_KEY, s)
    }
  }

  function clear() {
    const c = new Set(cleared)
    for (const a of shown) if (a.state !== 'running') c.add(a.id)
    setCleared(c)
    writeSet(CLEARED_KEY, c)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={toggle}
        aria-expanded={open}
        aria-label={unread ? `Notifications (${unread})` : 'Notifications'}
        className="relative grid h-8 w-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-white/[0.05] hover:text-ink"
      >
        <Icon name="bell" size={16} />
        {running ? (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-indigo-400 pulse-live" />
        ) : (
          unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-indigo-500 px-1 text-[10px] font-semibold leading-none text-white tabular-nums">
              {unread}
            </span>
          )
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl border border-edge-strong bg-overlay/95 shadow-2xl shadow-black/60 backdrop-blur modal-in">
          <div className="flex items-center justify-between border-b border-edge px-3.5 py-2.5">
            <span className="text-[13px] font-semibold text-ink">Activity</span>
            {shown.some((a) => a.state !== 'running') && (
              <button onClick={clear} className="text-[12px] text-ink-faint hover:text-ink-soft">
                Clear finished
              </button>
            )}
          </div>
          {shown.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Icon name="bell" size={20} className="mx-auto mb-2 text-ink-ghost" />
              <p className="text-[12.5px] text-ink-faint">Nothing running. Filler generation, library scans and metadata fetches show up here.</p>
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-edge/70 overflow-y-auto">
              {shown.map((a) => (
                <li key={a.id}>
                  <Link
                    to={a.href}
                    onClick={() => setOpen(false)}
                    className="flex gap-3 px-3.5 py-3 transition-colors hover:bg-white/[0.03]"
                  >
                    <span
                      className={cx(
                        'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border',
                        a.state === 'error'
                          ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                          : a.state === 'done'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                            : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-200',
                      )}
                    >
                      <Icon name={a.state === 'error' ? 'warning' : a.state === 'done' ? 'check' : KIND_ICON[a.kind]} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink-soft">{a.title}</span>
                      {a.detail && (
                        <span className={cx('block truncate text-[12px]', a.state === 'error' ? 'text-rose-300/90' : 'text-ink-faint')}>
                          {a.detail}
                        </span>
                      )}
                      {a.state === 'running' ? (
                        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/[0.06]">
                          <span
                            className={cx('block h-full rounded-full bg-indigo-400 transition-[width] duration-500', a.progress == null && 'w-1/3 animate-pulse')}
                            style={a.progress != null ? { width: `${Math.round(a.progress * 100)}%` } : undefined}
                          />
                        </span>
                      ) : (
                        <span className="mt-0.5 block text-[11px] text-ink-ghost">{ago(a.finishedAt ?? a.startedAt)}</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
