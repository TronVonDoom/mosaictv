import test from 'node:test'
import assert from 'node:assert/strict'
import { describeUnit, groupRows } from './nowPlaying.js'

const media = (over: Partial<Parameters<typeof describeUnit>[0][number]['mediaItem'] & object> = {}) => ({
  id: 1,
  libraryId: 3,
  type: 'episode',
  title: 'Dexter Detects Detectives',
  showTitle: "Dexter's Laboratory",
  season: 4,
  episode: 35,
  year: 2003,
  artist: null,
  overview: null,
  genres: null,
  rating: null,
  posterPath: null,
  showPosterPath: null,
  tmdbPosterPath: null,
  tmdbBackdropPath: null,
  ...over,
})
const at = (min: number) => new Date(Date.UTC(2026, 8, 22, 20, min))
const row = (start: number, stop: number, groupKey: string | null, m: ReturnType<typeof media> | null, kind = 'program') => ({
  kind,
  title: m ? null : 'Filler',
  startTime: at(start),
  stopTime: at(stop),
  groupKey,
  mediaItem: m,
})

test('segments sharing a groupKey fold into one program; the rest stand alone', () => {
  const rows = [row(0, 7, 'g1', media()), row(7, 14, 'g1', media()), row(14, 20, null, media()), row(20, 21, null, null, 'filler')]
  assert.deepEqual(groupRows(rows).map((u) => u.length), [2, 1, 1])
})

test('a multi-part airing reads as one program spanning its segments', () => {
  const u = describeUnit(
    [
      row(0, 7, 'g', media({ id: 10, episode: 35, title: 'Part One' })),
      row(7, 14, 'g', media({ id: 11, episode: 36, title: 'Part Two' })),
    ],
    { overview: 'A boy genius.', genres: 'Animation', rating: 7.6, tmdbPosterPath: '/p.jpg', tmdbBackdropPath: '/b.jpg' },
  )
  assert.equal(u.title, "Dexter's Laboratory")
  assert.equal(u.subtitle, 'S04E35–E36 · Part One / Part Two')
  assert.equal(u.stopTime, at(14).toISOString())
  assert.equal(u.parts, 2)
  // Show-level metadata fills what an episode lacks, and says art exists.
  assert.equal(u.overview, 'A boy genius.')
  assert.equal(u.art, 'show')
  assert.equal(u.hasBackdrop, true)
})

test('a movie is its own title, year beneath, art only when there is some', () => {
  const m = media({ type: 'movie', showTitle: null, season: null, episode: null, title: 'Hocus Pocus', year: 1993 })
  const bare = describeUnit([row(0, 96, null, m)], undefined)
  assert.equal(bare.title, 'Hocus Pocus')
  assert.equal(bare.subtitle, '1993')
  assert.equal(bare.art, null)
  assert.equal(bare.hasBackdrop, false)
  const dressed = describeUnit([row(0, 96, null, { ...m, tmdbPosterPath: '/p.jpg', tmdbBackdropPath: '/b.jpg' })], undefined)
  assert.equal(dressed.art, 'poster')
  assert.equal(dressed.hasBackdrop, true)
})

test('filler is a station break, never a program', () => {
  const u = describeUnit([row(0, 1, null, null, 'filler')], undefined)
  assert.equal(u.kind, 'filler')
  assert.equal(u.title, 'Station break')
  assert.equal(u.mediaItemId, null)
})
