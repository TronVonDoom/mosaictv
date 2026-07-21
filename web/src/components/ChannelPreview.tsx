import { useEffect, useRef, useState } from 'react'
import mpegts from 'mpegts.js'
import { Modal } from './ui'

type Props = {
  number: number
  name: string
  nowPlaying?: string | null
  onClose: () => void
}

// The channel endpoint serves raw MPEG-TS, which no browser plays natively —
// mpegts.js demuxes it to fMP4 and feeds it through Media Source Extensions.
// Previewing opens a real tune-in: the server spawns an ffmpeg for us and we
// count as a viewer until the player is torn down.
export default function ChannelPreview({ number, name, nowPlaying, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [mutedFallback, setMutedFallback] = useState(false)
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

    player.on(mpegts.Events.ERROR, (type: string, detail: string) => {
      setError(
        type === mpegts.ErrorTypes.NETWORK_ERROR
          ? 'Could not reach the stream. The channel may have nothing scheduled yet.'
          : `Playback error: ${detail || type}`,
      )
    })

    player.attachMediaElement(video)
    player.load()

    // The click that opened this counts as a user gesture, so unmuted autoplay
    // is usually allowed — but fall back to muted rather than not playing.
    video.play().catch(() => {
      video.muted = true
      setMutedFallback(true)
      video.play().catch(() => setError('Autoplay was blocked — press play on the video.'))
    })

    return () => {
      // Tearing the player down closes the HTTP response, which is what tells
      // the server to kill this client's ffmpeg.
      try {
        player.pause()
        player.unload()
        player.detachMediaElement()
        player.destroy()
      } catch {
        // already gone
      }
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

        <div className="bg-black aspect-video flex items-center justify-center">
          {error ? (
            <div className="text-center p-6">
              <div className="text-sm text-rose-300 mb-2">{error}</div>
              <code className="text-xs text-ink-faint break-all">{url}</code>
            </div>
          ) : (
            <video ref={videoRef} controls playsInline className="w-full h-full" />
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
