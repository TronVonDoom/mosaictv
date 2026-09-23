import test from 'node:test'
import assert from 'node:assert/strict'
import { comingUpWindows, renderComingUpText } from './filters.js'
import { DEFAULT_COMINGUP, sanitizeComingUp } from './overlays.js'

const episode = { title: "Doug's Halloween", showTitle: 'Doug', season: 4, episode: 7, year: 1996 }
const movie = { title: 'Hocus Pocus', showTitle: null, season: null, episode: null, year: 1993 }

test('the default template names a movie, not just "Coming up next"', () => {
  // The bug this exists for: %showtitle% and %episodetitle% are both empty for
  // a movie, which left the caption naming nothing.
  assert.equal(renderComingUpText(DEFAULT_COMINGUP.template, movie), 'Coming up next: Hocus Pocus')
  assert.equal(renderComingUpText(DEFAULT_COMINGUP.template, episode), "Coming up next: Doug — Doug's Halloween")
})

test('a template that names the film itself does not print it twice', () => {
  assert.equal(renderComingUpText('Up next: %showtitle% %movietitle%', movie), 'Up next: Hocus Pocus')
  assert.equal(renderComingUpText('%showtitle% — %title%', movie), 'Hocus Pocus')
  // An episode is unaffected: showtitle is still the series.
  assert.equal(renderComingUpText('%showtitle% — %title%', episode), "Doug — Doug's Halloween")
})

test('an empty token takes its brackets and separators with it', () => {
  assert.equal(renderComingUpText('Coming up next: %title% (%year%)', movie), 'Coming up next: Hocus Pocus (1993)')
  assert.equal(renderComingUpText('Coming up next: %title% (%year%)', { ...movie, year: null }), 'Coming up next: Hocus Pocus')
  assert.equal(renderComingUpText('Next: %showtitle% %se% — %episodetitle%', { ...episode, title: '' }), 'Next: Doug S04E07')
})

test('a caption that would name nothing is not shown', () => {
  assert.equal(renderComingUpText('Coming up next: %se%', movie), '')
  // Plain text with no tokens is the user's choice, and stays.
  assert.equal(renderComingUpText('Stay tuned!', movie), 'Stay tuned!')
})

test('the caption sits the lead time before the end, and at the midpoint', () => {
  const cfg = { ...DEFAULT_COMINGUP, leadSeconds: 300, holdSeconds: 12 }
  // A 100-minute movie from the top: 5 minutes before its end.
  assert.deepEqual(comingUpWindows({ ...cfg, timing: 'beforeEnd' }, 6000, 6000, 0), [{ a: 5700, b: 5712 }])
  assert.deepEqual(comingUpWindows({ ...cfg, timing: 'middle' }, 6000, 6000, 0), [{ a: 2994, b: 3006 }])
  // Tuned in 70 minutes along: still lands on the same wall-clock moments, and a
  // midpoint already behind us is dropped rather than shown late.
  assert.deepEqual(comingUpWindows({ ...cfg, timing: 'both' }, 1800, 6000, 4200), [{ a: 1500, b: 1512 }])
})

test('zero is a real fade, not a missing one', () => {
  assert.equal(sanitizeComingUp({ enabled: true, fadeSeconds: 0 }).fadeSeconds, 0)
  assert.equal(sanitizeComingUp({ enabled: true, opacityPercent: 0 }).opacityPercent, 0)
  // Missing or unreadable still takes the default.
  assert.equal(sanitizeComingUp({ enabled: true }).fadeSeconds, DEFAULT_COMINGUP.fadeSeconds)
  assert.equal(sanitizeComingUp({ enabled: true, fadeSeconds: 'soon' }).fadeSeconds, DEFAULT_COMINGUP.fadeSeconds)
  assert.equal(sanitizeComingUp({ enabled: true, fadeSeconds: '' }).fadeSeconds, DEFAULT_COMINGUP.fadeSeconds)
  // And out-of-range values are still clamped.
  assert.equal(sanitizeComingUp({ enabled: true, holdSeconds: 0 }).holdSeconds, 2)
})
