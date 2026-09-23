import test from 'node:test'
import assert from 'node:assert/strict'
import type { MediaItem } from '@prisma/client'
import { groupIntoAirings, mixedRotation, releaseOrder, rotated } from './collections.js'

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

test("rotate gives every show a turn, in the collection's order (not A-Z)", () => {
  const units = [
    [epOf('B Show', 1, 10)],
    [epOf('B Show', 2, 11)],
    [epOf('A Show', 1, 20)],
    [epOf('A Show', 2, 21)],
  ]
  assert.deepEqual(airs(units, 4), ['B Show 1', 'A Show 1', 'B Show 2', 'A Show 2'])
})

test('a show that runs out starts over instead of dropping out of the rotation', () => {
  // Short: 2 episodes. Long: 5. The short one must keep its every-other slot.
  const units = [
    ...[1, 2].map((n) => [epOf('Short', n, n)]),
    ...[1, 2, 3, 4, 5].map((n) => [epOf('Long', n, 10 + n)]),
  ]
  assert.deepEqual(airs(units, 10), [
    'Short 1', 'Long 1',
    'Short 2', 'Long 2',
    'Short 1', 'Long 3', // Short wraps to its first episode, still in rotation
    'Short 2', 'Long 4',
    'Short 1', 'Long 5',
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

// --- each show's own progress ---

const eps = (show: string, count: number, firstId: number) =>
  Array.from({ length: count }, (_, i) => [epOf(show, i + 1, firstId + i)])
const label = (u: MediaItem[]) => `${u[0].showTitle} ${u[0].episode}`

test('a show added to a rotation starts at episode 1 without moving the others', () => {
  const [a, b, c] = [eps('A', 6, 1), eps('B', 6, 11), eps('C', 6, 21)]
  // Four turns in, A and B have each aired twice.
  const saved = rotated([...a, ...b]).progressAt!(4)
  assert.deepEqual(saved, { 'show:A': 2, 'show:B': 2 })
  const three = rotated([...a, ...b, ...c], { base: 4, shows: saved })
  assert.deepEqual(
    [4, 5, 6, 7, 8, 9].map((p) => label(three.at(p))),
    ['B 3', 'C 1', 'A 3', 'B 4', 'C 2', 'A 4'],
  )
})

test('a show dropped from a rotation keeps its place for when it comes back', () => {
  const [a, b] = [eps('A', 6, 1), eps('B', 6, 11)]
  const saved = rotated([...a, ...b]).progressAt!(4) // A 2, B 2
  const aOnly = rotated(a, { base: 4, shows: saved })
  const later = aOnly.progressAt!(6) // A airs twice more on its own
  assert.deepEqual(later, { 'show:A': 4, 'show:B': 2 })
  const back = rotated([...a, ...b], { base: 6, shows: later })
  assert.deepEqual([6, 7].map((p) => label(back.at(p))), ['A 5', 'B 3'])
})

test('a rotation saved before per-show progress picks every show up where it was', () => {
  // The old rotation ran shows A-Z: turns 0-3 aired A 1, Z 1, A 2, Z 2.
  const units = [...eps('Z', 6, 1), ...eps('A', 6, 11)] // arranged Z first
  const upgraded = rotated(units, { base: 4 }) // a position, no per-show counts
  assert.deepEqual([4, 5, 6, 7].map((p) => label(upgraded.at(p))), ['Z 3', 'A 3', 'Z 4', 'A 4'])
})

test('rotate shows, mixed: every show once a round, a new order each round, episodes in sequence', () => {
  const shows = ['A', 'B', 'C', 'D']
  const units = shows.flatMap((s, i) => eps(s, 8, i * 100))
  const list = mixedRotation(units, 12345)
  const played = Array.from({ length: 32 }, (_, pos) => list.at(pos)[0])
  const rounds = Array.from({ length: 8 }, (_, r) => played.slice(r * 4, r * 4 + 4).map((m) => m.showTitle))
  for (const r of rounds) assert.deepEqual([...r].sort(), shows, 'each show once per round')
  assert.ok(new Set(rounds.map((r) => r.join())).size > 1, 'rounds are dealt in different orders')
  for (const s of shows) {
    const seq = played.filter((m) => m.showTitle === s).map((m) => m.episode)
    assert.deepEqual(seq, [1, 2, 3, 4, 5, 6, 7, 8], `${s} plays in episode order`)
  }
  for (let i = 1; i < played.length; i++) {
    assert.notEqual(played[i].showTitle, played[i - 1].showTitle, 'no show twice running')
  }
})

test("rotate shows, mixed keeps each show's progress across a rebuild", () => {
  const units = ['A', 'B', 'C'].flatMap((s, i) => eps(s, 10, i * 100))
  const whole = mixedRotation(units, 7)
  // Resolved again from a saved position, it continues the same timeline.
  const resumed = mixedRotation(units, 7, { base: 9, shows: whole.progressAt!(9) })
  for (let p = 9; p < 21; p++) assert.equal(label(resumed.at(p)), label(whole.at(p)))
})

test("release order: shows in the collection's order, episodes in order, movies oldest first", () => {
  const movie = (title: string, year: number, id: number) =>
    mi(id, { showTitle: null, title, year, episode: null, season: null })
  const units = [
    [epOf('B', 2, 2)],
    [movie('Later', 1990, 50)],
    [epOf('B', 1, 1)],
    [epOf('A', 1, 10)],
    [movie('Earlier', 1980, 51)],
  ]
  assert.deepEqual(
    releaseOrder(units).map((u) => (u[0].showTitle ? label(u) : u[0].title)),
    ['B 1', 'B 2', 'Earlier', 'Later', 'A 1'],
  )
})
