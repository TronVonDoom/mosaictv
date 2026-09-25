import test from 'node:test'
import assert from 'node:assert/strict'
import { dimsFor } from './filler.js'

test('a fixed resolution renders at that size, whatever the channel', () => {
  assert.deepEqual(dimsFor('720p', 1080), { w: 1280, h: 720 })
  assert.deepEqual(dimsFor('1440p', 480), { w: 2560, h: 1440 })
  // Anything unrecognised is the old default.
  assert.deepEqual(dimsFor('4k'), { w: 1920, h: 1080 })
  assert.deepEqual(dimsFor(null), { w: 1920, h: 1080 })
})

test('Match channel renders at the smallest size that covers the channel', () => {
  assert.deepEqual(dimsFor('auto', 480), { w: 1280, h: 720 })
  assert.deepEqual(dimsFor('auto', 720), { w: 1280, h: 720 })
  assert.deepEqual(dimsFor('auto', 1080), { w: 1920, h: 1080 })
  assert.deepEqual(dimsFor('auto', 1200), { w: 2560, h: 1440 })
  // Past the largest size it stays at the largest.
  assert.deepEqual(dimsFor('auto', 2160), { w: 2560, h: 1440 })
  // No channel to go by (a preview of an unassigned filler): 1080p.
  assert.deepEqual(dimsFor('auto'), { w: 1920, h: 1080 })
})
