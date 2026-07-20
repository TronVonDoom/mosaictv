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

function appendToFile(entry: LogEntry): void {
  try {
    const file = logFile()
    rotateIfNeeded(file)
    let line = `${entry.ts} [${entry.level.toUpperCase()}] [${entry.category}] ${entry.message}`
    if (entry.detail) line += '\n' + entry.detail.split('\n').map((l) => '    ' + l).join('\n')
    fs.appendFileSync(file, line + '\n')
  } catch {
    /* never let logging throw */
  }
}

/** Record a log entry (in-memory + file). Safe to call from anywhere. */
export function log(level: LogLevel, category: LogCategory, message: string, detail?: string): void {
  const entry: LogEntry = {
    id: nextId++,
    ts: new Date().toISOString(),
    level,
    category,
    message,
    detail: detail ? detail.slice(-MAX_DETAIL) : undefined,
  }
  buffer.push(entry)
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES)
  appendToFile(entry)
  // Mirror warnings/errors to the container log too, so `docker logs` shows them.
  if (level === 'error') console.error(`[${category}] ${message}`)
  else if (level === 'warn') console.warn(`[${category}] ${message}`)
}

export type LogQuery = {
  level?: LogLevel
  category?: LogCategory
  sinceId?: number // only entries with id > sinceId (for incremental polling)
  limit?: number
}

/** Read entries matching a filter, newest last. */
export function getLogs(q: LogQuery = {}): { entries: LogEntry[]; lastId: number; total: number } {
  let entries = buffer
  if (q.sinceId != null) entries = entries.filter((e) => e.id > q.sinceId!)
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
  return buffer
    .map((e) => {
      let line = `${e.ts} [${e.level.toUpperCase()}] [${e.category}] ${e.message}`
      if (e.detail) line += '\n' + e.detail.split('\n').map((l) => '    ' + l).join('\n')
      return line
    })
    .join('\n')
}
