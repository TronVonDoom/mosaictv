import { useCallback, useEffect, useRef, useState } from 'react'
import { api, logsDownloadUrl, type LogCategory, type LogEntry, type LogLevel } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { usePolling } from '../lib/hooks'
import { Button, LinkButton, PageHeader, Select } from '../components/ui'

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

  usePolling(refresh, 2000, autoRefresh)

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
      <PageHeader
        title="Logs"
        icon="logs"
        description="FFmpeg errors, stream connect/disconnect events, playout builds, and other diagnostics. Copy or download these when reporting a problem."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={copyAll}>
              {copied ? 'Copied ✓' : 'Copy all'}
            </Button>
            <LinkButton size="sm" href={logsDownloadUrl}>
              Download
            </LinkButton>
            <Button variant="danger" size="sm" onClick={clearAll}>
              Clear
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Select
          value={level}
          onChange={(e) => setLevel(e.target.value as LogLevel | 'all')}
          className="py-1.5"
          aria-label="Filter by level"
        >
          {LEVELS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </Select>
        <Select
          value={category}
          onChange={(e) => setCategory(e.target.value as LogCategory | 'all')}
          className="py-1.5"
          aria-label="Filter by source"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm text-ink-muted select-none">
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto-refresh
        </label>
        <button onClick={manualRefresh} className="text-sm text-ink-muted hover:text-ink-soft">
          {flash ? 'Refreshed ✓' : 'Refresh now'}
        </button>
        <span className="text-xs text-ink-faint ml-auto tabular-nums">{total} matching entries</span>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="rounded-xl border border-edge bg-canvas/80 font-mono text-xs leading-relaxed h-[62vh] overflow-auto p-3 space-y-1"
      >
        {entries.length === 0 ? (
          <div className="text-ink-faint p-4 text-center">
            No log entries match these filters.
          </div>
        ) : (
          entries.map((e) => (
            <div key={e.id} className="flex gap-2 items-start">
              <span className="text-ink-faint shrink-0 tabular-nums">
                {new Date(e.ts).toLocaleTimeString()}
              </span>
              <span
                className={
                  'shrink-0 rounded border px-1.5 text-[10px] uppercase tracking-wide ' + levelStyle[e.level]
                }
              >
                {e.level}
              </span>
              <span className="text-ink-faint shrink-0">[{e.category}]</span>
              <span className="text-ink-soft whitespace-pre-wrap break-words min-w-0">
                {e.message}
                {e.detail && <span className="block text-ink-faint mt-0.5 pl-1">{e.detail}</span>}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
