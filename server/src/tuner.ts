// The identity and capacity MosaicTV advertises as an emulated HDHomeRun.
// Shared by the tuner endpoints that report it and the settings routes that
// edit it.

import { randomBytes } from 'node:crypto'
import { prisma } from './db.js'

export const DEFAULT_FRIENDLY_NAME = 'MosaicTV'
export const DEFAULT_TUNER_COUNT = 4
export const MIN_TUNER_COUNT = 1
export const MAX_TUNER_COUNT = 32
export const MAX_FRIENDLY_NAME = 60

/** How many concurrent streams the tuner claims. Plex stops tuning past this. */
export async function tunerCount(): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key: 'tunerCount' } })
  const n = Number(row?.value)
  return Number.isFinite(n) && n >= MIN_TUNER_COUNT && n <= MAX_TUNER_COUNT ? Math.round(n) : DEFAULT_TUNER_COUNT
}

/** The name Plex lists the device under — the only way to tell two instances apart. */
export async function friendlyName(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: 'hdhrFriendlyName' } })
  return row?.value?.trim() || DEFAULT_FRIENDLY_NAME
}

/**
 * Plex keys a tuner on its DeviceID and treats two devices sharing one as the
 * same tuner, so this is generated once per instance and then kept: a value
 * that changed on restart would re-register the tuner and orphan the channel
 * mapping. Eight uppercase hex digits is the shape real HDHomeRuns use.
 */
export async function deviceId(): Promise<string> {
  const existing = await prisma.setting.findUnique({ where: { key: 'hdhrDeviceId' } })
  if (existing?.value) return existing.value
  const id = randomBytes(4).toString('hex').toUpperCase()
  // Concurrent first requests can race here; upsert so the first one wins and
  // the loser returns the stored value rather than a second, conflicting ID.
  const row = await prisma.setting.upsert({
    where: { key: 'hdhrDeviceId' },
    create: { key: 'hdhrDeviceId', value: id },
    update: {},
  })
  return row.value
}
