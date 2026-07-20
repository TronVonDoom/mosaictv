import { Router } from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'

export const fsRouter = Router()

// The directory picker may only browse inside the mounted media root. Without
// this clamp the endpoint would happily list any directory on the host.
// Override with MEDIA_ROOT for unusual mounts (or local dev on Windows).
const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT || '/media')

function insideMediaRoot(p: string): boolean {
  return p === MEDIA_ROOT || p.startsWith(MEDIA_ROOT + path.sep)
}

// GET /api/fs?path=/media  -> list subdirectories for the directory picker.
// Read-only, directories only. Defaults to the media root.
fsRouter.get('/', async (req, res) => {
  const requested =
    typeof req.query.path === 'string' && req.query.path.trim()
      ? req.query.path
      : MEDIA_ROOT
  const target = path.resolve(requested)

  if (!insideMediaRoot(target)) {
    res.status(403).json({
      error: `Browsing is limited to the media root (${MEDIA_ROOT}). Mount your library there, or set MEDIA_ROOT.`,
    })
    return
  }

  try {
    const entries = await fs.readdir(target, { withFileTypes: true })
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => ({ name: e.name, path: path.join(target, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    const parent = path.dirname(target)
    res.json({
      path: target,
      // Never offer to climb above the media root.
      parent: parent === target || !insideMediaRoot(parent) ? null : parent,
      dirs,
    })
  } catch {
    res.status(400).json({ error: `Cannot open folder: ${target}` })
  }
})
