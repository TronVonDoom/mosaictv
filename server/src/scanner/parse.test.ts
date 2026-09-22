import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMedia } from './parse.js'

const movie = (p: string) => parseMedia(`/media/movies/${p}`, '/media/movies', 'movie')
const episode = (p: string) => parseMedia(`/media/tv/${p}`, '/media/tv', 'tv')

test('release tags come off a movie title, the year still parses', () => {
  const cases: [string, string, number | null][] = [
    ['Blade (1998)/Blade (WEBDL-1080p x265).mkv', 'Blade', 1998],
    ['Hocus Pocus/Hocus Pocus (Bluray-1080p x265) (1993).mkv', 'Hocus Pocus', 1993],
    ['Goosebumps 2/Goosebumps 2 - Haunted Halloween (Bluray-1080p x265).mkv',
      'Goosebumps 2 - Haunted Halloween', null],
    ['Ghostbusters/Ghostbusters - Afterlife (Bluray-2160p x265).mkv',
      'Ghostbusters - Afterlife', null],
    ['Death Wish/Death Wish (Bluray-1080p h265) (1974).mkv', 'Death Wish', 1974],
    ['3 Idiots/3 Idiots (BR-DISK x265) (2009).mkv', '3 Idiots', 2009],
    ['Catch Me If You Can (2002) (HD) (x264)/Catch Me If You Can (2002).mkv',
      'Catch Me If You Can', 2002],
  ]
  for (const [p, title, year] of cases) {
    const got = movie(p)
    assert.equal(got.title, title, p)
    assert.equal(got.year, year, p)
  }
})

test('release tags come off an episode title too', () => {
  const cases: [string, string][] = [
    ['Beetleborgs/Season 01/Beetleborgs - S01E10 - Locomotion Commotion (MPEG2).mkv',
      'Locomotion Commotion'],
    ['Rugrats/Season 08/Rugrats - S08E02 - Curse of the Werewuff (480p x265 EDGE2020).mkv',
      'Curse of the Werewuff'],
    ['Kenan & Kel/Season 03/Kenan & Kel - S03E04 - The Chicago Witch Trials (XviD).mkv',
      'The Chicago Witch Trials'],
  ]
  for (const [p, title] of cases) {
    assert.equal(episode(p).title, title, p)
  }
})

test('a tagged show folder still yields a clean show title', () => {
  const got = episode('The Office (US) (1080p x265)/Season 02/The Office - S02E05 - Halloween.mkv')
  assert.equal(got.showTitle, 'The Office (US)')
  assert.equal(got.title, 'Halloween')
})

test('parentheticals that carry meaning are left alone', () => {
  const kept: [string, string][] = [
    ['The Munsters/Season 00/The Munsters - S00E01 - My Fair Munster (Unaired Pilot).mkv',
      'My Fair Munster (Unaired Pilot)'],
    ['The Munsters/Season 00/The Munsters - S00E10 - Family Portrait (Colorized).mkv',
      'Family Portrait (Colorized)'],
    ['Gargoyles/Season 01/Gargoyles - S01E01 - Awakening (1).mkv', 'Awakening (1)'],
    ['Batman/Season 01/Batman - S01E57 - The Demon’s Quest (Part 1).mkv',
      'The Demon’s Quest (Part 1)'],
    ['The Munsters/Season 00/The Munsters - S00E09 - America’s First Family of Fright (Documentary).mkv',
      'America’s First Family of Fright (Documentary)'],
  ]
  for (const [p, title] of kept) {
    assert.equal(episode(p).title, title, p)
  }
  // A cut/edition parenthetical names a different film, so it has to survive.
  assert.equal(movie('Blade Runner/Blade Runner (Director’s Cut 1992).mkv').title,
    'Blade Runner (Director’s Cut 1992)')
  // An all-caps word alone is not a release tag — no quality token beside it.
  assert.equal(movie('Something (BBC).mkv').title, 'Something (BBC)')
})
