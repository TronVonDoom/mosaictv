// MosaicTV's icon vocabulary. The glyphs come from Lucide (bundled SVG
// components — nothing is fetched at runtime, so it stays CSP-safe and works
// offline); this module owns the *names* the app speaks in, so a page asks for
// "channels" rather than knowing which drawing that is today.
//
// Icons draw in currentColor by default. `colored` strokes an icon with its
// identity hue instead — used sparingly, for the tinted tiles on page headers,
// empty states and stat tiles, never for navigation.

import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpDown,
  CalendarRange,
  Captions,
  Cast,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Clock3,
  Command,
  Copy,
  Cpu,
  Database,
  Download,
  Ellipsis,
  ExternalLink,
  Eye,
  Film,
  Filter,
  FolderOpen,
  Gauge,
  Globe,
  HardDrive,
  Hash,
  Image,
  Info,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  Layers,
  LibraryBig,
  Link2,
  List,
  ListVideo,
  Menu,
  MonitorPlay,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  RadioTower,
  RefreshCw,
  ScrollText,
  Search,
  Server,
  Settings2,
  Shuffle,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Tv,
  Upload,
  Users,
  Wand2,
  X,
  Zap,
} from 'lucide-react'

export type IconName =
  // Navigation / places
  | 'dashboard'
  | 'channels'
  | 'guide'
  | 'libraries'
  | 'browse'
  | 'media'
  | 'logs'
  | 'settings'
  | 'm3u'
  | 'xmltv'
  // Media kinds
  | 'show'
  | 'movie'
  | 'clip'
  | 'folder'
  | 'audio'
  | 'image'
  | 'clock'
  | 'upnext'
  // Actions
  | 'play'
  | 'plus'
  | 'search'
  | 'edit'
  | 'trash'
  | 'more'
  | 'external'
  | 'copy'
  | 'check'
  | 'close'
  | 'back'
  | 'refresh'
  | 'upload'
  | 'download'
  | 'filter'
  | 'sort'
  | 'chevronRight'
  | 'chevronLeft'
  | 'chevronDown'
  | 'collapse'
  | 'expand'
  | 'menu'
  // Status & misc
  | 'live'
  | 'cast'
  | 'users'
  | 'eye'
  | 'star'
  | 'info'
  | 'warning'
  | 'success'
  | 'sparkles'
  | 'bolt'
  | 'cpu'
  | 'server'
  | 'disk'
  | 'database'
  | 'activity'
  | 'gauge'
  | 'link'
  | 'grid'
  | 'list'
  | 'layers'
  | 'shuffle'
  | 'hash'
  | 'globe'
  | 'captions'
  | 'wand'
  | 'key'
  | 'command'
  | 'calendar'
  | 'sliders'
  | 'tv'

const GLYPH: Record<IconName, LucideIcon> = {
  dashboard: LayoutDashboard,
  channels: RadioTower,
  guide: CalendarRange,
  libraries: LibraryBig,
  browse: Film,
  media: Wand2,
  logs: ScrollText,
  settings: Settings2,
  m3u: ListVideo,
  xmltv: CalendarRange,
  show: Tv,
  movie: Clapperboard,
  clip: Film,
  folder: FolderOpen,
  audio: Music2,
  image: Image,
  clock: Clock3,
  upnext: SkipForward,
  play: Play,
  plus: Plus,
  search: Search,
  edit: Pencil,
  trash: Trash2,
  more: Ellipsis,
  external: ExternalLink,
  copy: Copy,
  check: Check,
  close: X,
  back: ArrowLeft,
  refresh: RefreshCw,
  upload: Upload,
  download: Download,
  filter: Filter,
  sort: ArrowUpDown,
  chevronRight: ChevronRight,
  chevronLeft: ChevronLeft,
  chevronDown: ChevronDown,
  collapse: PanelLeftClose,
  expand: PanelLeftOpen,
  menu: Menu,
  live: RadioTower,
  cast: Cast,
  users: Users,
  eye: Eye,
  star: Star,
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle2,
  sparkles: Sparkles,
  bolt: Zap,
  cpu: Cpu,
  server: Server,
  disk: HardDrive,
  database: Database,
  activity: Activity,
  gauge: Gauge,
  link: Link2,
  grid: LayoutGrid,
  list: List,
  layers: Layers,
  shuffle: Shuffle,
  hash: Hash,
  globe: Globe,
  captions: Captions,
  wand: Wand2,
  key: KeyRound,
  command: Command,
  calendar: CalendarRange,
  sliders: SlidersHorizontal,
  tv: MonitorPlay,
}

// Identity hues, a notch lighter than the brand's own so they sit comfortably
// on dark tiles. Anything not listed draws in the brand violet.
const COLOR: Partial<Record<IconName, string>> = {
  dashboard: '#a78bfa',
  channels: '#60a5fa',
  guide: '#38bdf8',
  libraries: '#22d3ee',
  browse: '#818cf8',
  media: '#34d399',
  logs: '#fbbf24',
  settings: '#fb7185',
  show: '#60a5fa',
  movie: '#c084fc',
  clip: '#22d3ee',
  folder: '#fbbf24',
  audio: '#f472b6',
  image: '#34d399',
  clock: '#818cf8',
  upnext: '#fb7185',
  m3u: '#34d399',
  xmltv: '#22d3ee',
  live: '#ff5b6b',
  users: '#fb7185',
  star: '#fbbf24',
  warning: '#fbbf24',
  success: '#34d399',
  cpu: '#38bdf8',
  server: '#2dd4bf',
  disk: '#a78bfa',
  database: '#818cf8',
  activity: '#34d399',
  sparkles: '#c084fc',
}

/** The identity hue for an icon — for tinting the tile it sits on. */
export function iconColor(name: IconName): string {
  return COLOR[name] ?? '#a78bfa'
}

export default function Icon({
  name,
  size = 18,
  className,
  colored = false,
  strokeWidth = 1.75,
}: {
  name: IconName
  size?: number
  className?: string
  colored?: boolean
  strokeWidth?: number
}) {
  const Glyph = GLYPH[name]
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      color={colored ? iconColor(name) : 'currentColor'}
      className={className}
      aria-hidden="true"
    />
  )
}
