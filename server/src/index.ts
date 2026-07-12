import express from 'express'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { prisma } from './db.js'
import { librariesRouter } from './routes/libraries.js'
import { mediaRouter } from './routes/media.js'
import { scanRouter } from './routes/scan.js'

const app = express()
const PORT = Number(process.env.PORT ?? 8688)
const VERSION = process.env.APP_VERSION ?? '0.2.0'
const startedAt = Date.now()

app.use(express.json())

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
checkFfmpeg().then(() => {
  app.listen(PORT, () => {
    console.log(`MeSatzTV v${VERSION} listening on http://0.0.0.0:${PORT}`)
    console.log(`ffmpeg available: ${ffmpegAvailable}`)
  })
})
