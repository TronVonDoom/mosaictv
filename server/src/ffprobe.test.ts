import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLang, pickAudioTrack } from './ffprobe.js'
import { DEFAULT_AUDIO_LANGUAGE, NO_AUDIO_PREFERENCE, effectiveAudioLanguage } from './audio.js'

test('language tags normalize across the two ISO 639 forms', () => {
  assert.equal(normalizeLang('en'), 'eng')
  assert.equal(normalizeLang('eng'), 'eng')
  assert.equal(normalizeLang('en-US'), 'eng')
  assert.equal(normalizeLang('English'), 'eng')
  assert.equal(normalizeLang('ja'), 'jpn')
  assert.equal(normalizeLang('jpn'), 'jpn')
  // French and Chinese each have two three-letter codes in the wild.
  assert.equal(normalizeLang('fra'), normalizeLang('fre'))
  assert.equal(normalizeLang('zho'), normalizeLang('chi'))
  assert.equal(normalizeLang(''), '')
  assert.equal(normalizeLang(null), '')
})

test('picks the preferred language, whichever track it is on', () => {
  // The case this exists for: Japanese first, English second.
  assert.equal(pickAudioTrack(['jpn', 'eng'], 'eng'), 1)
  assert.equal(pickAudioTrack(['jpn', 'eng'], 'jpn'), 0)
  // Mixed tag forms on either side still match.
  assert.equal(pickAudioTrack(['ja', 'en'], 'eng'), 1)
  assert.equal(pickAudioTrack(['jpn', 'eng'], 'en'), 1)
  assert.equal(pickAudioTrack(['jpn', 'eng', 'spa'], 'spanish'), 2)
})

test('falls back to the first track rather than to silence', () => {
  assert.equal(pickAudioTrack(['jpn', 'spa'], 'eng'), 0, 'language absent from the file')
  assert.equal(pickAudioTrack([], 'eng'), 0, 'file has no audio streams')
  assert.equal(pickAudioTrack(['', ''], 'eng'), 0, 'tracks carry no language tags')
  assert.equal(pickAudioTrack(['jpn', 'eng'], null), 0, 'no preference set')
  assert.equal(pickAudioTrack(['jpn', 'eng'], ''), 0)
  // The sentinel is not a language, so it must not match a track either.
  assert.equal(pickAudioTrack(['jpn', 'eng'], NO_AUDIO_PREFERENCE), 0)
})

test('a channel overrides the global preference, null inherits it', () => {
  assert.equal(effectiveAudioLanguage(null, 'eng'), 'eng')
  assert.equal(effectiveAudioLanguage('jpn', 'eng'), 'jpn', 'a subs-first channel keeps Japanese')
  assert.equal(effectiveAudioLanguage(undefined, 'eng'), 'eng')
  // Either level can opt out of having a preference at all.
  assert.equal(effectiveAudioLanguage(NO_AUDIO_PREFERENCE, 'eng'), null)
  assert.equal(effectiveAudioLanguage(null, NO_AUDIO_PREFERENCE), null)
  assert.equal(DEFAULT_AUDIO_LANGUAGE, 'eng')
})
