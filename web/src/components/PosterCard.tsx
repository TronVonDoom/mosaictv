import { useState } from 'react'
import { posterGradient } from '../lib/format'
import Icon, { type IconName } from './Icon'

/** "The Big Bang Theory" -> "BB", "Firefly" -> "FI". */
function initials(title: string): string {
  const words = title
    .replace(/^(the|a|an)\s+/i, '')
    .split(/\s+/)
    .filter(Boolean)
  const a = words[0]?.[0] ?? title[0] ?? '?'
  const b = words[1]?.[0] ?? ''
  return (a + b).toUpperCase()
}

export default function PosterCard({
  title,
  subtitle,
  badge,
  icon,
  imageUrl,
  onClick,
}: {
  title: string
  subtitle?: string
  badge?: string
  icon: IconName
  imageUrl?: string
  onClick: () => void
}) {
  const [imgError, setImgError] = useState(false)
  const showImage = imageUrl && !imgError

  return (
    <button onClick={onClick} className="group text-left w-full">
      <div
        className="aspect-[2/3] rounded-lg overflow-hidden relative shadow-lg flex items-center justify-center"
        style={{ background: posterGradient(title) }}
      >
        {showImage ? (
          <img
            src={imageUrl}
            alt={title}
            loading="lazy"
            onError={() => setImgError(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <span className="text-3xl font-bold text-white/85 drop-shadow select-none">
            {initials(title)}
          </span>
        )}
        <span className="absolute top-2 left-2 bg-black/40 backdrop-blur rounded px-1 py-1 leading-none">
          <Icon name={icon} size={14} colored />
        </span>
        {badge && (
          <span className="absolute top-2 right-2 text-[10px] font-medium bg-black/50 backdrop-blur px-1.5 py-0.5 rounded text-slate-100">
            {badge}
          </span>
        )}
        <div className="absolute inset-0 rounded-lg ring-1 ring-white/10 group-hover:ring-2 group-hover:ring-indigo-400/70 transition-all" />
      </div>
      <div className="mt-1.5">
        <div className="text-sm text-slate-200 truncate group-hover:text-indigo-300 transition-colors">
          {title}
        </div>
        {subtitle && <div className="text-xs text-slate-500 truncate">{subtitle}</div>}
      </div>
    </button>
  )
}
