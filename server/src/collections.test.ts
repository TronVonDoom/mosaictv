import test from 'node:test'
import assert from 'node:assert/strict'
import type { MediaItem } from '@prisma/client'
import { groupIntoAirings, rotated } from './collections.js'

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

// --- rotate ---

// One episode of `show`, numbered within it.
const epOf = (show: string, n: number, id: number) => mi(id, { showTitle: show, episode: n })

// What `rotate` airs over the first `n` positions, as "Show Ep".
function airs(units: MediaItem[][], n: number): string[] {
  const list = rotated(units)
  return Array.from({ length: n }, (_, pos) => {
    const m = list.at(pos)[0]
    return `${m.showTitle} ${m.episode}`
  })
}

test('rotate gives every show a turn, in show-name order', () => {
  const units = [
    [epOf('B Show', 1, 10)],
    [epOf('B Show', 2, 11)],
    [epOf('A Show', 1, 20)],
    [epOf('A Show', 2, 21)],
  ]
  assert.deepEqual(airs(units, 4), ['A Show 1', 'B Show 1', 'A Show 2', 'B Show 2'])
})

test('a show that runs out starts over instead of dropping out of the rotation', () => {
  // Short: 2 episodes. Long: 5. The short one must keep its every-other slot.
  const units = [
    ...[1, 2].map((n) => [epOf('Short', n, n)]),
    ...[1, 2, 3, 4, 5].map((n) => [epOf('Long', n, 10 + n)]),
  ]
  assert.deepEqual(airs(units, 10), [
    'Long 1', 'Short 1',
    'Long 2', 'Short 2',
    'Long 3', 'Short 1', // Short wraps to its first episode, still in rotation
    'Long 4', 'Short 2',
    'Long 5', 'Short 1',
  ])
})

test('rotate keeps sharing airtime evenly long after the shortest show ends', () => {
  const units = [
    [epOf('Short', 1, 1)],
    ...Array.from({ length: 50 }, (_, i) => [epOf('Long', i + 1, 100 + i)]),
  ]
  const played = airs(units, 200)
  const short = played.filter((p) => p.startsWith('Short')).length
  assert.equal(short, 100, 'the one-episode show should still get half the slots')
})

test('rotate loops the long show too, so the channel never runs dry', () => {
  const units = [[epOf('A', 1, 1)], [epOf('A', 2, 2)], [epOf('B', 1, 3)]]
  assert.deepEqual(airs(units, 8), ['A 1', 'B 1', 'A 2', 'B 1', 'A 1', 'B 1', 'A 2', 'B 1'])
})

test('movies rotate as one group against the shows, not one group each', () => {
  const movie = (title: string, id: number) =>
    mi(id, { showTitle: null, title, episode: null, season: null })
  const units = [
    [movie('Hocus Pocus', 1)],
    [movie('Beetlejuice', 2)],
    [epOf('Goosebumps', 1, 10)],
    [epOf('Goosebumps', 2, 11)],
  ]
  const list = rotated(units)
  const seen = Array.from({ length: 4 }, (_, pos) => list.at(pos)[0].title)
  // Movie, show, movie, show — the two movies share one slot between them
  // rather than taking one each, so the show keeps half the airtime.
  assert.deepEqual(seen, ['Beetlejuice', 'Ep 10', 'Hocus Pocus', 'Ep 11'])
})
