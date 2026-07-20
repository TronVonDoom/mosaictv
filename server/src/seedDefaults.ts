import fs from 'node:fs'
import path from 'node:path'
import { prisma } from './db.js'
import { assetsDir } from './paths.js'
import { log } from './logs.js'

// Bundled starter tracks (web/public/defaults, shipped via the frontend build
// the same way the fallback logo is — see localLogo() in streaming/logo.ts) so a
// fresh install has something to attach to filler right away. Each one seeds
// independently and permanently (its flag persists even if the user later
// deletes the asset), so adding a new default here also seeds it for
// existing installs on their next boot, without resurrecting ones a user
// intentionally removed.
const DEFAULTS = [
  { name: 'Late Night Glow', file: 'late-night-glow.mp3' },
  { name: 'Saturday Cartoon Mayhem', file: 'saturday-cartoon-mayhem.mp3' },
  { name: 'Christmas Morning', file: 'christmas-morning.mp3' },
  { name: 'Halloween Night', file: 'halloween-night.mp3' },
]

const flagKey = (file: string) => `seeded_audio_${file}`

/**
 * Seed default audio Assets, one at a time. Each is idempotent via its own
 * Setting flag. If the bundled file isn't present yet (e.g. local dev without
 * a built frontend, where process.cwd()/public doesn't exist), that track's
 * flag is left unset so it's retried on a later boot instead of being
 * silently skipped forever.
 */
export async function seedDefaultAudio(): Promise<void> {
  let seeded = 0
  for (const d of DEFAULTS) {
    const key = flagKey(d.file)
    if (await prisma.setting.findUnique({ where: { key } })) continue
    const src = path.join(process.cwd(), 'public', 'defaults', d.file)
    if (!fs.existsSync(src)) continue

    const buf = fs.readFileSync(src)
    const asset = await prisma.asset.create({
      data: { name: d.name, kind: 'audio', filename: 'pending', mime: 'audio/mpeg', sizeBytes: buf.length },
    })
    const filename = `asset-${asset.id}.mp3`
    fs.writeFileSync(path.join(assetsDir(), filename), buf)
    await prisma.asset.update({ where: { id: asset.id }, data: { filename } })
    await prisma.setting.create({ data: { key, value: new Date().toISOString() } })
    seeded++
  }
  if (seeded > 0) log('info', 'system', `Seeded ${seeded} default audio track(s)`)
}
