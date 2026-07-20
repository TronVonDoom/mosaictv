// Custom line-icon set for MosaicTV. Stroke-based; by default drawn with
// currentColor so each icon inherits its text color. Pass `colored` to stroke
// it with the icon's own identity color (a single solid hue per icon, drawn
// from the brand mosaic palette) — uniform weight, distinct colors. No external
// icon dependency — CSP-safe and consistent with the theme.

export type IconName =
  | 'dashboard'
  | 'browse'
  | 'channels'
  | 'libraries'
  | 'media'
  | 'logs'
  | 'settings'
  | 'm3u'
  | 'xmltv'
  | 'show'
  | 'movie'
  | 'clip'
  | 'folder'
  | 'audio'
  | 'image'
  | 'clock'
  | 'upnext'

// Each icon's identity color — one solid hue per icon, spanning the brand
// mosaic palette so the set reads as a cohesive spectrum. The sidebar nav is
// ordered so these flow violet→rose down the rail.
const COLOR: Record<IconName, string> = {
  dashboard: '#a855f7', // violet
  browse: '#818cf8', // indigo
  channels: '#3b82f6', // blue
  libraries: '#22d3ee', // cyan
  media: '#34d399', // green
  logs: '#fbbf24', // gold
  settings: '#fb7185', // rose
  show: '#3b82f6', // blue
  movie: '#a855f7', // violet
  clip: '#22d3ee', // cyan
  folder: '#fbbf24', // gold
  audio: '#f472b6', // pink
  image: '#34d399', // green
  clock: '#818cf8', // indigo
  upnext: '#fb7185', // rose
  m3u: '#34d399', // green
  xmltv: '#22d3ee', // cyan
}

const PATHS: Record<IconName, React.ReactNode> = {
  // 2×2 mosaic tiles — a nod to the brand mark.
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  // Film strip.
  browse: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
    </>
  ),
  // Broadcast: signal arcs radiating from a center dot.
  channels: (
    <>
      <circle cx="12" cy="12" r="1.6" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M6 6a9 9 0 0 0 0 12M18 6a9 9 0 0 1 0 12" />
    </>
  ),
  // Folder.
  libraries: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  // Image / picture.
  media: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M4 17l4.5-4.5L13 17M14 15l2.5-2.5L20 16" />
    </>
  ),
  // Document with lines.
  logs: (
    <>
      <path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4M8 12h8M8 16h8M8 8h3" />
    </>
  ),
  // Sliders.
  settings: (
    <>
      <path d="M4 7h10M18 7h2M4 12h2M10 12h10M4 17h7M15 17h5" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="13" cy="17" r="2" />
    </>
  ),
  // Playlist with a play cue.
  m3u: (
    <>
      <path d="M4 6h11M4 10h11M4 14h7" />
      <path d="M15 13.5v6l5-3z" />
    </>
  ),
  // Guide grid / calendar.
  xmltv: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 4V2.5M16 4V2.5M8 13h3M13 13h3M8 17h3M13 17h3" />
    </>
  ),
  // TV set — a show.
  show: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M12 7l-4-4M12 7l4-4M9 20h6" />
    </>
  ),
  // Clapperboard — a movie.
  movie: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="1.5" />
      <path d="M3 10h18M7 6l-1.5 4M12 6l-1.5 4M17 6l-1.5 4" />
    </>
  ),
  // Film frame with sprockets — a clip / other.
  clip: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M4 8h2M4 12h2M4 16h2M18 8h2M18 12h2M18 16h2" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  // Music note.
  audio: (
    <>
      <path d="M9 18V5l11-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M4 17l4.5-4.5L13 17M14 15l2.5-2.5L20 16" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  // Skip-to-next — "coming up next".
  upnext: (
    <>
      <path d="M5 5l9 7-9 7z" />
      <path d="M18 5v14" />
    </>
  ),
}

export default function Icon({
  name,
  size = 18,
  className,
  colored = false,
}: {
  name: IconName
  size?: number
  className?: string
  colored?: boolean
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={colored ? COLOR[name] : 'currentColor'}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
