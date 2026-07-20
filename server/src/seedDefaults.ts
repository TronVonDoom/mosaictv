import fs from 'node:fs'
import path from 'node:path'
import { prisma } from './db.js'
import { assetsDir } from './paths.js'
import { log } from './logs.js'

const FLAG = 'seeded_default_audio'

// Bundled starter tracks (web/public/defaults, shipped via the frontend build
// the same way the fallback logo is — see localLogo() in stream.ts) so a
// fresh install has something to attach to filler right away.
const DEFAULTS = [
  { name: 'Late Night Glow', file: 'late-night-glow.mp3' },
  { name: 'Saturday Cartoon Mayhem', file: 'saturday-cartoon-mayhem.mp3' },
]

/**
 * One-time seed of default audio Assets. Idempotent — guarded by a Setting
 * flag. Skips silently if the bundled files aren't present (e.g. local dev
 * without a built frontend, where process.cwd()/public doesn't exist).
 */
export async function seedDefaultAudio(): Promise<void> {
  if (await prisma.setting.findUnique({ where: { key: FLAG } })) return

  let seeded = 0
  for (const d of DEFAULTS) {
    const src = path.join(process.cwd(), 'public', 'defaults', d.file)
    if (!fs.existsSync(src)) continue
    const buf = fs.readFileSync(src)
    const asset = await prisma.asset.create({
      data: { name: d.name, kind: 'audio', filename: 'pending', mime: 'audio/mpeg', sizeBytes: buf.length },
    })
    const filename = `asset-${asset.id}.mp3`
    fs.writeFileSync(path.join(assetsDir(), filename), buf)
    await prisma.asset.update({ where: { id: asset.id }, data: { filename } })
    seeded++
  }

  await prisma.setting.create({ data: { key: FLAG, value: new Date().toISOString() } })
  if (seeded > 0) log('info', 'system', `Seeded ${seeded} default audio track(s)`)
}
