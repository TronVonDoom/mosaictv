import fs from 'node:fs/promises'
import path from 'node:path'
import { prisma } from '../db.js'
import { ffprobe } from '../ffprobe.js'
import { parseMedia, type LibraryKind } from './parse.js'

const VIDEO_EXTS = new Set([
  '.mkv', '.mp4', '.m4v', '.avi', '.mov', '.ts', '.m2ts',
  '.wmv', '.flv', '.webm', '.mpg', '.mpeg',
])

const PROBE_CONCURRENCY = 4

export type ScanStatus = {
  running: boolean
  libraryId: number | null
  libraryName: string | null
  total: number
  processed: number
  added: number
  updated: number
  removed: number
  skipped: number
  currentPath: string | null
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

// Single shared scan job — only one scan runs at a time.
const status: ScanStatus = {
  running: false,
  libraryId: null,
  libraryName: null,
  total: 0,
  processed: 0,
  added: 0,
  updated: 0,
  removed: 0,
  skipped: 0,
  currentPath: null,
  startedAt: null,
  finishedAt: null,
  error: null,
}

export function getScanStatus(): ScanStatus {
  return status
}

export function isScanning(): boolean {
  return status.running
}

/** Recursively collect all video file paths under a directory. */
async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await walk(full)))
    } else if (entry.isFile() && VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) {
      out.push(full)
    }
  }
  return out
}

/** Process a single file: skip if unchanged, otherwise probe + upsert. */
async function processFile(
  filePath: string,
  libraryId: number,
  libraryPath: string,
  kind: LibraryKind,
): Promise<void> {
  status.currentPath = filePath
  const stat = await fs.stat(filePath)
  // Floor to whole milliseconds: fractional mtimes lose precision when stored
  // as SQLite REAL, so an exact float compare would never match. Integer ms
  // round-trips exactly and is more than precise enough for change detection.
  const mtimeMs = Math.floor(stat.mtimeMs)
  const existing = await prisma.mediaItem.findUnique({ where: { path: filePath } })

  // Unchanged file we've already indexed — just clear any "missing" flag.
  if (existing && existing.mtimeMs === mtimeMs && !existing.missing) {
    status.skipped++
    return
  }

  const probe = await ffprobe(filePath)
  const parsed = parseMedia(filePath, libraryPath, kind)
  const data = {
    libraryId,
    type: parsed.type,
    title: parsed.title,
    showTitle: parsed.showTitle,
    season: parsed.season,
    episode: parsed.episode,
    year: parsed.year,
    durationSec: probe?.durationSec ?? null,
    width: probe?.width ?? null,
    height: probe?.height ?? null,
    videoCodec: probe?.videoCodec ?? null,
    audioCodec: probe?.audioCodec ?? null,
    container: probe?.container ?? null,
    sizeBytes: stat.size,
    mtimeMs,
    missing: false,
  }

  await prisma.mediaItem.upsert({
    where: { path: filePath },
    create: { path: filePath, ...data },
    update: data,
  })

  if (existing) status.updated++
  else status.added++
}

/** Run tasks with bounded concurrency. */
async function runPool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (index < items.length) {
      const i = index++
      await fn(items[i])
      status.processed++
    }
  })
  await Promise.all(workers)
}

/**
 * Scan a single library: index new/changed files and mark vanished files as
 * missing. Runs in the background; progress is exposed via getScanStatus().
 */
export async function scanLibrary(libraryId: number): Promise<void> {
  const library = await prisma.library.findUnique({ where: { id: libraryId } })
  if (!library) throw new Error(`Library ${libraryId} not found`)

  Object.assign(status, {
    running: true,
    libraryId: library.id,
    libraryName: library.name,
    total: 0,
    processed: 0,
    added: 0,
    updated: 0,
    removed: 0,
    skipped: 0,
    currentPath: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  })

  try {
    const files = await walk(library.path)
    status.total = files.length

    await runPool(files, PROBE_CONCURRENCY, (f) =>
      processFile(f, library.id, library.path, library.kind as LibraryKind),
    )

    // Anything in this library not seen in this scan pass is now missing.
    const seen = new Set(files)
    const known = await prisma.mediaItem.findMany({
      where: { libraryId: library.id, missing: false },
      select: { id: true, path: true },
    })
    const goneIds = known.filter((k) => !seen.has(k.path)).map((k) => k.id)
    if (goneIds.length > 0) {
      await prisma.mediaItem.updateMany({
        where: { id: { in: goneIds } },
        data: { missing: true },
      })
      status.removed = goneIds.length
    }
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err)
  } finally {
    status.running = false
    status.currentPath = null
    status.finishedAt = new Date().toISOString()
  }
}
