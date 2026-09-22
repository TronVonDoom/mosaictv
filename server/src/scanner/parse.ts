import path from 'node:path'

export type LibraryKind = 'tv' | 'movie' | 'music' | 'other'

export type ParsedMedia = {
  type: 'movie' | 'episode' | 'music' | 'other'
  title: string
  showTitle: string | null
  season: number | null
  episode: number | null
  year: number | null
  artist: string | null
  album: string | null
}

// Light cleanup for artist/album folder names (no year/quality stripping —
// those are meaningful far less often here than in movie/TV names).
function cleanName(raw: string): string {
  return raw.replace(/[._]/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

const YEAR_RE = /\((\d{4})\)/
// Matches S01E02, s1e2, 1x02, etc.
const SEASON_EP_RE = /\bS(\d{1,2})[\s._-]*E(\d{1,3})\b|\b(\d{1,2})x(\d{1,3})\b/i

// One resolution/source/codec token as it appears inside a parenthetical.
const QUALITY_TOKEN_RE = new RegExp(
  '^(?:' +
    [
      '\\d{3,4}p', '4k', 'uhd', 'hd', 'sd', 'hdr\\d*', 'sdr',
      'x26[45]', 'h\\.?26[45]', 'hevc', 'avc', 'xvid', 'divx', 'mpeg-?[24]', 'vp9', 'av1', '\\d+bits?',
      'blu-?ray', 'bd-?rip', 'br-?rip', 'br-?disk', 'br', 'web-?dl', 'web-?rip', 'web',
      'hd-?tv', 'dvd-?rip', 'dvd', 'remux',
      'aac\\d*', 'ac-?3', 'e-?ac-?3', 'dts(?:-hd)?', 'flac', 'mp3',
      'other',
    ].join('|') +
    ')$',
  'i',
)
// A release group's tag: shouted, no lowercase — "EDGE2020", "RARBG", "YTS".
const GROUP_TAG_RE = /^[A-Z][A-Z0-9]{2,}$/

function tokenKind(part: string): 'quality' | 'group' | 'other' {
  if (QUALITY_TOKEN_RE.test(part)) return 'quality'
  // Compounds the scene joins with a hyphen: "Bluray-1080p", "WEBRip-2160p".
  const pieces = part.split('-')
  if (pieces.length > 1 && pieces.every((p) => QUALITY_TOKEN_RE.test(p))) return 'quality'
  if (GROUP_TAG_RE.test(part)) return 'group'
  return 'other'
}

/**
 * True when a parenthetical is nothing but release metadata — "(HD)",
 * "(Bluray-1080p x265)", "(480p x265 EDGE2020)".
 *
 * A group's tag only counts alongside a real quality token, so a title keeps
 * its meaningful parentheticals: "(Unaired Pilot)", "(Colorized)",
 * "(Director's Cut 1992)", "(US)", and the "(1)"/"(2)" that number a two-parter.
 */
function isReleaseTag(inner: string): boolean {
  const parts = inner.split(/[\s,._]+/).filter(Boolean)
  if (parts.length === 0) return false
  const kinds = parts.map(tokenKind)
  return !kinds.includes('other') && kinds.includes('quality')
}

/** Strip a trailing "(2020)", release tags, and tidy whitespace into a clean title. */
function cleanTitle(raw: string): string {
  return raw
    .replace(YEAR_RE, '')
    .replace(/\(([^()]*)\)/g, (whole, inner: string) => (isReleaseTag(inner) ? '' : whole))
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
        artist: null,
        album: null,
      }
    }
    // No SxxEyy match — fall through to a generic entry.
    return { type: 'other', title: cleanTitle(baseName), showTitle: null, season: null, episode: null, year: null, artist: null, album: null }
  }

  if (kind === 'music') {
    // Music-video layout: Artist/Album/Title.ext or Artist/Title.ext; a flat
    // file falls back to "Artist - Title.ext".
    let artist: string | null = null
    let album: string | null = null
    let title = cleanTitle(baseName)
    if (segments.length >= 3) {
      artist = cleanName(segments[0])
      album = cleanName(segments[segments.length - 2])
    } else if (segments.length === 2) {
      artist = cleanName(segments[0])
    } else {
      const dash = baseName.split(/\s+-\s+/)
      if (dash.length >= 2) {
        artist = cleanName(dash[0])
        title = cleanTitle(dash.slice(1).join(' - '))
      }
    }
    return { type: 'music', title, showTitle: null, season: null, episode: null, year: extractYear(baseName), artist, album }
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
      artist: null,
      album: null,
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
    artist: null,
    album: null,
  }
}
