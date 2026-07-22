import test from 'node:test'
import assert from 'node:assert/strict'
import type { MediaItem } from '@prisma/client'
import { groupIntoAirings } from './collections.js'

// Minimal MediaItem — only the fields groupIntoAirings and its sort touch.
function mi(id: number, over: Partial<MediaItem> = {}): MediaItem {
  return {
    id,
    missing: false,
    durationSec: 600,
    season: 1,
    episode: id,
    year: null,
    title: `Ep ${id}`,
    showTitle: 'Show',
    ...over,
  } as unknown as MediaItem
}

// An airing over the given media items, in the order passed.
type Airings = Parameters<typeof groupIntoAirings>[1]
function airing(...items: MediaItem[]): Airings[number] {
  return { segments: items.map((m, order) => ({ order, mediaItem: m })) } as unknown as Airings[number]
}

const ids = (units: MediaItem[][]) => units.map((u) => u.map((m) => m.id))

test('a borrowed short airs inside every host it is grouped into', () => {
  const a1 = mi(1, { showTitle: '2 Stupid Dogs', episode: 1 })
  const b1 = mi(2, { showTitle: 'Dexter', episode: 1 })
  const s5 = mi(5, { showTitle: 'Secret Squirrel', episode: 5 })
  // Smart-filter shape: every show's episodes and airings folded in one call.
  const units = groupIntoAirings([a1, b1, s5], [airing(a1, s5), airing(b1, s5)])

  // Two multi-segment units, s5 present in both, and never standalone.
  assert.equal(units.length, 2)
  const flat = units.flat().map((m) => m.id)
  assert.equal(flat.filter((x) => x === 5).length, 2, 's5 should air in both hosts')
  assert.ok(!units.some((u) => u.length === 1 && u[0].id === 5), 's5 should not air standalone')
  assert.deepEqual(new Set(ids(units).map((u) => u.join(','))), new Set(['1,5', '2,5']))
})

test('an episode consumed by an airing does not also air standalone', () => {
  const e1 = mi(1)
  const e2 = mi(2)
  const e3 = mi(3)
  const units = groupIntoAirings([e1, e2, e3], [airing(e1, e2)])
  assert.deepEqual(ids(units), [
    [1, 2], // grouped broadcast episode
    [3], // untouched episode, a unit of one
  ])
})

test('missing or zero-duration segments are skipped', () => {
  const a1 = mi(1, { showTitle: '2 Stupid Dogs' })
  const gone = mi(5, { showTitle: 'Secret Squirrel', missing: true })
  const zero = mi(6, { showTitle: 'Secret Squirrel', durationSec: 0 })
  const units = groupIntoAirings([a1], [airing(a1, gone, zero)])
  assert.deepEqual(ids(units), [[1]])
})
