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

export type LibraryKind = 'tv' | 'movie' | 'music' | 'other'

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
  type: 'movie' | 'episode' | 'music' | 'other'
  title: string
  showTitle: string | null
  season: number | null
  episode: number | null
  year: number | null
  artist: string | null
  album: string | null
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

// One segment of a broadcast episode — enough to render it even when it's
// borrowed from another show (so the current season's episode list wouldn't
// carry it).
export type AiringSegmentInfo = {
  mediaItemId: number
  showTitle: string | null
  season: number | null
  episode: number | null
  title: string
  durationSec: number | null
  missing: boolean
}

// A broadcast episode: the ordered episode files that aired together as one
// program. Stored per show; the files keep their canonical S/E numbering, and a
// segment may come from another show (2 Stupid Dogs pulling in Secret Squirrel).
export type Airing = {
  id: number
  season: number | null
  number: number
  title: string | null
  segments: AiringSegmentInfo[]
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
  showOnFiller: boolean
  constrainToMedia: boolean
}

export type ComingUpConfig = {
  enabled: boolean
  timing: 'middle' | 'beforeEnd' | 'both'
  leadSeconds: number
  holdSeconds: number
  fadeSeconds: number
  position: 'top' | 'bottom'
  template: string
  fontSizePercent: number
  opacityPercent: number
}

// Starting point when a channel/block first enables a caption.
export const DEFAULT_COMINGUP: ComingUpConfig = {
  enabled: true,
  timing: 'beforeEnd',
  leadSeconds: 300,
  holdSeconds: 12,
  fadeSeconds: 0.5,
  position: 'bottom',
  template: 'Coming up next: %showtitle% — %episodetitle%',
  fontSizePercent: 4,
  opacityPercent: 90,
}

/** Parse a stored comingUp JSON string into a config (null/invalid → null). */
export function parseComingUp(json: string | null | undefined): ComingUpConfig | null {
  if (!json) return null
  try {
    return { ...DEFAULT_COMINGUP, ...(JSON.parse(json) as Partial<ComingUpConfig>) }
  } catch {
    return null
  }
}

export type StreamMode = 'mpegts' | 'hls'
export type SettingsInfo = {
  tmdbConfigured: boolean
  watermark: WatermarkConfig
  streamMode: StreamMode
  tunerCount: number
  hdhrDeviceId: string
  hdhrFriendlyName: string
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

export type MemberKind = 'show' | 'season' | 'episode' | 'movie'
export type CollectionItem = {
  id: number
  kind: MemberKind
  showTitle: string | null
  libraryId: number | null
  season: number | null
  mediaItemId: number | null
  label: string | null
  order: number
}

export type FillerOwner = { channelId?: number; timeBlockId?: number }
export type FillerVisual = 'animated' | 'frosted' | 'custom' | 'logowall' | 'pulse' | 'retro' | 'vintage'
export type Filler = {
  id: number
  channelId: number | null
  timeBlockId: number | null
  name: string | null
  style: FillerVisual
  assetId: number | null
  audioAssetId: number | null
  generatedAssetId: number | null
  durationMode: 'fixed' | 'audio'
  durationSec: number
  order: number
}
export type FillerInput = {
  name?: string | null
  style: FillerVisual
  assetId?: number | null
  audioAssetId?: number | null
  durationMode: 'fixed' | 'audio'
  durationSec: number
}
export type FillerGenStatus = { percent?: number; done?: boolean; error?: string; assetId?: number; idle?: boolean }
export type FillerGenJob = { fillerId: number; percent: number; done: boolean; error: string | null }
export type Collection = {
  id: number
  name: string
  channelId: number | null
  logoId: number | null
  // The order used wherever a rotation item or block says "inherit".
  defaultOrder: string
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
  | { kind: 'season'; showTitle: string; libraryId: number; libraryName: string; season: number; episodeCount: number }
  | { kind: 'episode'; mediaItemId: number; title: string; showTitle: string | null; season: number | null; episode: number | null }
  | { kind: 'movie'; mediaItemId: number; title: string; year: number | null }

export type RotationItem = {
  id: number
  collectionId: number
  order: number
  playbackOrder: string
  mode: string
  count: number
  collection: { id: number; name: string; defaultOrder: string }
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
  generated?: boolean // built from a Filler definition rather than uploaded
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
  comingUp: string | null // JSON ComingUpConfig; null = inherit channel
  collection: { id: number; name: string; defaultOrder: string }
}

// What a time block accepts on write. Omitted fields keep the schema default on
// create, and are left untouched on update.
export type BlockInput = {
  collectionId: number
  days: string
  startMinute: number
  endMinute: number
  playbackOrder: string
  logoUrl?: string | null
  logoId?: number | null
  fillerMode?: string
  startMode?: string
  comingUp?: ComingUpConfig | null
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
  comingUp: string | null // JSON ComingUpConfig; null = off
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
  hwaccel: 'auto' | 'nvidia' | 'qsv' | 'vaapi' | 'amf' | 'videotoolbox' | 'cpu'
  audioBitrate: number
  preset: string
  videoBitrateK: number
  videoBufferK: number
  scalingMode: 'pad' | 'stretch' | 'crop'
  deinterlace: boolean
  threads: number
  audioChannels: number
  normalizeLoudness: boolean
  burnSubtitles: boolean
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
    artist?: string | null
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
  session?: string // which viewer stream this line belongs to, e.g. "V3 Plex"
}
export type LogsResponse = { entries: LogEntry[]; lastId: number; total: number }

// Resource sampling. `cpuPct` is percent of ONE core, so it can exceed 100 on a
// multi-core box; divide by `cores` for a whole-machine figure. Any field may
// be -1, meaning "not measurable here" (see `source`).
export type MetricSource = 'cgroup2' | 'cgroup1' | 'process' | 'none'
export type MetricSample = {
  ts: number
  cpuPct: number
  memBytes: number
  memLimitBytes: number
  ffmpegCount: number
}
export type MetricMarker = {
  id: number
  ts: number
  channel: number
  kind: 'program' | 'filler' | 'song'
  label: string
  detail?: string
}
export type MetricsResponse = {
  source: MetricSource
  cores: number
  sampleMs: number
  samples: MetricSample[]
  markers: MetricMarker[]
}

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

  // --- airings (broadcast episodes / multi-part grouping) ---
  airings: (libraryId: number, show: string) =>
    request<{ airings: Airing[] }>(
      `/api/airings?libraryId=${libraryId}&show=${encodeURIComponent(show)}`,
    ),
  // Episodes across the whole library, for inserting a segment from another show.
  searchAiringEpisodes: (libraryId: number, q: string) =>
    request<{ episodes: AiringSegmentInfo[] }>(
      `/api/airings/search-episodes?libraryId=${libraryId}&q=${encodeURIComponent(q)}`,
    ),
  // Propose groupings for one season by packing episodes up to targetSec. null
  // season = the "unsorted" bucket (sent as -1).
  suggestAirings: (libraryId: number, show: string, season: number | null, targetSec: number) =>
    request<{ blocks: number[][] }>(
      `/api/airings/suggest?libraryId=${libraryId}&show=${encodeURIComponent(show)}` +
        `&season=${season ?? -1}&targetSec=${targetSec}`,
    ),
  // Replace one season's airings. `groups` are ordered id lists; only 2+ are kept.
  saveAirings: (data: {
    libraryId: number
    showTitle: string
    season: number | null
    groups: number[][]
  }) =>
    request<{ airings: Airing[] }>('/api/airings', {
      method: 'PUT',
      body: JSON.stringify({ ...data, season: data.season ?? -1 }),
    }),
  deleteAiring: (id: number) => request<void>(`/api/airings/${id}`, { method: 'DELETE' }),
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
  saveStreamMode: (mode: StreamMode) =>
    request<{ ok: boolean; streamMode: StreamMode }>('/api/settings/stream-mode', { method: 'POST', body: JSON.stringify({ mode }) }),
  saveTunerCount: (tunerCount: number) =>
    request<{ ok: boolean; tunerCount: number }>('/api/settings/tuner-count', { method: 'POST', body: JSON.stringify({ tunerCount }) }),
  saveTunerName: (friendlyName: string) =>
    request<{ ok: boolean; hdhrFriendlyName: string }>('/api/settings/tuner-name', { method: 'POST', body: JSON.stringify({ friendlyName }) }),

  // --- collections ---
  collections: (channelId?: number) =>
    request<Collection[]>(`/api/collections${channelId != null ? `?channelId=${channelId}` : ''}`),
  addCollection: (data: {
    name: string
    channelId?: number | null
    logoId?: number | null
    libraryId?: number | null
    defaultOrder?: string
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
      defaultOrder?: string
      filterType?: string | null
      filterSearch?: string | null
      filterGenre?: string | null
    },
  ) => request<Collection>(`/api/collections/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  collectionPreview: (id: number, order = 'chronological') =>
    request<{ count: number; order: string; sample: MediaItem[] }>(
      `/api/collections/${id}/preview?order=${encodeURIComponent(order)}`,
    ),
  searchMedia: (q: string) =>
    request<{ results: MediaSearchResult[] }>(`/api/collections/search?q=${encodeURIComponent(q)}`),
  addCollectionItem: (
    collectionId: number,
    member:
      | { kind: 'show'; showTitle: string; libraryId: number; label: string }
      | { kind: 'season'; showTitle: string; libraryId: number; season: number; label: string }
      | { kind: 'episode'; mediaItemId: number; label: string }
      | { kind: 'movie'; mediaItemId: number; label: string },
  ) =>
    request<CollectionItem>(`/api/collections/${collectionId}/items`, {
      method: 'POST',
      body: JSON.stringify(member),
    }),
  deleteCollectionItem: (collectionId: number, itemId: number) =>
    request<void>(`/api/collections/${collectionId}/items/${itemId}`, { method: 'DELETE' }),
  // `ids` = the members in their new order; drives the "hand-picked" playback order.
  reorderCollectionItems: (collectionId: number, ids: number[]) =>
    request<CollectionItem[]>(`/api/collections/${collectionId}/items/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ ids }),
    }),
  // The global filler library (created & generated under Media).
  fillers: () => request<Filler[]>('/api/fillers'),
  addFiller: (data: FillerInput) =>
    request<Filler>('/api/fillers', { method: 'POST', body: JSON.stringify(data) }),
  updateFiller: (id: number, data: FillerInput) =>
    request<Filler>(`/api/fillers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  // Deleting a custom filler also deletes the clip it was created with, unless
  // another filler shares it or `keepSource` is set.
  deleteFiller: (id: number, keepSource = false) =>
    request<void>(`/api/fillers/${id}${keepSource ? '?keepSource=1' : ''}`, { method: 'DELETE' }),
  // `owner` brands the generated preview with that channel's/block's logo — the
  // same filler renders differently everywhere it's assigned.
  generateFillerClip: (id: number, owner?: FillerOwner) => {
    const qs = owner?.channelId != null ? `?channelId=${owner.channelId}` : owner?.timeBlockId != null ? `?timeBlockId=${owner.timeBlockId}` : ''
    return request<{ started: boolean }>(`/api/fillers/${id}/generate${qs}`, { method: 'POST' })
  },
  fillerGenStatus: (id: number) => request<FillerGenStatus>(`/api/fillers/${id}/generate/status`),
  // Every generation the server is running or recently finished — lets a page
  // that wasn't open for the whole build resume showing its progress.
  fillerGenJobs: () => request<FillerGenJob[]>('/api/fillers/generating'),
  // Assigning library fillers to a channel (default gap filler) or a block.
  fillerAssignments: (owner: FillerOwner) => {
    const qs = owner.channelId != null ? `channelId=${owner.channelId}` : `timeBlockId=${owner.timeBlockId}`
    return request<number[]>(`/api/fillers/assignments?${qs}`)
  },
  assignFiller: (owner: FillerOwner, fillerId: number) =>
    request<{ ok: boolean }>('/api/fillers/assignments', { method: 'POST', body: JSON.stringify({ ...owner, fillerId }) }),
  unassignFiller: (owner: FillerOwner, fillerId: number) =>
    request<void>('/api/fillers/assignments', { method: 'DELETE', body: JSON.stringify({ ...owner, fillerId }) }),

  // --- channels ---
  channels: () => request<Channel[]>('/api/channels'),
  addChannel: (data: { number?: number | null; name: string; group?: string | null; logoId?: number | null }) =>
    request<Channel>('/api/channels', { method: 'POST', body: JSON.stringify(data) }),
  channel: (id: number) => request<ChannelDetail>(`/api/channels/${id}`),
  updateChannel: (id: number, data: { number?: number | null; name?: string; group?: string | null; logoUrl?: string | null; logoId?: number | null; profileId?: number | null; comingUp?: ComingUpConfig | null }) =>
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
  addBlock: (channelId: number, data: BlockInput) =>
    request<TimeBlock>(`/api/channels/${channelId}/blocks`, { method: 'POST', body: JSON.stringify(data) }),
  // PATCH is field-by-field on the server, so a caller may send just the one
  // field it owns (the Fillers tab patches fillerMode alone).
  updateBlock: (channelId: number, blockId: number, data: Partial<BlockInput>) =>
    request<TimeBlock>(`/api/channels/${channelId}/blocks/${blockId}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteBlock: (channelId: number, blockId: number) =>
    request<void>(`/api/channels/${channelId}/blocks/${blockId}`, { method: 'DELETE' }),
  buildPlayout: (channelId: number, hours = 48) =>
    request<{ built: number }>(`/api/channels/${channelId}/build?hours=${hours}`, { method: 'POST' }),
  resetPlayout: (channelId: number, hard = false) =>
    request<{ ok: boolean }>(`/api/channels/${channelId}/reset${hard ? '?hard=1' : ''}`, { method: 'POST' }),
  playout: (channelId: number, hours = 24) =>
    request<Playout>(`/api/channels/${channelId}/playout?hours=${hours}`),

  // --- logs ---
  logs: (params: { level?: LogLevel; category?: LogCategory; limit?: number; debug?: boolean } = {}) => {
    const qs = new URLSearchParams()
    if (params.level) qs.set('level', params.level)
    if (params.category) qs.set('category', params.category)
    if (params.limit) qs.set('limit', String(params.limit))
    if (params.debug) qs.set('debug', '1')
    const q = qs.toString()
    return request<LogsResponse>(`/api/logs${q ? `?${q}` : ''}`)
  },
  clearLogs: () => request<void>('/api/logs', { method: 'DELETE' }),

  // --- metrics ---
  metrics: (minutes?: number) =>
    request<MetricsResponse>(`/api/metrics${minutes ? `?minutes=${minutes}` : ''}`),

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

// Build a TMDB CDN image URL from a stored path like "/abc.jpg".
export function tmdbImage(path: string, size: 'w200' | 'w342' | 'w500' | 'original' = 'w342'): string {
  return `https://image.tmdb.org/t/p/${size}${path}`
}

// URL for a local artwork file, or null if the item has none of that type.
export function artworkUrl(
  id: number,
  type: 'poster' | 'show' | 'season',
): string {
  return `/api/artwork/${id}?type=${type}`
}
