import { Router } from 'express'
import { prisma } from '../db.js'
import { getMetadataStatus } from '../metadata.js'
import { getScanStatus } from '../scanner/scanner.js'
import { fillerJobs } from './fillers.js'

export const activityRouter = Router()

/** One piece of background work, for the notification bell. */
export type Activity = {
  /** Stable for one run of one job, so the client can tell runs apart. */
  id: string
  kind: 'filler' | 'scan' | 'metadata'
  title: string
  detail: string | null
  state: 'running' | 'done' | 'error'
  /** 0–1 while running, when it's known. */
  progress: number | null
  startedAt: string
  finishedAt: string | null
  /** Where in the app to follow it up. */
  href: string
}

// A finished job stays listed this long, so a page opened later still hears how it went.
const KEEP_MS = 60 * 60_000

const recent = (finishedAt: string | null) => !finishedAt || Date.now() - new Date(finishedAt).getTime() < KEEP_MS
const fraction = (done: number, total: number) => (total > 0 ? Math.min(1, done / total) : null)

// GET /api/activity — what's working in the background: filler generation,
// library scans and metadata fetches, running or recently finished. Each is
// read from the state its own job already keeps, newest first.
activityRouter.get('/', async (_req, res) => {
  const items: Activity[] = []

  const jobs = fillerJobs()
  const fillers = jobs.length
    ? await prisma.filler.findMany({ where: { id: { in: jobs.map((j) => j.fillerId) } }, select: { id: true, name: true, style: true } })
    : []
  for (const j of jobs) {
    const f = fillers.find((x) => x.id === j.fillerId)
    const name = f?.name?.trim() || (f ? `${f.style} filler` : `Filler ${j.fillerId}`)
    items.push({
      id: `filler:${j.fillerId}:${j.startedAt}`,
      kind: 'filler',
      title: j.done ? (j.error ? `Couldn’t generate “${name}”` : `“${name}” is ready`) : `Generating “${name}”`,
      detail: j.error ?? (j.done ? 'Filler clip generated' : null),
      state: j.done ? (j.error ? 'error' : 'done') : 'running',
      progress: j.done ? null : j.percent / 100,
      startedAt: new Date(j.startedAt).toISOString(),
      finishedAt: j.finishedAt ? new Date(j.finishedAt).toISOString() : null,
      href: '/studio#fillers',
    })
  }

  const scan = getScanStatus()
  if (scan.startedAt && (scan.running || recent(scan.finishedAt))) {
    const lib = scan.libraryName ?? 'library'
    items.push({
      id: `scan:${scan.startedAt}`,
      kind: 'scan',
      title: scan.running ? `Scanning ${lib}` : scan.error ? `Scan of ${lib} failed` : `Scanned ${lib}`,
      detail: scan.error ?? (scan.running ? `${scan.processed.toLocaleString()} of ${scan.total.toLocaleString()} files` : `${scan.added} added · ${scan.updated} updated · ${scan.removed} removed`),
      state: scan.running ? 'running' : scan.error ? 'error' : 'done',
      progress: scan.running ? fraction(scan.processed, scan.total) : null,
      startedAt: scan.startedAt,
      finishedAt: scan.finishedAt,
      href: '/library#sources',
    })
  }

  const meta = getMetadataStatus()
  if (meta.startedAt && (meta.running || recent(meta.finishedAt))) {
    const lib = meta.libraryName ?? 'library'
    items.push({
      id: `metadata:${meta.startedAt}`,
      kind: 'metadata',
      title: meta.running ? `Fetching metadata for ${lib}` : meta.error ? `Metadata for ${lib} failed` : `Metadata fetched for ${lib}`,
      detail: meta.error ?? (meta.running ? meta.currentTitle : `${meta.matched.toLocaleString()} matched · ${meta.unmatched.toLocaleString()} not found`),
      state: meta.running ? 'running' : meta.error ? 'error' : 'done',
      progress: meta.running ? fraction(meta.processed, meta.total) : null,
      startedAt: meta.startedAt,
      finishedAt: meta.finishedAt,
      href: '/settings#metadata',
    })
  }

  items.sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt))
  res.json(items)
})
