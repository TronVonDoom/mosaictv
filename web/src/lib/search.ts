/**
 * Ranking for the command palette.
 *
 * Deliberately simple: a contiguous substring hit always beats a scattered
 * subsequence one, matching at a word boundary beats matching mid-word, and
 * matching early beats matching late. Real fuzzy ranking isn't worth a
 * dependency here — the catalogue is a few dozen entries, and this is enough to
 * put the obvious answer first.
 *
 * Returns null when the query doesn't match at all.
 */
export function scoreMatch(query: string, haystack: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const hay = haystack.toLowerCase()

  const direct = hay.indexOf(q)
  if (direct >= 0) {
    const atBoundary = direct === 0 || /[\s›]/.test(hay[direct - 1])
    return 1000 - direct + (atBoundary ? 40 : 0)
  }

  // Subsequence: every query character present, in order.
  let cursor = 0
  let firstHit = -1
  for (const ch of q) {
    const at = hay.indexOf(ch, cursor)
    if (at < 0) return null
    if (firstHit < 0) firstHit = at
    cursor = at + 1
  }
  return q.length * 4 - firstHit
}
