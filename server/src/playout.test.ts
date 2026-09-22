import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_HORIZON_HOURS,
  MAX_HORIZON_HOURS,
  MIN_HORIZON_HOURS,
  clampHorizon,
} from './playout.js'

test('a day is the floor, a week the ceiling', () => {
  assert.equal(MIN_HORIZON_HOURS, 24)
  assert.equal(clampHorizon('24'), 24)
  assert.equal(clampHorizon('168'), 168)
  // Below the floor a player asking for "tonight" comes up short between
  // top-ups, so anything shorter is raised rather than honoured.
  assert.equal(clampHorizon('4'), MIN_HORIZON_HOURS)
  assert.equal(clampHorizon('0'), MIN_HORIZON_HOURS)
  assert.equal(clampHorizon('-12'), MIN_HORIZON_HOURS)
  assert.equal(clampHorizon('999'), MAX_HORIZON_HOURS)
})

test('an unset or unreadable value falls back to the default', () => {
  for (const v of [undefined, null, '', 'soon', {}]) {
    assert.equal(clampHorizon(v), DEFAULT_HORIZON_HOURS, String(v))
  }
  assert.ok(DEFAULT_HORIZON_HOURS >= MIN_HORIZON_HOURS)
})

test('a fractional value rounds to whole hours', () => {
  assert.equal(clampHorizon('47.6'), 48)
  assert.equal(clampHorizon(71.2), 71)
})
