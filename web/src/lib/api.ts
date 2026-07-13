export type Health = {
  status: string
  version: string
  uptimeSeconds: number
  node: string
  ffmpeg: boolean
}

export type Stats = {
  libraries: number
  items: number
  missing: number
  byType: Record<string, number>
  totalDurationSec: number
}

export type LibraryKind = 'tv' | 'movie' | 'other'

export type LibraryFolder = {
  id: number
  path: string
}

export type Library = {
  id: number
  name: string
  kind: LibraryKind
  createdAt: string
  folders: LibraryFolder[]
  itemCount: number
}

export type MediaItem = {
  id: number
  libraryId: number
  path: string
  type: 'movie' | 'episode' | 'other'
  title: string
  showTitle: string | null
  season: number | null
  episode: number | null
  year: number | null
  durationSec: number | null
  width: number | null
  height: number | null
  videoCodec: string | null
  audioCodec: string | null
  container: string | null
  sizeBytes: number | null
  posterPath: string | null
  showPosterPath: string | null
  seasonPosterPath: string | null
  tmdbId: number | null
  overview: string | null
  genres: string | null
  rating: number | null
  tmdbPosterPath: string | null
  tmdbBackdropPath: string | null
  missing: boolean
}

export type MediaItemDetail = MediaItem & {
  library: { name: string; kind: LibraryKind }
}

export type MediaPage = {
  total: number
  page: number
  pageSize: number
  items: MediaItem[]
}

export type Show = {
  showTitle: string
  year: number | null
  seasonCount: number
  episodeCount: number
  totalDurationSec: number
  libraryId: number
  posterItemId: number | null
  tmdbPosterPath: string | null
  overview: string | null
  rating: number | null
  genres: string | null
}

export type SeasonGroup = {
  season: number | null
  episodes: MediaItem[]
  tmdbPosterPath: string | null
}

export type ShowDetail = {
  showTitle: string
  year: number | null
  episodeCount: number
  overview: string | null
  genres: string | null
  rating: number | null
  tmdbPosterPath: string | null
  seasons: SeasonGroup[]
}

export type SettingsInfo = { tmdbConfigured: boolean }

export type MetadataStatus = {
  running: boolean
  libraryId: number | null
  libraryName: string | null
  total: number
  processed: number
  matched: number
  unmatched: number
  currentTitle: string | null
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

export type FsListing = {
  path: string
  parent: string | null
  dirs: { name: string; path: string }[]
}

export type ScanStatus = {
  running: boolean
  libraryId: number | null
  libraryName: string | null
  total: number
  processed: number
  added: number
  updated: number
  removed: number
  skipped: number
  currentPath: string | null
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

export type CollectionItem = {
  id: number
  kind: 'show' | 'movie'
  showTitle: string | null
  libraryId: number | null
  mediaItemId: number | null
  label: string | null
  order: number
}

export type Collection = {
  id: number
  name: string
  libraryId: number | null
  filterType: string | null
  filterShow: string | null
  filterSearch: string | null
  filterGenre: string | null
  items: CollectionItem[]
  itemCount: number
}

export type MediaSearchResult =
  | { kind: 'show'; showTitle: string; libraryId: number; libraryName: string; episodeCount: number }
  | { kind: 'movie'; mediaItemId: number; title: string; year: number | null }

export type RotationItem = {
  id: number
  collectionId: number
  order: number
  playbackOrder: string
  mode: string
  count: number
  collection: { id: number; name: string }
}

export type TimeBlock = {
  id: number
  collectionId: number
  days: string
  startMinute: number
  endMinute: number
  playbackOrder: string
  logoUrl: string | null
  collection: { id: number; name: string }
}

export type Channel = {
  id: number
  number: number
  name: string
  group: string | null
  logoUrl: string | null
  rotationCount: number
  blockCount: number
  playoutCount: number
  playoutCursor: string | null
}

export type ChannelDetail = {
  id: number
  number: number
  name: string
  group: string | null
  logoUrl: string | null
  rotationItems: RotationItem[]
  timeBlocks: TimeBlock[]
}

export type PlayoutEntry = {
  id: number
  startTime: string
  stopTime: string
  mediaItem: {
    id: number
    title: string
    showTitle: string | null
    season: number | null
    episode: number | null
    type: string
    durationSec: number | null
    posterPath: string | null
    tmdbPosterPath: string | null
  }
}

export type Playout = { now: string; items: PlayoutEntry[] }

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      /* non-JSON error */
    }
    throw new Error(message)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  health: () => request<Health>('/api/health'),
  stats: () => request<Stats>('/api/stats'),
  libraries: () => request<Library[]>('/api/libraries'),
  addLibrary: (data: { name: string; kind: LibraryKind; folders: string[] }) =>
    request<Library>('/api/libraries', { method: 'POST', body: JSON.stringify(data) }),
  deleteLibrary: (id: number) =>
    request<void>(`/api/libraries/${id}`, { method: 'DELETE' }),
  addFolder: (libraryId: number, path: string) =>
    request<LibraryFolder>(`/api/libraries/${libraryId}/folders`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  removeFolder: (libraryId: number, folderId: number) =>
    request<void>(`/api/libraries/${libraryId}/folders/${folderId}`, { method: 'DELETE' }),
  startScan: (libraryId: number) =>
    request<{ started: boolean }>(`/api/scan/${libraryId}`, { method: 'POST' }),
  scanStatus: () => request<ScanStatus>('/api/scan/status'),
  media: (params: {
    page?: number
    pageSize?: number
    type?: string
    libraryId?: number
    q?: string
  }) => {
    const qs = new URLSearchParams()
    if (params.page) qs.set('page', String(params.page))
    if (params.pageSize) qs.set('pageSize', String(params.pageSize))
    if (params.type) qs.set('type', params.type)
    if (params.libraryId) qs.set('libraryId', String(params.libraryId))
    if (params.q) qs.set('q', params.q)
    return request<MediaPage>(`/api/media?${qs.toString()}`)
  },
  mediaItem: (id: number) => request<MediaItemDetail>(`/api/media/${id}`),
  shows: (libraryId: number) =>
    request<{ shows: Show[] }>(`/api/shows?libraryId=${libraryId}`),
  showDetail: (libraryId: number, show: string) =>
    request<ShowDetail>(
      `/api/shows/detail?libraryId=${libraryId}&show=${encodeURIComponent(show)}`,
    ),
  browse: (path?: string) =>
    request<FsListing>(`/api/fs${path ? `?path=${encodeURIComponent(path)}` : ''}`),
  settings: () => request<SettingsInfo>('/api/settings'),
  saveTmdbKey: (apiKey: string) =>
    request<{ ok: boolean }>('/api/settings/tmdb', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    }),
  startMetadata: (libraryId: number, force = false) =>
    request<{ started: boolean }>(`/api/metadata/${libraryId}${force ? '?force=1' : ''}`, {
      method: 'POST',
    }),
  metadataStatus: () => request<MetadataStatus>('/api/metadata/status'),

  // --- collections ---
  collections: () => request<Collection[]>('/api/collections'),
  addCollection: (data: {
    name: string
    libraryId?: number | null
    filterType?: string | null
    filterShow?: string | null
    filterSearch?: string | null
    filterGenre?: string | null
  }) => request<Collection>('/api/collections', { method: 'POST', body: JSON.stringify(data) }),
  deleteCollection: (id: number) =>
    request<void>(`/api/collections/${id}`, { method: 'DELETE' }),
  collectionPreview: (id: number) =>
    request<{ count: number; sample: MediaItem[] }>(`/api/collections/${id}/preview`),
  searchMedia: (q: string) =>
    request<{ results: MediaSearchResult[] }>(`/api/collections/search?q=${encodeURIComponent(q)}`),
  addCollectionItem: (
    collectionId: number,
    member:
      | { kind: 'show'; showTitle: string; libraryId: number; label: string }
      | { kind: 'movie'; mediaItemId: number; label: string },
  ) =>
    request<CollectionItem>(`/api/collections/${collectionId}/items`, {
      method: 'POST',
      body: JSON.stringify(member),
    }),
  deleteCollectionItem: (collectionId: number, itemId: number) =>
    request<void>(`/api/collections/${collectionId}/items/${itemId}`, { method: 'DELETE' }),

  // --- channels ---
  channels: () => request<Channel[]>('/api/channels'),
  addChannel: (data: { number: number; name: string; group?: string | null }) =>
    request<Channel>('/api/channels', { method: 'POST', body: JSON.stringify(data) }),
  channel: (id: number) => request<ChannelDetail>(`/api/channels/${id}`),
  updateChannel: (id: number, data: { name?: string; group?: string | null; logoUrl?: string | null }) =>
    request<Channel>(`/api/channels/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteChannel: (id: number) => request<void>(`/api/channels/${id}`, { method: 'DELETE' }),
  addRotation: (
    channelId: number,
    data: { collectionId: number; mode: string; count: number; playbackOrder: string },
  ) => request<RotationItem>(`/api/channels/${channelId}/rotation`, { method: 'POST', body: JSON.stringify(data) }),
  deleteRotation: (channelId: number, itemId: number) =>
    request<void>(`/api/channels/${channelId}/rotation/${itemId}`, { method: 'DELETE' }),
  addBlock: (
    channelId: number,
    data: { collectionId: number; days: string; startMinute: number; endMinute: number; playbackOrder: string; logoUrl?: string | null },
  ) => request<TimeBlock>(`/api/channels/${channelId}/blocks`, { method: 'POST', body: JSON.stringify(data) }),
  deleteBlock: (channelId: number, blockId: number) =>
    request<void>(`/api/channels/${channelId}/blocks/${blockId}`, { method: 'DELETE' }),
  buildPlayout: (channelId: number, hours = 48) =>
    request<{ built: number }>(`/api/channels/${channelId}/build?hours=${hours}`, { method: 'POST' }),
  resetPlayout: (channelId: number) =>
    request<{ ok: boolean }>(`/api/channels/${channelId}/reset`, { method: 'POST' }),
  playout: (channelId: number, hours = 24) =>
    request<Playout>(`/api/channels/${channelId}/playout?hours=${hours}`),
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function formatDays(csv: string): string {
  const days = csv.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)).sort()
  if (days.length === 7) return 'Every day'
  if (days.join(',') === '1,2,3,4,5') return 'Weekdays'
  if (days.join(',') === '0,6') return 'Weekends'
  return days.map((d) => DAY_NAMES[d]).join(', ')
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

// Build a TMDB CDN image URL from a stored path like "/abc.jpg".
export function tmdbImage(path: string, size: 'w200' | 'w342' | 'w500' | 'original' = 'w342'): string {
  return `https://image.tmdb.org/t/p/${size}${path}`
}

export function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatSize(bytes: number | null): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

// URL for a local artwork file, or null if the item has none of that type.
export function artworkUrl(
  id: number,
  type: 'poster' | 'show' | 'season',
): string {
  return `/api/artwork/${id}?type=${type}`
}

// Deterministic dark gradient for placeholder "posters" (no artwork yet).
export function posterGradient(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  const h2 = (h + 45) % 360
  return `linear-gradient(150deg, hsl(${h} 45% 32%), hsl(${h2} 50% 18%))`
}
