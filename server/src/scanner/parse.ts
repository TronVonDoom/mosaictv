import path from 'node:path'

export type LibraryKind = 'tv' | 'movie' | 'other'

export type ParsedMedia = {
  type: 'movie' | 'episode' | 'other'
  title: string
  showTitle: string | null
  season: number | null
  episode: number | null
  year: number | null
}

const YEAR_RE = /\((\d{4})\)/
// Matches S01E02, s1e2, 1x02, etc.
const SEASON_EP_RE = /\bS(\d{1,2})[\s._-]*E(\d{1,3})\b|\b(\d{1,2})x(\d{1,3})\b/i

// Parenthetical quality/source tags Plex users tack onto folder or file names.
const QUALITY_TAG_RE =
  /\((?:HD|SD|UHD|4K|1080p|720p|480p|x264|x265|h\.?264|h\.?265|hevc|Other|BluRay|Blu-Ray|WEB-?DL|WEBRip|HDR|DVD(?:Rip)?|Remux)\)/gi

/** Strip a trailing "(2020)", quality tags, and tidy whitespace into a clean title. */
function cleanTitle(raw: string): string {
  return raw
    .replace(YEAR_RE, '')
    .replace(QUALITY_TAG_RE, '')
    .replace(/[._]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*-\s*$/, '')
    .trim()
}

function extractYear(s: string): number | null {
  const m = s.match(YEAR_RE)
  return m ? Number.parseInt(m[1], 10) : null
}

/**
 * Parse show/season/episode/movie/title info from a file path using Plex naming
 * conventions:
 *   TV:     /Show Name (Year)/Season 01/Show Name - S01E02 - Title.ext
 *   Movie:  /Movie Name (Year)/Movie Name (Year).ext
 */
export function parseMedia(
  absPath: string,
  libraryPath: string,
  kind: LibraryKind,
): ParsedMedia {
  const ext = path.extname(absPath)
  const baseName = path.basename(absPath, ext)
  const rel = path.relative(libraryPath, absPath)
  // Split into path segments (folders under the library root + the filename).
  const segments = rel.split(/[\\/]/).filter(Boolean)
  // The topmost folder under the library is usually the show/movie folder.
  const topFolder = segments.length > 1 ? segments[0] : null

  if (kind === 'tv') {
    const se = baseName.match(SEASON_EP_RE)
    if (se) {
      const season = Number.parseInt(se[1] ?? se[3], 10)
      const episode = Number.parseInt(se[2] ?? se[4], 10)
      const showTitle = topFolder
        ? cleanTitle(topFolder)
        : cleanTitle(baseName.slice(0, se.index).replace(/[-–]\s*$/, ''))
      // Episode title = whatever follows the SxxEyy token, if present.
      const after = baseName.slice((se.index ?? 0) + se[0].length)
      const epTitle = cleanTitle(after.replace(/^[\s._-]+/, ''))
      const title = epTitle || `${showTitle} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
      return {
        type: 'episode',
        title,
        showTitle: showTitle || null,
        season: Number.isNaN(season) ? null : season,
        episode: Number.isNaN(episode) ? null : episode,
        year: topFolder ? extractYear(topFolder) : null,
      }
    }
    // No SxxEyy match — fall through to a generic entry.
    return { type: 'other', title: cleanTitle(baseName), showTitle: null, season: null, episode: null, year: null }
  }

  if (kind === 'movie') {
    // Plex movie *files* are named cleanly ("Title (Year).ext"), while the
    // enclosing *folder* often carries quality tags — e.g.
    // "Catch Me If You Can (2002) (HD) (x264)". Prefer the filename; fall back
    // to the folder only if the filename yields nothing useful.
    const title = cleanTitle(baseName) || (topFolder ? cleanTitle(topFolder) : baseName)
    const year = extractYear(baseName) ?? (topFolder ? extractYear(topFolder) : null)
    return {
      type: 'movie',
      title,
      showTitle: null,
      season: null,
      episode: null,
      year,
    }
  }

  // "other" — bumpers, filler, one-off clips.
  return {
    type: 'other',
    title: cleanTitle(baseName),
    showTitle: null,
    season: null,
    episode: null,
    year: extractYear(baseName),
  }
}
