import { prisma } from './db.js'

// Base URL is overridable so tests can point at a local mock server.
const BASE = process.env.TMDB_BASE_URL ?? 'https://api.themoviedb.org/3'
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p'

export async function getTmdbKey(): Promise<string | null> {
  const s = await prisma.setting.findUnique({ where: { key: 'tmdb_api_key' } })
  return s?.value || process.env.TMDB_API_KEY || null
}

export async function setTmdbKey(value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: 'tmdb_api_key' },
    create: { key: 'tmdb_api_key', value },
    update: { value },
  })
}

async function tmdbGet<T>(
  key: string,
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T | null> {
  const url = new URL(BASE + path)
  url.searchParams.set('api_key', key)
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v))
  }
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

type SearchResult = { id: number }
export type TmdbGenre = { id: number; name: string }
export type TmdbMovie = {
  id: number
  title: string
  overview?: string
  genres?: TmdbGenre[]
  vote_average?: number
  poster_path?: string | null
  backdrop_path?: string | null
  release_date?: string
  runtime?: number
}
export type TmdbTvSeason = {
  season_number: number
  poster_path?: string | null
  overview?: string
}
export type TmdbTv = {
  id: number
  name: string
  overview?: string
  genres?: TmdbGenre[]
  vote_average?: number
  poster_path?: string | null
  backdrop_path?: string | null
  first_air_date?: string
  seasons?: TmdbTvSeason[]
}

/** True if the key is accepted by TMDB. */
export async function validateKey(key: string): Promise<boolean> {
  const r = await tmdbGet<{ images?: unknown }>(key, '/configuration')
  return r != null
}

export async function searchMovie(key: string, title: string, year: number | null): Promise<number | null> {
  const search = (params: Record<string, string | number | undefined>) =>
    tmdbGet<{ results: SearchResult[] }>(key, '/search/movie', { query: title, include_adult: 'false', ...params })
  // TMDB's `year` matches ANY release that year, re-releases included, so a
  // remake searched with its own year can come back as the original — the 2010
  // "A Nightmare on Elm Street" matched the 1984 film. `primary_release_year`
  // is the film's first release only. Fall back to the looser match when a
  // file's year is off by a festival premiere or a regional release.
  if (year != null) {
    const primary = await search({ primary_release_year: year })
    if (primary?.results?.length) return primary.results[0].id
  }
  const r = await search({ year: year ?? undefined })
  return r?.results?.[0]?.id ?? null
}

export async function getMovie(key: string, id: number): Promise<TmdbMovie | null> {
  return tmdbGet<TmdbMovie>(key, `/movie/${id}`)
}

export async function searchTv(key: string, title: string, year: number | null): Promise<number | null> {
  const r = await tmdbGet<{ results: SearchResult[] }>(key, '/search/tv', {
    query: title,
    first_air_date_year: year ?? undefined,
  })
  return r?.results?.[0]?.id ?? null
}

export async function getTv(key: string, id: number): Promise<TmdbTv | null> {
  return tmdbGet<TmdbTv>(key, `/tv/${id}`)
}

export function genresToString(genres?: TmdbGenre[]): string | null {
  if (!genres || genres.length === 0) return null
  return genres.map((g) => g.name).join(', ')
}
