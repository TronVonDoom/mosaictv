import { useEffect, useRef, useState } from 'react'
import mpegts from 'mpegts.js'
import { Modal } from './ui'

type Props = {
  number: number
  name: string
  nowPlaying?: string | null
  onClose: () => void
}

// How long playback may sit without its currentTime advancing before we give up
// on the current connection and reconnect. Kept above the server's own stall
// recovery (it force-kills and restarts a wedged encoder at ~20s, resuming on
// the same response) so we only act when that self-heal did NOT bring the stream
// back — a truly dead response, not a blip the server is already handling.
const STALL_RECONNECT_SEC = 30
// A reconnect spawns a fresh server-side viewer, so cap the churn: after this
// many failed attempts, surface a real error instead of looping forever.
const MAX_RECONNECTS = 6

// The channel endpoint serves raw MPEG-TS, which no browser plays natively —
// mpegts.js demuxes it to fMP4 and feeds it through Media Source Extensions.
// Previewing opens a real tune-in: the server spawns an ffmpeg for us and we
// count as a viewer until the player is torn down.
export default function ChannelPreview({ number, name, nowPlaying, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attemptsRef = useRef(0)
  // Last time currentTime was seen to advance — the basis for the stall check.
  const progressRef = useRef({ t: 0, at: Date.now() })
  const [error, setError] = useState<string | null>(null)
  const [mutedFallback, setMutedFallback] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const url = `${window.location.origin}/iptv/channel/${number}.ts`

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (!mpegts.getFeatureList().mseLivePlayback) {
      setError('This browser cannot play MPEG-TS (no Media Source Extensions). Try the stream URL in VLC.')
      return
    }

    const teardown = () => {
      const player = playerRef.current
      playerRef.current = null
      if (!player) return
      try {
        // Tearing the player down closes the HTTP response, which is what tells
        // the server to kill this client's ffmpeg.
        player.pause()
        player.unload()
        player.detachMediaElement()
        player.destroy()
      } catch {
        // already gone
      }
    }

    // Rebuild the connection from scratch. Each reconnect is a new tune-in (a
    // fresh server viewer), the same thing a manual close-and-reopen would do.
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

    const connect = () => {
      const player = mpegts.createPlayer(
        { type: 'mpegts', isLive: true, url },
        {
          // Live tuning: don't sit on a stash buffer, and drift back toward the
          // live edge if we fall behind.
          enableStashBuffer: false,
          liveBufferLatencyChasing: true,
          lazyLoad: false,
        },
      )
      playerRef.current = player

      player.on(mpegts.Events.ERROR, (type: string, detail: string) => {
        // Don't surface the error straight away — a dropped connection is exactly
        // what a reconnect is for. Only the attempt cap turns it into a message.
        reconnect(type === mpegts.ErrorTypes.NETWORK_ERROR ? 'network dropped' : detail || type)
      })

      player.attachMediaElement(video)
      player.load()
      progressRef.current = { t: video.currentTime || 0, at: Date.now() }

      // The click that opened this counts as a user gesture, so unmuted autoplay
      // is usually allowed — but fall back to muted rather than not playing.
      video.play().catch(() => {
        video.muted = true
        setMutedFallback(true)
        video.play().catch(() => setError('Autoplay was blocked — press play on the video.'))
      })
    }

    // Watch that playback actually progresses. A live stream whose currentTime
    // stops advancing (while not paused or ended) is frozen; give the server's
    // own recovery a wide margin, then reconnect if it never came back.
    const watchdog = setInterval(() => {
      if (reconnectTimerRef.current || !playerRef.current) return
      if (video.paused || video.ended) {
        progressRef.current.at = Date.now() // user paused / not playing — not a stall
        return
      }
      if (video.currentTime > progressRef.current.t + 0.25) {
        progressRef.current = { t: video.currentTime, at: Date.now() }
        attemptsRef.current = 0 // healthy again — clear the reconnect budget
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
