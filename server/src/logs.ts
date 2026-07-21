import fs from 'node:fs'
import path from 'node:path'
import { dataDir } from './paths.js'

// Lightweight app log: a live in-memory ring buffer (fast to read from the UI)
// backed by a size-rotated file under the data dir (survives restarts/crashes,
// so an ffmpeg error that killed a stream is still there afterwards).

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogCategory = 'stream' | 'ffmpeg' | 'playout' | 'system'

export type LogEntry = {
  id: number
  ts: string // ISO timestamp
  level: LogLevel
  category: LogCategory
  message: string
  detail?: string // longer context (e.g. ffmpeg stderr tail)
  session?: string // which viewer stream this belongs to, e.g. "V3 Plex"
}

const MAX_ENTRIES = 3000 // in-memory ring buffer size
const MAX_DETAIL = 8000 // clamp a single detail blob
const MAX_FILE_BYTES = 5 * 1024 * 1024 // rotate the log file at 5 MB

const buffer: LogEntry[] = []
let nextId = 1

function logsDir(): string {
  const d = path.join(dataDir(), 'logs')
  fs.mkdirSync(d, { recursive: true })
  return d
}
function logFile(): string {
  return path.join(logsDir(), 'mosaictv.log')
}

function rotateIfNeeded(file: string): void {
  try {
    const st = fs.statSync(file)
    if (st.size < MAX_FILE_BYTES) return
    fs.renameSync(file, file + '.1') // keep one previous generation
  } catch {
    /* file doesn't exist yet — nothing to rotate */
  }
}

/** One entry as a plain-text line (plus indented detail), for file + dump. */
function formatEntry(e: LogEntry): string {
  let line = `${e.ts} [${e.level.toUpperCase()}] [${e.category}]`
  if (e.session) line += ` [${e.session}]`
  line += ` ${e.message}`
  if (e.detail) line += '\n' + e.detail.split('\n').map((l) => '    ' + l).join('\n')
  return line
}

function appendToFile(entry: LogEntry): void {
  try {
    const file = logFile()
    rotateIfNeeded(file)
    fs.appendFileSync(file, formatEntry(entry) + '\n')
  } catch {
    /* never let logging throw */
  }
}

/**
 * Record a log entry (in-memory + file). Safe to call from anywhere.
 *
 * `session` names the viewer stream the entry belongs to (see sessions.ts) so
 * concurrent viewers stay tellable apart; omit it for server-wide events.
 */
export function log(
  level: LogLevel,
  category: LogCategory,
  message: string,
  detail?: string,
  session?: string,
): void {
  const entry: LogEntry = {
    id: nextId++,
    ts: new Date().toISOString(),
    level,
    category,
    message,
    detail: detail ? detail.slice(-MAX_DETAIL) : undefined,
    session,
  }
  buffer.push(entry)
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)
  appendToFile(entry)
  // Mirror warnings/errors to the container log too, so `docker logs` shows them.
  const who = session ? `[${session}] ` : ''
  if (level === 'error') console.error(`[${category}] ${who}${message}`)
  else if (level === 'warn') console.warn(`[${category}] ${who}${message}`)
}

export type LogQuery = {
  level?: LogLevel
  category?: LogCategory
  sinceId?: number // only entries with id > sinceId (for incremental polling)
  limit?: number
  // Debug is verbose (every ffmpeg command line, every segment, the load
  // heartbeat) and drowns the interesting lines, so the viewer asks for it
  // explicitly. Everything is still recorded either way — this only filters
  // what's handed back, never what's kept or dumped.
  includeDebug?: boolean
}

/** Read entries matching a filter, newest last. */
export function getLogs(q: LogQuery = {}): { entries: LogEntry[]; lastId: number; total: number } {
  let entries = buffer
  if (q.sinceId != null) entries = entries.filter((e) => e.id > q.sinceId!)
  // An explicit level filter of 'debug' is itself a request for debug.
  if (!q.includeDebug && q.level !== 'debug') entries = entries.filter((e) => e.level !== 'debug')
  if (q.level) entries = entries.filter((e) => e.level === q.level)
  if (q.category) entries = entries.filter((e) => e.category === q.category)
  const total = entries.length
  const limit = q.limit && q.limit > 0 ? q.limit : 500
  if (entries.length > limit) entries = entries.slice(entries.length - limit)
  const lastId = buffer.length ? buffer[buffer.length - 1].id : 0
  return { entries, lastId, total }
}

/** Clear the in-memory buffer and truncate the on-disk log. */
export function clearLogs(): void {
  buffer.length = 0
  try {
    fs.writeFileSync(logFile(), '')
    fs.rmSync(logFile() + '.1', { force: true })
  } catch {
    /* ignore */
  }
}

/** Full plain-text dump (buffer only) for the download button. */
export function dumpText(): string {
  return buffer.map(formatEntry).join('\n')
}
