// Custom line-icon set for MosaicTV. Stroke-based and drawn with currentColor,
// so each icon inherits its text color (e.g. the violet active-nav state). No
// external icon dependency — CSP-safe and consistent with the theme.

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
}

export default function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
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
