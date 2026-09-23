// Google Cast, from the channel preview. The Cast SDK is Google's and only
// loads from gstatic, so it's fetched the first time a preview opens — and only
// where it can work: Chrome/Edge, on a secure page (HTTPS or localhost). Chrome
// refuses to cast from a plain-http site.

// The slice of the SDK used here (it ships no types).
type CastContextLike = {
  setOptions(o: { receiverApplicationId: string; autoJoinPolicy: string }): void
  getCastState(): string
  getCurrentSession(): CastSessionLike | null
  requestSession(): Promise<unknown>
  endCurrentSession(stopCasting: boolean): void
  addEventListener(type: string, fn: (e: { castState?: string; sessionState?: string }) => void): void
  removeEventListener(type: string, fn: (e: { castState?: string; sessionState?: string }) => void): void
}
type CastSessionLike = {
  getCastDevice(): { friendlyName: string }
  loadMedia(req: unknown): Promise<unknown>
}
type CastGlobals = {
  cast: {
    framework: {
      CastContext: { getInstance(): CastContextLike }
      CastContextEventType: { CAST_STATE_CHANGED: string; SESSION_STATE_CHANGED: string }
      CastState: { NO_DEVICES_AVAILABLE: string; NOT_CONNECTED: string; CONNECTING: string; CONNECTED: string }
    }
  }
  chrome: {
    cast: {
      AutoJoinPolicy: { ORIGIN_SCOPED: string }
      Image: new (url: string) => unknown
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: string
        MediaInfo: new (url: string, contentType: string) => Record<string, unknown>
        GenericMediaMetadata: new () => Record<string, unknown>
        LoadRequest: new (info: unknown) => unknown
        StreamType: { LIVE: string }
        HlsSegmentFormat: { TS: string }
        HlsVideoSegmentFormat: { MPEG2_TS: string }
      }
    }
  }
}

export type CastSupport = { ok: true } | { ok: false; reason: 'insecure' | 'browser' | 'failed' }

const w = window as unknown as Window & Partial<CastGlobals> & { __onGCastApiAvailable?: (ok: boolean) => void }

/** Whether this page could cast at all, before loading anything. */
export function castPrecheck(): CastSupport {
  if (!/Chrome|CriOS/.test(navigator.userAgent)) return { ok: false, reason: 'browser' }
  if (!window.isSecureContext) return { ok: false, reason: 'insecure' }
  return { ok: true }
}

let loading: Promise<CastSupport> | null = null

/** Load and configure the Cast SDK once per page. */
export function loadCast(): Promise<CastSupport> {
  const pre = castPrecheck()
  if (!pre.ok) return Promise.resolve(pre)
  if (loading) return loading
  loading = new Promise<CastSupport>((resolve) => {
    // The SDK loaded but says no: the browser has no Cast support built in.
    const done = (ok: boolean) => {
      if (!ok || !w.cast || !w.chrome?.cast) return resolve({ ok: false, reason: 'browser' })
      w.cast.framework.CastContext.getInstance().setOptions({
        receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      })
      resolve({ ok: true })
    }
    w.__onGCastApiAvailable = done
    const s = document.createElement('script')
    s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'
    s.async = true
    s.onerror = () => resolve({ ok: false, reason: 'failed' })
    document.head.appendChild(s)
    // It normally answers at once; silence means the browser never offered Cast.
    setTimeout(() => resolve({ ok: false, reason: 'browser' }), 10_000)
  })
  return loading
}

export function castContext(): CastContextLike | null {
  return w.cast?.framework.CastContext.getInstance() ?? null
}

export const castStates = () => w.cast?.framework.CastState
export const castEvents = () => w.cast?.framework.CastContextEventType

/** Ask for a device (Chrome's picker), then play the channel on it. Returns the device's name. */
export async function castChannel(o: { url: string; title: string; subtitle?: string; imageUrl?: string }): Promise<string> {
  const ctx = castContext()
  const c = w.chrome?.cast
  if (!ctx || !c) throw new Error('Cast is not available')
  if (!ctx.getCurrentSession()) await ctx.requestSession()
  const session = ctx.getCurrentSession()
  if (!session) throw new Error('No Cast device was chosen')

  const info = new c.media.MediaInfo(o.url, 'application/x-mpegurl')
  info.streamType = c.media.StreamType.LIVE
  // The segmenter writes MPEG-TS segments.
  info.hlsSegmentFormat = c.media.HlsSegmentFormat.TS
  info.hlsVideoSegmentFormat = c.media.HlsVideoSegmentFormat.MPEG2_TS
  const meta = new c.media.GenericMediaMetadata()
  meta.title = o.title
  if (o.subtitle) meta.subtitle = o.subtitle
  if (o.imageUrl) meta.images = [new c.Image(o.imageUrl)]
  info.metadata = meta
  await session.loadMedia(new c.media.LoadRequest(info))
  return session.getCastDevice().friendlyName
}

export function stopCasting(): void {
  castContext()?.endCurrentSession(true)
}
