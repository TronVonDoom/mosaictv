/**
 * How a program is named, in one place: the same "Rugrats S01E02 — Title" shape
 * turns up in the channel list, the stream's segment log, the XMLTV feed and
 * the coming-up caption, and they should never drift apart.
 *
 * The web has its own copy of these (web/src/lib/format.ts) — the two packages
 * don't share a module.
 */

/** "S01E02", or '' when the item isn't a numbered episode. */
export function episodeCode(m: { season?: number | null; episode?: number | null }): string {
  if (m.season == null || m.episode == null) return ''
  return `S${String(m.season).padStart(2, '0')}E${String(m.episode).padStart(2, '0')}`
}

/**
 * "Rugrats S01E02" for an episode, the plain title for anything else.
 * `withTitle` appends the episode's own title for places with room for it.
 *
 * A media item has a showTitle if and only if it's an episode (the scanner sets
 * it nowhere else), so that one check covers both.
 */
export function programLabel(
  m: { title: string; showTitle?: string | null; season?: number | null; episode?: number | null },
  opts: { withTitle?: boolean } = {},
): string {
  if (!m.showTitle) return m.title
  const code = episodeCode(m)
  return `${m.showTitle}${code ? ` ${code}` : ''}${opts.withTitle && m.title ? ` — ${m.title}` : ''}`
}
