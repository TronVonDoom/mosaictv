import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { Modal } from './ui'

type Props = {
  number: number
  name: string
  nowPlaying?: string | null
  onClose: () => void
}

// How long playback may sit without its currentTime advancing before we give up
// on the current connection and rebuild it. hls.js self-heals most hiccups in
// place (see the ERROR handler), so this only fires when that recovery did NOT
// bring the stream back — a truly dead player, not a blip.
const STALL_RECONNECT_SEC = 30
// A rebuild spawns a fresh set of segment fetches, so cap the churn: after this
// many failed attempts, surface a real error instead of looping forever.
const MAX_RECONNECTS = 6

// The browser previews the channel exactly the way ErsatzTV, Jellyfin, and every
// other HLS client do: hls.js pulls the channel's live .m3u8 playlist and its
// segments over HTTP. The point of using HLS here rather than the raw MPEG-TS
// wrapper is the buffer — hls.js holds several segments back from the live edge
// and fetches ahead, which smooths over the fact that the segmenter delivers one
// ~4s segment at a time (a continuous-TS player with no buffer starves between
// segments and stutters). Opening this counts as a real viewer until it closes.
export default function ChannelPreview({ number, name, nowPlaying, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  // Last time currentTime was seen to advance — the basis for the stall check.
  const progressRef = useRef({ t: 0, at: Date.now() })
  const [error, setError] = useState<string | null>(null)
  const [mutedFallback, setMutedFallback] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const url = `${window.location.origin}/iptv/channel/${number}/index.m3u8`

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const canNativeHls = video.canPlayType('application/vnd.apple.mpegurl') !== ''
    if (!Hls.isSupported() && !canNativeHls) {
      setError('This browser cannot play HLS (no Media Source Extensions). Try the stream URL in VLC.')
      return
    }

    const teardown = () => {
      const hls = hlsRef.current
      hlsRef.current = null
      // Destroying hls.js stops all segment fetches, which is what tells the
      // server this viewer left (the shared producer reaps once idle).
      if (hls) {
        try {
          hls.destroy()
        } catch {
          // already gone
        }
      } else {
        video.removeAttribute('src')
        video.load()
      }
    }

    // Rebuild from scratch. Only used when hls.js's own recovery is exhausted —
    // a fresh manifest load jumps back to the live edge.
    const reconnect = (why: string) => {
      if (reconnectTimerRef.current) return // one already pending
      teardown()
      attemptsRef.current += 1
      if (attemptsRef.current > MAX_RECONNECTS) {
        setError(`Lost the stream and could not recover (${why}). Reopen the preview to try again.`)
        return
      }
      setReconnecting(true)
      const delay = Math.min(attemptsRef.current * 2000, 10000) // back off, capped at 10s
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null
        setReconnecting(false)
        connect()
      }, delay)
    }

    const attemptAutoplay = () => {
      // The click that opened this counts as a user gesture, so unmuted autoplay
      // is usually allowed — but fall back to muted rather than not playing.
      video.play().catch(() => {
        video.muted = true
        setMutedFallback(true)
        video.play().catch(() => setError('Autoplay was blocked — press play on the video.'))
      })
    }

    const connect = () => {
      progressRef.current = { t: 0, at: Date.now() }

      // Safari (and iOS) play HLS natively and manage their own buffer — hand the
      // playlist straight to the element and let the browser do the work.
      if (!Hls.isSupported() && canNativeHls) {
        video.src = url
        attemptAutoplay()
        return
      }

      const hls = new Hls({
        enableWorker: true,
        // Not an LL-HLS playlist (no partial segments), and low latency here would
        // just re-create the hug-the-edge starvation we're fixing. Favour a buffer.
        lowLatencyMode: false,
        // Ride ~3 segments (~12s) behind the live edge: a real cushion that absorbs
        // the segmenter's one-segment-at-a-time delivery and a program-boundary gap.
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 12,
        // Drift back toward the edge by playing slightly fast instead of a hard
        // seek, so catching up after a stall is invisible rather than a jump.
        maxLiveSyncPlaybackRate: 1.1,
        // Fetch ahead / keep behind, both bounded so a long session can't grow the
        // buffer without limit.
        maxBufferLength: 30,
        backBufferLength: 30,
      })
      hlsRef.current = hls

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal) return // non-fatal: hls.js handles it internally
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            // A playlist/segment fetch failed — including the 503 the server sends
            // while a cold producer warms up. Retries are exhausted at this point,
            // so restart the loader; count it so a genuinely dead channel still
            // trips the reconnect cap rather than spinning forever.
            attemptsRef.current += 1
            if (attemptsRef.current > MAX_RECONNECTS) {
              teardown()
              setError('Lost the stream and could not recover (network). Reopen the preview to try again.')
              return
            }
            setReconnecting(true)
            hls.startLoad()
            break
          case Hls.ErrorTypes.MEDIA_ERROR:
            // A decode hiccup (e.g. across a program discontinuity) — hls.js can
            // flush and recover in place without a full rebuild.
            hls.recoverMediaError()
            break
          default:
            reconnect(data.details || data.type)
        }
      })

      // Clear the "reconnecting" veil and the attempt budget once media is flowing.
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        setReconnecting(false)
        attemptsRef.current = 0
      })

      hls.attachMedia(video)
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url))
      hls.on(Hls.Events.MANIFEST_PARSED, attemptAutoplay)
    }

    // Watch that playback actually progresses. A live stream whose currentTime
    // stops advancing (while not paused or ended) is frozen; give hls.js's own
    // recovery a wide margin, then rebuild if it never came back.
    const watchdog = setInterval(() => {
      if (reconnectTimerRef.current) return
      if (video.paused || video.ended) {
        progressRef.current.at = Date.now() // user paused / not playing — not a stall
        return
      }
      if (video.currentTime > progressRef.current.t + 0.25) {
        progressRef.current = { t: video.currentTime, at: Date.now() }
        return
      }
      if (Date.now() - progressRef.current.at > STALL_RECONNECT_SEC * 1000) {
        reconnect('playback frozen')
      }
    }, 2000)

    connect()

    return () => {
      clearInterval(watchdog)
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      teardown()
    }
  }, [url])

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-3xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5 border-b border-edge">
          <span className="text-xs font-mono text-indigo-300 shrink-0">{number}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{name}</div>
            {nowPlaying && <div className="text-xs text-ink-faint truncate">▶ {nowPlaying}</div>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-edge-strong hover:border-ink-faint px-2.5 py-1 text-xs shrink-0"
          >
            Close
          </button>
        </div>

        <div className="bg-black aspect-video flex items-center justify-center relative">
          {error ? (
            <div className="text-center p-6">
              <div className="text-sm text-rose-300 mb-2">{error}</div>
              <code className="text-xs text-ink-faint break-all">{url}</code>
            </div>
          ) : (
            <>
              <video ref={videoRef} controls playsInline className="w-full h-full" />
              {reconnecting && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs text-ink-faint pointer-events-none">
                  Reconnecting…
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-2 text-xs text-ink-faint border-t border-edge">
          {mutedFallback
            ? 'Started muted — the browser blocked autoplay with sound. Unmute on the player.'
            : 'Live preview. This tunes in as a real viewer until you close it.'}
        </div>
    </Modal>
  )
}
