// Which logo is on air right now, and how to turn it into a file ffmpeg can
// overlay. Shared by the live stream (corner watermark) and filler generation
// (logo-branded idents).

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { prisma } from '../db.js'
import { logoCacheDir, logosDir } from '../paths.js'

/**
 * The block active at a given local time (first match wins). Generic so callers
 * keep whatever relations they included (collection, fillers, …).
 */
export function activeBlockAt<T extends { days: string; startMinute: number; endMinute: number }>(blocks: T[], date: Date): T | null {
  const day = date.getDay()
  const prev = (day + 6) % 7
  const tod = date.getHours() * 60 + date.getMinutes()
  for (const b of blocks) {
    const days = b.days.split(',').map((s) => Number(s.trim()))
    if (b.endMinute > b.startMinute) {
      if (days.includes(day) && tod >= b.startMinute && tod < b.endMinute) return b
    } else {
      if (days.includes(day) && tod >= b.startMinute) return b
      if (days.includes(prev) && tod < b.endMinute) return b
    }
  }
  return null
}

/**
 * The logo active at a given time: block override → the block's collection logo
 * → channel default. Returns the Logo row id (for its per-logo watermark) and
 * the raw file path / URL to overlay.
 */
export function activeLogo(
  channel: { logoId: number | null; logoUrl: string | null },
  blocks: Array<{ days: string; startMinute: number; endMinute: number; logoId: number | null; logoUrl: string | null; collection: { logoId: number | null } }>,
  logoPath: Map<number, string>,
  at: Date,
): { id: number | null; raw: string | null } {
  const block = activeBlockAt(blocks, at)
  const id = block?.logoId ?? block?.collection.logoId ?? channel.logoId
  if (id != null && logoPath.has(id)) return { id, raw: logoPath.get(id) as string }
  return { id: null, raw: block?.logoUrl || channel.logoUrl || null }
}

// Resolve a logo (local path or http url) to a usable local file, downloading
// and caching http logos. Falls back to the bundled icon so a bad URL never
// breaks the stream.
const logoCache = new Map<string, string | undefined>()
export async function localLogo(raw: string | null): Promise<string | undefined> {
  const fallback = path.join(process.cwd(), 'public', 'mosaictv-icon.png')
  const fb = fs.existsSync(fallback) ? fallback : undefined
  if (!raw) return fb
  if (logoCache.has(raw)) return logoCache.get(raw)

  let result: string | undefined
  if (/^https?:\/\//i.test(raw)) {
    try {
      // Bounded: a hung logo host must never hold an item open — the outer
      // concat process would wait on it forever and the viewer sees a spinner.
      const r = await fetch(raw, { signal: AbortSignal.timeout(5000) })
      if (r.ok) {
        const file = path.join(logoCacheDir(), createHash('md5').update(raw).digest('hex') + '.png')
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()))
        result = file
      }
    } catch {
      /* ignore — fall back below */
    }
  } else if (fs.existsSync(raw)) {
    result = raw
  }
  result = result ?? fb
  logoCache.set(raw, result)
  return result
}

/** Resolve the on-disk logo file for a logo id (or legacy url), for branding. */
export async function logoFileById(logoId: number | null, logoUrl: string | null): Promise<string | undefined> {
  if (logoId != null) {
    const l = await prisma.logo.findUnique({ where: { id: logoId } })
    if (l) return localLogo(path.join(logosDir(), l.filename))
  }
  return localLogo(logoUrl || null)
}
