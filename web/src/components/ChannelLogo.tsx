import { useState } from 'react'
import { logoImageUrl } from '../lib/api'
import { posterGradient } from '../lib/format'
import { cx } from './ui'

/** "Cartoon Network" -> "CN", "Halloween" -> "HA". */
function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase()
}

/**
 * A channel's logo on a small dark plate — the one way a channel is pictured
 * across the app (cards, guide rows, the editor header). Logos are mostly
 * transparent PNGs of every shape, so they sit contained with padding rather
 * than cropped. No logo: the channel's initials on a colour of its own.
 */
export default function ChannelLogo({
  logoId,
  name,
  size = 40,
  className,
  plate = true,
}: {
  logoId: number | null
  name: string
  size?: number
  className?: string
  /** The dark plate behind the logo; off for logos laid over artwork. */
  plate?: boolean
}) {
  const [broken, setBroken] = useState(false)
  const show = logoId != null && !broken
  return (
    <span
      className={cx(
        'shrink-0 grid place-items-center overflow-hidden',
        plate && 'rounded-xl border border-edge bg-[#0b0d12] shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]',
        className,
      )}
      style={{ width: size, height: size, ...(show || !plate ? {} : { background: posterGradient(name) }) }}
    >
      {show ? (
        <img
          src={logoImageUrl(logoId)}
          alt=""
          onError={() => setBroken(true)}
          className="max-w-[78%] max-h-[78%] object-contain drop-shadow-[0_2px_6px_rgb(0_0_0/0.5)]"
        />
      ) : (
        <span className="font-semibold text-white/90 tracking-tight" style={{ fontSize: size * 0.34 }}>
          {initials(name)}
        </span>
      )}
    </span>
  )
}
