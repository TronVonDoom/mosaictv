import { Router } from 'express'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../db.js'
import { dataDir, logoCacheDir, logosDir, tmdbCacheDir } from '../paths.js'
import { log } from '../logs.js'

export const adminRouter = Router()

// Download a gzipped tarball of the whole data dir (DB + logos + filler +
// settings) so a working state can be saved before experimenting.
adminRouter.get('/backup', async (_req, res) => {
  const dir = dataDir()
  // Flush the WAL into the main DB file so the tarred snapshot is consistent.
  await prisma.$executeRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE);').catch(() => {})
  const name = `mosaictv-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`
  res.setHeader('Content-Type', 'application/gzip')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  // Tar the contents of the data dir (portable across container recreations).
  const tar = spawn('tar', ['czf', '-', '-C', dir, '.'])
  let err = ''
  tar.stderr.on('data', (d) => (err += d))
  tar.stdout.pipe(res)
  tar.on('error', (e) => {
    log('error', 'system', 'Backup failed to start (tar missing?)', String(e))
    if (!res.headersSent) res.status(500).json({ error: 'Backup failed: ' + e.message })
    else res.end()
  })
  tar.on('close', (code) => {
    if (code !== 0) log('error', 'system', `Backup tar exited ${code}`, err.slice(-500))
  })
})

// Wipe the instance back to a clean slate. Destructive — requires an explicit
// confirmation string. Clears all DB rows and (optionally) uploaded assets.
adminRouter.post('/reset', async (req, res) => {
  if (req.body?.confirm !== 'RESET') {
    return res.status(400).json({ error: 'Send { "confirm": "RESET" } to proceed.' })
  }
  const wipeAssets = req.body?.assets !== false // default true

  try {
    // Delete children before parents (FK-safe), then standalone tables.
    await prisma.playoutItem.deleteMany()
    await prisma.rotationItem.deleteMany()
    await prisma.timeBlock.deleteMany()
    await prisma.channel.deleteMany()
    await prisma.collectionItem.deleteMany()
    await prisma.collection.deleteMany()
    await prisma.season.deleteMany()
    await prisma.show.deleteMany()
    await prisma.mediaItem.deleteMany()
    await prisma.libraryFolder.deleteMany()
    await prisma.library.deleteMany()
    await prisma.logo.deleteMany()
    await prisma.setting.deleteMany()

    if (wipeAssets) {
      // Uploaded logos.
      for (const f of fs.readdirSync(logosDir())) {
        fs.rmSync(path.join(logosDir(), f), { force: true })
      }
      // Generated filler(s).
      for (const f of fs.readdirSync(dataDir())) {
        if (/^filler.*\.mp4$/i.test(f)) fs.rmSync(path.join(dataDir(), f), { force: true })
      }
      // Downloaded caches — all regenerable on demand.
      for (const dir of [tmdbCacheDir(), logoCacheDir()]) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }

    log('warn', 'system', `Instance reset to a clean slate (assets ${wipeAssets ? 'wiped' : 'kept'})`)
    res.json({ ok: true })
  } catch (e) {
    log('error', 'system', 'Reset failed', String((e as Error)?.stack || e))
    res.status(500).json({ error: 'Reset failed: ' + (e instanceof Error ? e.message : 'unknown') })
  }
})
