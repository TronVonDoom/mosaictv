import type { Request } from 'express'

// Who is watching what, so a log line can say which stream it belongs to.
//
// Every log entry raised while serving a viewer carries that viewer's tag
// ("V3 Plex"), which makes an interleaved log readable when two people are
// watching at once: the ffmpeg exit at 20:14:02 belongs to V3 in Plex, not to
// V4 in Jellyfin.
//
// The per-item endpoints are fetched by the outer ffmpeg over loopback, so the
// session id travels with them as a query parameter on the concat URL — see
// concatPlaylist in streaming/channel.ts.

export type SessionKind = 'mpegts' | 'hls'

export type Session = {
  id: number
  tag: string // short label shown in log lines
  client: string // "Plex", "Jellyfin", …
  ip: string
  channel: number
  kind: SessionKind
  startedAt: number
}

// First match wins, so the specific players come before the generic HTTP
// libraries they're often built on (Plex fetches with Lavf, for instance).
const CLIENTS: [RegExp, string][] = [
  [/plex/i, 'Plex'],
  [/jellyfin/i, 'Jellyfin'],
  [/emby/i, 'Emby'],
  [/kodi|xbmc/i, 'Kodi'],
  [/tivimate/i, 'TiviMate'],
  [/threadfin|xteve/i, 'Threadfin'],
  [/vlc/i, 'VLC'],
  [/mpv/i, 'mpv'],
  [/exoplayer|androidtv/i, 'ExoPlayer'],
  [/mozilla|chrome|safari|firefox/i, 'Browser'],
  [/lavf|ffmpeg/i, 'FFmpeg'],
]

/** Best guess at the player behind a request, from its User-Agent. */
export function clientName(req?: Request): string {
  const ua = (req?.headers['user-agent'] as string) || ''
  if (!ua) return 'unknown client'
  for (const [re, name] of CLIENTS) if (re.test(ua)) return name
  return ua.split(/[/\s]/)[0] || 'unknown client'
}

export function clientIp(req?: Request): string {
  return (
    (req?.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req?.socket?.remoteAddress ||
    'unknown'
  )
}

const sessions = new Map<number, Session>()
let nextId = 1

/** Register a viewer session (or a channel's shared HLS encoder). */
export function openSession(channel: number, kind: SessionKind, req?: Request): Session {
  const id = nextId++
  const client = kind === 'hls' ? 'shared HLS' : clientName(req)
  const s: Session = {
    id,
    tag: kind === 'hls' ? `HLS ch${channel}` : `V${id} ${client}`,
    client,
    ip: clientIp(req),
    channel,
    kind,
    startedAt: Date.now(),
  }
  sessions.set(id, s)
  return s
}

export function closeSession(id: number): void {
  sessions.delete(id)
}

export function getSession(id: number | undefined): Session | undefined {
  return id == null ? undefined : sessions.get(id)
}

/** Session tag for an id that arrived over the wire, for logging. */
export function sessionTag(id: number | undefined): string | undefined {
  return getSession(id)?.tag
}

export function activeSessions(): Session[] {
  return [...sessions.values()]
}

/** One-line roll-up of who is watching, for the periodic load heartbeat. */
export function sessionSummary(): string {
  const live = activeSessions()
  if (live.length === 0) return 'no viewers'
  const parts = live.map((s) => `${s.tag} on ch${s.channel}`)
  return `${live.length} session(s): ${parts.join(', ')}`
}
