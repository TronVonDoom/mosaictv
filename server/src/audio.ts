// Which audio track a channel airs when a file carries several.
//
// Plenty of library files list a dub or the original language first — an anime
// rip is usually Japanese track 0, English track 1 — and the encoder took
// whatever came first. This is the preference that overrides that, globally and
// per channel.

import { prisma } from './db.js'

/** The language picked when nothing has been configured. */
export const DEFAULT_AUDIO_LANGUAGE = 'eng'

/** Stored instead of a language tag to mean "whatever the file lists first". */
export const NO_AUDIO_PREFERENCE = 'first'

/** The instance-wide preference, as stored (a language tag, or 'first'). */
export async function globalAudioLanguage(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: 'audioLanguage' } })
  const v = (row?.value ?? '').trim()
  return v || DEFAULT_AUDIO_LANGUAGE
}

/**
 * The language a channel should air, or null for "leave the file's order
 * alone". A channel's own setting wins; null on the channel inherits the
 * global one.
 */
export function effectiveAudioLanguage(
  channelLanguage: string | null | undefined,
  globalLanguage: string,
): string | null {
  const pref = (channelLanguage ?? globalLanguage ?? '').trim()
  return !pref || pref === NO_AUDIO_PREFERENCE ? null : pref
}
