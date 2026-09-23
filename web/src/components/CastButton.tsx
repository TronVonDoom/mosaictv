import { useEffect, useRef, useState, type RefObject } from 'react'
import { castChannel, castContext, castEvents, castPrecheck, castStates, loadCast, stopCasting, type CastSupport } from '../lib/cast'
import { errorMessage } from '../lib/errors'
import { toast } from '../lib/toast'
import { Button } from './ui'

type AirPlayVideo = HTMLVideoElement & { webkitShowPlaybackTargetPicker?: () => void }

/**
 * Send the channel to a TV: Google Cast in Chrome/Edge on a secure page,
 * AirPlay in Safari. Anywhere else the button explains why it can't, and what
 * would let it.
 */
export default function CastButton({
  videoRef,
  url,
  title,
  subtitle,
  imageUrl,
  onCastingChange,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  url: string
  title: string
  subtitle?: string
  imageUrl?: string
  /** The device now playing the channel, or null when casting stops. */
  onCastingChange?: (device: string | null) => void
}) {
  const [support, setSupport] = useState<CastSupport | null>(null)
  const [castState, setCastState] = useState<string | null>(null)
  const [airplay, setAirplay] = useState(false)
  const [busy, setBusy] = useState(false)
  const [explain, setExplain] = useState(false)
  const notify = useRef(onCastingChange)
  notify.current = onCastingChange

  // Google Cast: load the SDK and follow its state.
  useEffect(() => {
    let live = true
    let off: (() => void) | undefined
    loadCast().then((s) => {
      if (!live) return
      setSupport(s)
      const ctx = castContext()
      const ev = castEvents()
      const states = castStates()
      if (!s.ok || !ctx || !ev || !states) return
      const sync = () => {
        const st = ctx.getCastState()
        setCastState(st)
        notify.current?.(st === states.CONNECTED ? (ctx.getCurrentSession()?.getCastDevice().friendlyName ?? 'your TV') : null)
      }
      sync()
      ctx.addEventListener(ev.CAST_STATE_CHANGED, sync)
      off = () => ctx.removeEventListener(ev.CAST_STATE_CHANGED, sync)
    })
    return () => {
      live = false
      off?.()
    }
  }, [])

  // AirPlay: Safari reports when an AirPlay device is in reach.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !('WebKitPlaybackTargetAvailabilityEvent' in window)) return
    const onAvail = (e: Event) => setAirplay((e as Event & { availability?: string }).availability === 'available')
    video.addEventListener('webkitplaybacktargetavailabilitychanged', onAvail)
    return () => video.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvail)
  }, [videoRef])

  const states = castStates()
  const connected = support?.ok && castState === states?.CONNECTED
  const noDevices = support?.ok && castState === states?.NO_DEVICES_AVAILABLE

  async function cast() {
    if (connected) return stopCasting()
    setBusy(true)
    try {
      const device = await castChannel({ url, title, subtitle, imageUrl })
      toast.success(`Playing on ${device}`)
    } catch (e) {
      // Closing Chrome's device picker rejects too; that's not an error.
      const msg = errorMessage(e, '')
      if (msg && !/cancel/i.test(msg)) toast.error(`Couldn't cast: ${msg}`)
    } finally {
      setBusy(false)
    }
  }

  if (airplay) {
    return (
      <Button variant="secondary" size="sm" icon="cast" onClick={() => (videoRef.current as AirPlayVideo | null)?.webkitShowPlaybackTargetPicker?.()}>
        AirPlay
      </Button>
    )
  }

  if (support?.ok) {
    return (
      <Button
        variant={connected ? 'primary' : 'secondary'}
        size="sm"
        icon="cast"
        loading={busy || castState === states?.CONNECTING}
        disabled={noDevices}
        title={noDevices ? 'No Cast devices found on your network' : undefined}
        onClick={cast}
      >
        {connected ? 'Stop casting' : 'Cast'}
      </Button>
    )
  }

  // Can't cast from here: say why.
  const reason = support && !support.ok ? support.reason : castPrecheck().ok ? null : (castPrecheck() as { reason: string }).reason
  return (
    <div className="relative">
      <Button variant="secondary" size="sm" icon="cast" onClick={() => setExplain(!explain)} aria-expanded={explain}>
        Cast
      </Button>
      {explain && (
        <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-xl border border-edge-strong bg-overlay/95 p-4 text-[12.5px] leading-relaxed text-ink-soft shadow-2xl shadow-black/60 backdrop-blur modal-in">
          {reason === 'insecure' ? (
            <>
              <p className="font-medium text-ink mb-1.5">Casting needs a secure page</p>
              <p>
                Chrome only lets a site cast when it’s opened over <b>HTTPS</b>, and MosaicTV is on plain http here. Open it
                over HTTPS — Tailscale’s <code className="font-mono text-[11.5px]">tailscale serve</code> or a reverse proxy
                both do it — and this button casts the channel. Your TV has to be able to reach that address.
              </p>
              <p className="mt-2 text-ink-faint">Meanwhile, Chrome’s own menu (⋮ → Cast…) can mirror this tab.</p>
            </>
          ) : reason === 'browser' ? (
            <>
              <p className="font-medium text-ink mb-1.5">This browser can’t cast</p>
              <p>Casting works in Chrome and Edge (to Chromecast and Google TV) and in Safari (AirPlay).</p>
            </>
          ) : (
            <>
              <p className="font-medium text-ink mb-1.5">Cast didn’t load</p>
              <p>Google’s Cast library couldn’t be fetched — it comes from gstatic.com, so this needs internet access.</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
