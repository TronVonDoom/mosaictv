import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

// A stand-in TMDB that answers /search/movie like the real one does for a
// remake: filtered by `year` (any release that year, re-releases included) the
// original comes first; filtered by `primary_release_year` only the remake
// matches.
const ORIGINAL = 377 // A Nightmare on Elm Street (1984), re-released 2010
const REMAKE = 23437 // A Nightmare on Elm Street (2010)
const seen: URLSearchParams[] = []
const server = http.createServer((req, res) => {
  const q = new URL(req.url ?? '/', 'http://x').searchParams
  seen.push(q)
  let results: { id: number }[] = []
  if (q.get('query') === 'A Nightmare on Elm Street') {
    if (q.get('primary_release_year') === '2010') results = [{ id: REMAKE }]
    else if (q.get('primary_release_year') === '1984') results = [{ id: ORIGINAL }]
    else if (q.get('year') === '2010') results = [{ id: ORIGINAL }, { id: REMAKE }]
    else results = [{ id: ORIGINAL }, { id: REMAKE }]
  }
  if (q.get('query') === 'Festival Cut' && q.get('year') === '2019') results = [{ id: 42 }]
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ results }))
})

test.before(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  process.env.TMDB_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.after(() => server.close())

// Imported after the mock is listening: tmdb.ts reads its base URL on load.
const tmdb = () => import('./tmdb.js')

test('a remake matches the remake, not the original it shares a title with', async () => {
  const { searchMovie } = await tmdb()
  assert.equal(await searchMovie('k', 'A Nightmare on Elm Street', 2010), REMAKE)
  assert.equal(await searchMovie('k', 'A Nightmare on Elm Street', 1984), ORIGINAL)
})

test('falls back to any release that year when the first release is another year', async () => {
  const { searchMovie } = await tmdb()
  // A file dated by its wide release after a festival premiere the year before.
  assert.equal(await searchMovie('k', 'Festival Cut', 2019), 42)
})

test('no year searches by title alone', async () => {
  const { searchMovie } = await tmdb()
  seen.length = 0
  assert.equal(await searchMovie('k', 'A Nightmare on Elm Street', null), ORIGINAL)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].get('primary_release_year'), null)
})
