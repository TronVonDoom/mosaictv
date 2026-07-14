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

export type WatermarkConfig = {
  mode: 'permanent' | 'intermittent' | 'none'
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  widthPercent: number
  horizontalMarginPercent: number
  verticalMarginPercent: number
  opacityPercent: number
  frequencyMinutes: number
  durationSeconds: number
  fadeSeconds: number
  constrainToMedia: boolean
}

export type SettingsInfo = {
  tmdbConfigured: boolean
  watermark: WatermarkConfig
}

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

export type FillerOwner = { channelId?: number; timeBlockId?: number }
export type Filler = {
  id: number
  channelId: number | null
  timeBlockId: number | null
  name: string | null
  style: 'animated' | 'frosted' | 'custom'
  assetId: number | null
  audioAssetId: number | null
  generatedAssetId: number | null
  durationMode: 'fixed' | 'audio'
  durationSec: number
  order: number
}
export type FillerInput = {
  name?: string | null
  style: 'animated' | 'frosted' | 'custom'
  assetId?: number | null
  audioAssetId?: number | null
  durationMode: 'fixed' | 'audio'
  durationSec: number
}
export type FillerGenStatus = { percent?: number; done?: boolean; error?: string; assetId?: number; idle?: boolean }
export type Collection = {
  id: number
  name: string
  channelId: number | null
  logoId: number | null
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

export type Logo = { id: number; name: string; mime: string; watermark: WatermarkConfig }
export function logoImageUrl(id: number): string {
  return `/api/logos/${id}/image`
}

export type AssetKind = 'audio' | 'filler'
export type Asset = {
  id: number
  name: string
  kind: AssetKind
  mime: string
  sizeBytes: number | null
  createdAt: string
}
export function assetFileUrl(id: number): string {
  return `/api/assets/${id}/file`
}

export type TimeBlock = {
  id: number
  collectionId: number
  days: string
  startMinute: number
  endMinute: number
  playbackOrder: string
  logoUrl: string | null
  logoId: number | null
  fillerMode: string
  startMode: string
  collection: { id: number; name: string }
}

export type Channel = {
  id: number
  number: number | null
  name: string
  group: string | null
  logoUrl: string | null
  logoId: number | null
  rotationCount: number
  blockCount: number
  playoutCount: number
  playoutCursor: string | null
  viewers: number
  nowPlaying: string | null
}

export type ChannelDetail = {
  id: number
  number: number | null
  name: string
  group: string | null
  logoUrl: string | null
  logoId: number | null
  profileId: number | null
  rotationItems: RotationItem[]
  timeBlocks: TimeBlock[]
}

export type EncodingProfile = {
  id: number
  name: string
  width: number
  height: number
  fps: number
  quality: 'low' | 'medium' | 'high'
  hwaccel: 'auto' | 'nvidia' | 'cpu'
  audioBitrate: number
}
export type ProfileFields = Omit<EncodingProfile, 'id' | 'name'>
export type ProfileInput = { name: string } & ProfileFields

export type PlayoutEntry = {
  id: number
  startTime: string
  stopTime: string
  kind: string
  title: string | null
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
  } | null
}

export type Playout = { now: string; items: PlayoutEntry[] }

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogCategory = 'stream' | 'ffmpeg' | 'playout' | 'system'
export type LogEntry = {
  id: number
  ts: string
  level: LogLevel
  category: LogCategory
  message: string
  detail?: string
}
export type LogsResponse = { entries: LogEntry[]; lastId: number; total: number }

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
  startScan: (libraryId: number, force = false) =>
    request<{ started: boolean }>(`/api/scan/${libraryId}${force ? '?force=1' : ''}`, { method: 'POST' }),
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
  saveWatermark: (wm: WatermarkConfig) =>
    request<{ ok: boolean; watermark: WatermarkConfig }>('/api/settings/watermark', { method: 'POST', body: JSON.stringify(wm) }),

  // --- collections ---
  collections: (channelId?: number) =>
    request<Collection[]>(`/api/collections${channelId != null ? `?channelId=${channelId}` : ''}`),
  addCollection: (data: {
    name: string
    channelId?: number | null
    logoId?: number | null
    libraryId?: number | null
    filterType?: string | null
    filterShow?: string | null
    filterSearch?: string | null
    filterGenre?: string | null
  }) => request<Collection>('/api/collections', { method: 'POST', body: JSON.stringify(data) }),
  deleteCollection: (id: number) =>
    request<void>(`/api/collections/${id}`, { method: 'DELETE' }),
  updateCollection: (
    id: number,
    data: {
      name?: string
      logoId?: number | null
      libraryId?: number | null
      filterType?: string | null
      filterSearch?: string | null
      filterGenre?: string | null
    },
  ) => request<Collection>(`/api/collections/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
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
  fillers: (owner: FillerOwner) => {
    const qs = owner.channelId != null ? `channelId=${owner.channelId}` : `timeBlockId=${owner.timeBlockId}`
    return request<Filler[]>(`/api/fillers?${qs}`)
  },
  addFiller: (owner: FillerOwner, data: FillerInput) =>
    request<Filler>('/api/fillers', { method: 'POST', body: JSON.stringify({ ...owner, ...data }) }),
  updateFiller: (id: number, data: FillerInput) =>
    request<Filler>(`/api/fillers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteFiller: (id: number) => request<void>(`/api/fillers/${id}`, { method: 'DELETE' }),
  generateFillerClip: (id: number) => request<{ started: boolean }>(`/api/fillers/${id}/generate`, { method: 'POST' }),
  fillerGenStatus: (id: number) => request<FillerGenStatus>(`/api/fillers/${id}/generate/status`),

  // --- channels ---
  channels: () => request<Channel[]>('/api/channels'),
  addChannel: (data: { number?: number | null; name: string; group?: string | null; logoId?: number | null }) =>
    request<Channel>('/api/channels', { method: 'POST', body: JSON.stringify(data) }),
  channel: (id: number) => request<ChannelDetail>(`/api/channels/${id}`),
  updateChannel: (id: number, data: { number?: number | null; name?: string; group?: string | null; logoUrl?: string | null; logoId?: number | null; profileId?: number | null }) =>
    request<Channel>(`/api/channels/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // --- encoding profiles ---
  profiles: () => request<{ profiles: EncodingProfile[]; default: ProfileFields }>('/api/profiles'),
  addProfile: (data: ProfileInput) => request<EncodingProfile>('/api/profiles', { method: 'POST', body: JSON.stringify(data) }),
  updateProfile: (id: number, data: ProfileInput) => request<EncodingProfile>(`/api/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteProfile: (id: number) => request<void>(`/api/profiles/${id}`, { method: 'DELETE' }),
  logos: () => request<Logo[]>('/api/logos'),
  uploadLogo: (name: string, dataUrl: string) =>
    request<Logo>('/api/logos', { method: 'POST', body: JSON.stringify({ name, dataUrl }) }),
  updateLogo: (id: number, data: { name?: string; watermark?: WatermarkConfig }) =>
    request<Logo>(`/api/logos/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteLogo: (id: number) => request<void>(`/api/logos/${id}`, { method: 'DELETE' }),
  deleteChannel: (id: number) => request<void>(`/api/channels/${id}`, { method: 'DELETE' }),
  addRotation: (
    channelId: number,
    data: { collectionId: number; mode: string; count: number; playbackOrder: string },
  ) => request<RotationItem>(`/api/channels/${channelId}/rotation`, { method: 'POST', body: JSON.stringify(data) }),
  deleteRotation: (channelId: number, itemId: number) =>
    request<void>(`/api/channels/${channelId}/rotation/${itemId}`, { method: 'DELETE' }),
  addBlock: (
    channelId: number,
    data: { collectionId: number; days: string; startMinute: number; endMinute: number; playbackOrder: string; logoUrl?: string | null; fillerMode?: string; logoId?: number | null; startMode?: string },
  ) => request<TimeBlock>(`/api/channels/${channelId}/blocks`, { method: 'POST', body: JSON.stringify(data) }),
  updateBlock: (
    channelId: number,
    blockId: number,
    data: { collectionId: number; days: string; startMinute: number; endMinute: number; playbackOrder: string; logoUrl?: string | null; fillerMode?: string; logoId?: number | null; startMode?: string },
  ) => request<TimeBlock>(`/api/channels/${channelId}/blocks/${blockId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteBlock: (channelId: number, blockId: number) =>
    request<void>(`/api/channels/${channelId}/blocks/${blockId}`, { method: 'DELETE' }),
  buildPlayout: (channelId: number, hours = 48) =>
    request<{ built: number }>(`/api/channels/${channelId}/build?hours=${hours}`, { method: 'POST' }),
  resetPlayout: (channelId: number, hard = false) =>
    request<{ ok: boolean }>(`/api/channels/${channelId}/reset${hard ? '?hard=1' : ''}`, { method: 'POST' }),
  playout: (channelId: number, hours = 24) =>
    request<Playout>(`/api/channels/${channelId}/playout?hours=${hours}`),

  // --- logs ---
  logs: (params: { level?: LogLevel; category?: LogCategory; limit?: number } = {}) => {
    const qs = new URLSearchParams()
    if (params.level) qs.set('level', params.level)
    if (params.category) qs.set('category', params.category)
    if (params.limit) qs.set('limit', String(params.limit))
    const q = qs.toString()
    return request<LogsResponse>(`/api/logs${q ? `?${q}` : ''}`)
  },
  clearLogs: () => request<void>('/api/logs', { method: 'DELETE' }),

  // --- media assets ---
  assets: (kind?: AssetKind) =>
    request<Asset[]>(`/api/assets${kind ? `?kind=${kind}` : ''}`),
  uploadAsset: async (kind: AssetKind, name: string, file: File): Promise<Asset> => {
    const res = await fetch(`/api/assets?kind=${kind}&name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })
    if (!res.ok) {
      let message = `Upload failed (${res.status})`
      try {
        const b = await res.json()
        if (b?.error) message = b.error
      } catch {
        /* ignore */
      }
      throw new Error(message)
    }
    return res.json() as Promise<Asset>
  },
  deleteAsset: (id: number) => request<void>(`/api/assets/${id}`, { method: 'DELETE' }),

  // --- admin / maintenance ---
  resetInstance: (assets: boolean) =>
    request<{ ok: boolean }>('/api/admin/reset', { method: 'POST', body: JSON.stringify({ confirm: 'RESET', assets }) }),
}

export const logsDownloadUrl = '/api/logs/download'
export const backupUrl = '/api/admin/backup'

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
