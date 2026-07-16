import { useCallback, useEffect, useRef, useState } from 'react'
import { api, logsDownloadUrl, type LogCategory, type LogEntry, type LogLevel } from '../lib/api'
import { copyText } from '../lib/clipboard'

const LEVELS: { value: LogLevel | 'all'; label: string }[] = [
  { value: 'all', label: 'All levels' },
  { value: 'error', label: 'Errors' },
  { value: 'warn', label: 'Warnings' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
]
const CATEGORIES: { value: LogCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All sources' },
  { value: 'stream', label: 'Streams' },
  { value: 'ffmpeg', label: 'FFmpeg' },
  { value: 'playout', label: 'Playout' },
  { value: 'system', label: 'System' },
]

const levelStyle: Record<LogLevel, string> = {
  error: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
  warn: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  info: 'text-sky-300 border-sky-500/30 bg-sky-500/10',
  debug: 'text-slate-400 border-slate-600/40 bg-slate-600/10',
}

export default function Logs() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [level, setLevel] = useState<LogLevel | 'all'>('all')
  const [category, setCategory] = useState<LogCategory | 'all'>('all')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [total, setTotal] = useState(0)
  const [copied, setCopied] = useState(false)
  const [flash, setFlash] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const refresh = useCallback(async () => {
    const res = await api
      .logs({
        level: level === 'all' ? undefined : level,
        category: category === 'all' ? undefined : category,
        limit: 1000,
      })
      .catch(() => null)
    if (res) {
      setEntries(res.entries)
      setTotal(res.total)
    }
  }, [level, category])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [autoRefresh, refresh])

  // Keep the view pinned to the newest entry unless the user scrolls up.
  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [entries])

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  // Manual refresh: always jump to the newest entry and flash feedback, so it's
  // obvious it ran even when no new lines arrived.
  async function manualRefresh() {
    stickToBottom.current = true
    await refresh()
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
    setFlash(true)
    setTimeout(() => setFlash(false), 600)
  }

  async function copyAll() {
    const text = entries
      .map((e) => {
        let s = `${e.ts} [${e.level.toUpperCase()}] [${e.category}] ${e.message}`
        if (e.detail) s += '\n    ' + e.detail.replace(/\n/g, '\n    ')
        return s
      })
      .join('\n')
    if (await copyText(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
    // if copying is blocked outright, the download button still works
  }

  async function clearAll() {
    if (!confirm('Clear all logs? This wipes the in-memory buffer and the log file.')) return
    await api.clearLogs().catch(() => {})
    stickToBottom.current = true
    refresh()
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-2xl font-bold">Logs</h1>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={copyAll}
            className="rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-700 px-3 py-1.5 text-sm"
          >
            {copied ? 'Copied ✓' : 'Copy all'}
          </button>
          <a
            href={logsDownloadUrl}
            className="rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-700 px-3 py-1.5 text-sm"
          >
            Download
          </a>
          <button
            onClick={clearAll}
            className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 px-3 py-1.5 text-sm"
          >
            Clear
          </button>
        </div>
      </div>
      <p className="text-slate-400 text-sm mb-5">
        FFmpeg errors, stream connect/disconnect events, playout builds, and other diagnostics. Copy or
        download these when reporting a problem.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={level}
          onChange={(e) => setLevel(e.target.value as LogLevel | 'all')}
          className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm focus:border-indigo-500 outline-none"
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as LogCategory | 'all')}
          className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm focus:border-indigo-500 outline-none"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-400 select-none">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto-refresh
        </label>
        <button onClick={manualRefresh} className="text-sm text-slate-400 hover:text-slate-200">
          {flash ? 'Refreshed ✓' : 'Refresh now'}
        </button>
        <span className="text-xs text-slate-600 ml-auto">{total} matching entries</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="rounded-xl border border-slate-800 bg-slate-950/80 font-mono text-xs leading-relaxed h-[62vh] overflow-auto p-3 space-y-1"
      >
        {entries.length === 0 ? (
          <div className="text-slate-600 p-4 text-center">No log entries yet.</div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="flex gap-2 items-start">
              <span className="text-slate-600 shrink-0 tabular-nums">
                {new Date(e.ts).toLocaleTimeString()}
              </span>
              <span
                className={
                  'shrink-0 rounded border px-1.5 text-[10px] uppercase tracking-wide ' + levelStyle[e.level]
                }
              >
                {e.level}
              </span>
              <span className="text-slate-500 shrink-0">[{e.category}]</span>
              <span className="text-slate-200 whitespace-pre-wrap break-words min-w-0">
                {e.message}
                {e.detail && <span className="block text-slate-500 mt-0.5 pl-1">{e.detail}</span>}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
