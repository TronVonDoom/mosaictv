import express from 'express'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { prisma, initDb } from './db.js'
import { log } from './logs.js'
import { warmFiller } from './stream.js'
import { migrateCollectionOwnership } from './migrate.js'
import { librariesRouter } from './routes/libraries.js'
import { mediaRouter } from './routes/media.js'
import { scanRouter } from './routes/scan.js'
import { showsRouter } from './routes/shows.js'
import { fsRouter } from './routes/fs.js'
import { artworkRouter } from './routes/artwork.js'
import { settingsRouter } from './routes/settings.js'
import { metadataRouter } from './routes/metadata.js'
import { collectionsRouter } from './routes/collections.js'
import { channelsRouter } from './routes/channels.js'
import { iptvRouter } from './routes/iptv.js'
import { logosRouter } from './routes/logos.js'
import { logsRouter } from './routes/logs.js'
import { adminRouter } from './routes/admin.js'
import { assetsRouter } from './routes/assets.js'
import { profilesRouter } from './routes/profiles.js'
import { fillersRouter } from './routes/fillers.js'
import { internalRouter } from './routes/internal.js'

const app = express()
const PORT = Number(process.env.PORT ?? 8688)
const VERSION = process.env.APP_VERSION ?? '0.5.0'
const startedAt = Date.now()

app.use(express.json({ limit: '10mb' })) // logo uploads arrive as base64 data URLs

// --- ffmpeg detection -------------------------------------------------------
let ffmpegAvailable = false
function checkFfmpeg(): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version'])
    proc.on('error', () => {
      ffmpegAvailable = false
      resolve()
    })
    proc.on('close', (code) => {
      ffmpegAvailable = code === 0
      resolve()
    })
  })
}

// --- API --------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: VERSION,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    node: process.version,
    ffmpeg: ffmpegAvailable,
  })
})

app.get('/api/stats', async (_req, res) => {
  const [libraries, items, missing, grouped, durationAgg] = await Promise.all([
    prisma.library.count(),
    prisma.mediaItem.count({ where: { missing: false } }),
    prisma.mediaItem.count({ where: { missing: true } }),
    prisma.mediaItem.groupBy({
      by: ['type'],
      where: { missing: false },
      _count: { _all: true },
    }),
    prisma.mediaItem.aggregate({
      where: { missing: false },
      _sum: { durationSec: true },
    }),
  ])
  const byType: Record<string, number> = {}
  for (const g of grouped) byType[g.type] = g._count._all
  res.json({
    libraries,
    items,
    missing,
    byType,
    totalDurationSec: durationAgg._sum.durationSec ?? 0,
  })
})

app.use('/api/libraries', librariesRouter)
app.use('/api/media', mediaRouter)
app.use('/api/scan', scanRouter)
app.use('/api/shows', showsRouter)
app.use('/api/fs', fsRouter)
app.use('/api/artwork', artworkRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/metadata', metadataRouter)
app.use('/api/collections', collectionsRouter)
app.use('/api/channels', channelsRouter)
app.use('/api/logos', logosRouter)
app.use('/api/logs', logsRouter)
app.use('/api/admin', adminRouter)
app.use('/api/assets', assetsRouter)
app.use('/api/profiles', profilesRouter)
app.use('/api/fillers', fillersRouter)
app.use('/iptv', iptvRouter)
// Loopback-only: the channel's outer ffmpeg fetches its per-item streams here.
app.use('/internal', internalRouter)

// --- Static frontend (production only) --------------------------------------
const publicDir = path.join(process.cwd(), 'public')
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(publicDir, 'index.html'))
  })
}

// --- Boot -------------------------------------------------------------------
// One-time migration: turn any legacy single-path library into a folder row.
async function backfillLibraryFolders(): Promise<void> {
  const libs = await prisma.library.findMany({
    where: { path: { not: null } },
    include: { _count: { select: { folders: true } } },
  })
  for (const lib of libs) {
    if (lib._count.folders === 0 && lib.path) {
      await prisma.libraryFolder
        .create({ data: { libraryId: lib.id, path: path.resolve(lib.path) } })
        .catch(() => {})
    }
  }
}

async function boot(): Promise<void> {
  await initDb()
  await backfillLibraryFolders()
  await migrateCollectionOwnership().catch((e) => log('error', 'system', 'Collection ownership migration failed', String(e?.stack || e)))
  await checkFfmpeg()
  app.listen(PORT, () => {
    console.log(`MeSatzTV v${VERSION} listening on http://0.0.0.0:${PORT}`)
    console.log(`ffmpeg available: ${ffmpegAvailable}`)
    log('info', 'system', `MeSatzTV v${VERSION} started — ffmpeg ${ffmpegAvailable ? 'available' : 'NOT available'}`)
  })
  // Pre-build the default filler in the background so the first intermission
  // never blocks on generation.
  if (ffmpegAvailable) warmFiller().catch(() => {})
}

boot()
