import test from 'node:test'
import assert from 'node:assert/strict'
import { cardAnchor, cardEntry, comingUpWindows, placeCard } from './filters.js'
import { DEFAULT_COMINGUP, parseComingUp, sanitizeComingUp } from './overlays.js'
import { fitText, textWidth } from './card.js'
import { cleanEpisodeTitle, episodeCodeLabel, runtimeLabel } from './cardContent.js'

test('the card sits the lead time before the end, and at the midpoint', () => {
  const cfg = { ...DEFAULT_COMINGUP, leadSeconds: 300, holdSeconds: 12 }
  // A 100-minute movie from the top: 5 minutes before its end.
  const movie = { encodeSec: 6000, untilEndSec: 6000, programSec: 6000, intoProgramSec: 0 }
  assert.deepEqual(comingUpWindows({ ...cfg, timing: 'beforeEnd' }, movie), [{ a: 5700, b: 5712 }])
  assert.deepEqual(comingUpWindows({ ...cfg, timing: 'middle' }, movie), [{ a: 2994, b: 3006 }])
  // Tuned in 70 minutes along: still lands on the same wall-clock moments, and a
  // midpoint already behind us is dropped rather than shown late.
  const late = { encodeSec: 1800, untilEndSec: 1800, programSec: 6000, intoProgramSec: 4200 }
  assert.deepEqual(comingUpWindows({ ...cfg, timing: 'both' }, late), [{ a: 1500, b: 1512 }])
})

test('a broadcast episode gets one card, in the segment it lands in', () => {
  // Three 7-minute segments of one 21-minute episode; 5 minutes before its end
  // is 16 minutes in, 2 minutes into the third segment.
  const cfg = { ...DEFAULT_COMINGUP, timing: 'beforeEnd' as const, leadSeconds: 300, holdSeconds: 12 }
  const seg = (i: number) => ({ encodeSec: 420, untilEndSec: 1260 - i * 420, programSec: 1260, intoProgramSec: i * 420 })
  assert.deepEqual(comingUpWindows(cfg, seg(0)), [])
  assert.deepEqual(comingUpWindows(cfg, seg(1)), [])
  assert.deepEqual(comingUpWindows(cfg, seg(2)), [{ a: 120, b: 132 }])
  // Its midpoint, 10.5 minutes in, falls in the middle segment only.
  const mid = { ...cfg, timing: 'middle' as const }
  assert.deepEqual(comingUpWindows(mid, seg(0)), [])
  assert.deepEqual(comingUpWindows(mid, seg(1)), [{ a: 204, b: 216 }])
  assert.deepEqual(comingUpWindows(mid, seg(2)), [])
})

test('zero is a real fade, not a missing one', () => {
  assert.equal(sanitizeComingUp({ enabled: true, fadeSeconds: 0 }).fadeSeconds, 0)
  // Missing or unreadable still takes the default.
  assert.equal(sanitizeComingUp({ enabled: true }).fadeSeconds, DEFAULT_COMINGUP.fadeSeconds)
  assert.equal(sanitizeComingUp({ enabled: true, fadeSeconds: 'soon' }).fadeSeconds, DEFAULT_COMINGUP.fadeSeconds)
  assert.equal(sanitizeComingUp({ enabled: true, fadeSeconds: '' }).fadeSeconds, DEFAULT_COMINGUP.fadeSeconds)
  // And out-of-range values are still clamped.
  assert.equal(sanitizeComingUp({ enabled: true, holdSeconds: 0 }).holdSeconds, 2)
})

test("a text caption's saved config comes back as a card config", () => {
  const old = JSON.stringify({
    enabled: true,
    timing: 'both',
    leadSeconds: 120,
    holdSeconds: 10,
    fadeSeconds: 0.5,
    position: 'top',
    template: 'Coming up next: %showtitle%',
    fontSizePercent: 4,
    opacityPercent: 90,
  })
  assert.deepEqual(parseComingUp(old), {
    enabled: true,
    timing: 'both',
    leadSeconds: 120,
    holdSeconds: 10,
    fadeSeconds: 0.5,
    style: 'glass',
    position: 'top-left',
    size: 'medium',
  })
  // Only real sizes: not inherited names, not junk.
  assert.equal(sanitizeComingUp({ size: 'constructor' }).size, 'medium')
  assert.equal(sanitizeComingUp({ size: 'large' }).size, 'large')
  // The first card's two positions map to their corners; anything else is the default.
  assert.equal(sanitizeComingUp({ position: 'bottom' }).position, 'bottom-left')
  assert.equal(sanitizeComingUp({ position: 'middle-right' }).position, 'middle-right')
  assert.equal(sanitizeComingUp({ position: 'middle-center' }).position, 'bottom-left')
  assert.equal(sanitizeComingUp({ style: 'broadcast' }).style, 'broadcast')
  assert.equal(sanitizeComingUp({ style: 'neon' }).style, 'glass')
})

test('a long title is cut at a word, with an ellipsis, inside the width', () => {
  const long = "Monsters, Get Real! + Snorched If You Do, Snorched If You Don't"
  const fit = fitText(long, 500, 16, 300)
  assert.ok(fit.endsWith('…'), fit)
  assert.ok(textWidth(fit, 500, 16) <= 300, `${fit} is too wide`)
  // Cut between words, and without a dangling separator before the ellipsis.
  assert.doesNotMatch(fit, /[\s,+]…$/)
  assert.ok(long.startsWith(fit.slice(0, -1)))
  // Short enough already: untouched.
  assert.equal(fitText("Dexter's Laboratory", 800, 26, 400), "Dexter's Laboratory")
})

test('an episode title loses the code the filename left on it', () => {
  assert.equal(cleanEpisodeTitle('E03 - Monsters, Get Real! + Snorched If You Do'), 'Monsters, Get Real! + Snorched If You Do')
  assert.equal(cleanEpisodeTitle('S02E05: The Great Outdoors'), 'The Great Outdoors')
  assert.equal(cleanEpisodeTitle('E05-E06 - Curse of the Krumm'), 'Curse of the Krumm')
  // Titles that only look a bit like a code are left alone.
  assert.equal(cleanEpisodeTitle('E.T. Phone Home'), 'E.T. Phone Home')
  assert.equal(cleanEpisodeTitle('Episode 1'), 'Episode 1')
})

test('episode codes cover a whole broadcast episode', () => {
  assert.equal(episodeCodeLabel([{ season: 1, episode: 4 }]), 'S1 · E4')
  assert.equal(
    episodeCodeLabel([
      { season: 1, episode: 4 },
      { season: 1, episode: 5 },
      { season: 1, episode: 6 },
    ]),
    'S1 · E4–6',
  )
  assert.equal(episodeCodeLabel([{ season: null, episode: 12 }]), 'E12')
  assert.equal(episodeCodeLabel([{ season: 0, episode: 2 }]), 'Special · E2')
  assert.equal(episodeCodeLabel([{ season: 1, episode: null }]), null)
})

test('runtimes read like a guide', () => {
  assert.equal(runtimeLabel(7341.76), '2h 2m')
  assert.equal(runtimeLabel(2700), '45m')
  assert.equal(runtimeLabel(null), null)
})

test('a card sits on the picture, not on the pillarbox bars', () => {
  const frame = { width: 1280, height: 720 }
  const card = { w: 520, h: 142 }
  const full = { x0: 0, y0: 0, mw: 1280, mh: 720 }
  // 16:9: the whole canvas, clear of every edge by the same margin.
  assert.deepEqual(placeCard(full, frame, card, 'bottom-left', 1), { x: 50, y: 534 })
  assert.deepEqual(placeCard(full, frame, card, 'top-left', 1), { x: 50, y: 42 })
  assert.deepEqual(placeCard(full, frame, card, 'bottom-right', 1), { x: 708, y: 534 })
  assert.deepEqual(placeCard(full, frame, card, 'top-center', 1), { x: 380, y: 42 })
  assert.deepEqual(placeCard(full, frame, card, 'middle-right', 1), { x: 708, y: 288 })
  // 4:3 pillarboxed into 16:9: inside the 960px-wide picture, on either side.
  for (const pos of ['bottom-left', 'bottom-right', 'middle-left', 'top-right'] as const) {
    const at = placeCard({ x0: 160, y0: 0, mw: 960, mh: 720 }, frame, card, pos, 1)
    assert.ok(at.x >= 160 && at.x + card.w <= 1120, `${pos}: ${JSON.stringify(at)}`)
  }
})

test('a card slides in from its own edge', () => {
  assert.deepEqual(cardEntry('bottom-left'), [-1, 0])
  assert.deepEqual(cardEntry('middle-right'), [1, 0])
  assert.deepEqual(cardEntry('bottom-center'), [0, 1])
  assert.deepEqual(cardEntry('top-center'), [0, -1])
  assert.equal(cardAnchor('top-right'), 'right')
  assert.equal(cardAnchor('bottom-center'), 'center')
})
