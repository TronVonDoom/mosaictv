import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import ChannelLogo from './ChannelLogo'
import Icon from './Icon'
import { artworkUrl, type Channel, type ChannelNow, type NowUnit } from '../lib/api'
import { formatClock, formatRemaining, posterGradient } from '../lib/format'
import { Badge, LiveBadge, Menu, ProgressBar, buttonClass, cx, type MenuItem } from './ui'

/**
 * The picture behind a program: its wide TMDB backdrop when there is one,
 * else its poster twice — blurred to fill, and sharp on the right like a
 * box-art spine — else a colour of its own with the channel's logo. Every
 * layer degrades on a failed load rather than leaving a broken image.
 */
export function ProgramArt({
  unit,
  logoId,
  name,
  className,
}: {
  unit: NowUnit | null
  logoId: number | null
  name: string
  className?: string
}) {
  const [backdropFailed, setBackdropFailed] = useState(false)
  const [posterFailed, setPosterFailed] = useState(false)
  const id = unit?.mediaItemId ?? null
  const useBackdrop = id != null && unit?.hasBackdrop && !backdropFailed
  const usePoster = id != null && !useBackdrop && unit?.art && !posterFailed

  return (
    <div className={cx('absolute inset-0 overflow-hidden', className)} style={{ background: posterGradient(unit?.title ?? name) }}>
      {useBackdrop && (
        <img
          src={artworkUrl(id, 'backdrop')}
          alt=""
          loading="lazy"
          onError={() => setBackdropFailed(true)}
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
        />
      )}
      {usePoster && (
        <>
          <img
            src={artworkUrl(id, unit!.art!)}
            alt=""
            loading="lazy"
            onError={() => setPosterFailed(true)}
            className="absolute inset-0 w-full h-full object-cover blur-2xl scale-125 opacity-70"
          />
          <img
            src={artworkUrl(id, unit!.art!)}
            alt=""
            loading="lazy"
            className="absolute right-4 top-1/2 -translate-y-[58%] h-[78%] aspect-[2/3] object-cover rounded-lg shadow-[0_18px_40px_-8px_rgb(0_0_0/0.85)] ring-1 ring-white/15 transition-transform duration-500 group-hover:-translate-y-[60%]"
          />
        </>
      )}
      {!useBackdrop && !usePoster && (
        <div className="absolute inset-0 grid place-items-center opacity-90">
          <ChannelLogo logoId={logoId} name={name} size={96} plate={false} />
        </div>
      )}
      {/* Legibility for the text laid over the bottom, and a vignette. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/35 to-black/10" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent" />
    </div>
  )
}

function progressOf(unit: NowUnit | null, nowMs: number) {
  if (!unit) return { value: 0, remaining: 0 }
  const start = new Date(unit.startTime).getTime()
  const stop = new Date(unit.stopTime).getTime()
  return { value: stop > start ? (nowMs - start) / (stop - start) : 0, remaining: stop - nowMs }
}

/** "Next 8:29 PM  Misery" — one line under the progress bar. */
function UpNext({ next }: { next: NowUnit | undefined }) {
  if (!next) return <div className="text-[12.5px] text-ink-ghost">Nothing else scheduled yet</div>
  return (
    <div className="flex items-center gap-2 min-w-0 text-[12.5px]">
      <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Next</span>
      <span className="shrink-0 tabular-nums text-ink-faint">{formatClock(next.startTime)}</span>
      <span className="truncate text-ink-soft">
        {next.title}
        {next.subtitle && next.type === 'episode' && <span className="text-ink-faint"> · {next.subtitle.split(' · ')[0]}</span>}
      </span>
    </div>
  )
}

/**
 * One channel as a card: what it's airing right now over that program's art,
 * how far through it is, and what's next.
 *
 * `live` is the Dashboard's version — watching is the point, so the artwork is
 * the play button. `manage` is the Channels page's — the same face plus the
 * schedule's shape and the actions to edit or remove it.
 */
export default function ChannelCard({
  channel,
  now,
  nowMs,
  variant = 'live',
  onWatch,
  menu,
  style,
}: {
  channel: Channel
  now: ChannelNow | undefined
  nowMs: number
  variant?: 'live' | 'manage'
  onWatch?: () => void
  menu?: MenuItem[]
  style?: React.CSSProperties
}) {
  const draft = channel.number == null
  const unit = now?.now ?? null
  const { value, remaining } = progressOf(unit, nowMs)
  const scheduled = channel.rotationCount + channel.blockCount > 0
  const canWatch = !draft && !!onWatch

  let status: ReactNode
  if (draft) status = <Badge tone="neutral">Draft</Badge>
  else if (unit) status = <LiveBadge />
  else status = <Badge tone="warn" dot>Off air</Badge>

  return (
    <article
      style={style}
      className={cx(
        'group relative flex flex-col overflow-hidden rounded-2xl border surface-card card-interactive rise-in',
        draft ? 'border-dashed border-edge-strong' : 'border-edge',
      )}
    >
      {/* Artwork + what's on */}
      <div className="relative aspect-[16/9] overflow-hidden">
        <ProgramArt unit={draft ? null : unit} logoId={channel.logoId} name={channel.name} />

        <div className="absolute inset-x-0 top-0 p-3 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 rounded-xl bg-black/50 backdrop-blur-md ring-1 ring-white/10 pl-1 pr-2.5 py-1">
            <ChannelLogo logoId={channel.logoId} name={channel.name} size={28} plate={false} />
            <span className="font-mono text-[13px] font-semibold text-white tabular-nums">{draft ? '—' : channel.number}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {channel.viewers > 0 && (
              <span
                className="inline-flex items-center gap-1 rounded-md bg-black/55 backdrop-blur-md ring-1 ring-white/10 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums"
                title={`${channel.viewers} watching`}
              >
                <Icon name="eye" size={12} /> {channel.viewers}
              </span>
            )}
            {status}
          </div>
        </div>

        {/* Leave room on the right only when a poster sits there. */}
        <div className={cx('absolute inset-x-0 bottom-0 p-4', !draft && unit && !unit.hasBackdrop && unit.art && 'pr-[34%]')}>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/60 truncate">
            {channel.name}
            {channel.group && <span className="text-white/35"> · {channel.group}</span>}
          </div>
          {draft ? (
            <div className="mt-1 text-[15px] font-semibold text-white/85">Not on air yet</div>
          ) : unit ? (
            <>
              <h3 className="mt-0.5 text-lg font-semibold leading-tight text-white line-clamp-1 [text-shadow:0_2px_12px_rgb(0_0_0/0.6)]">
                {unit.title}
              </h3>
              {unit.subtitle && <p className="text-[13px] text-white/70 line-clamp-1 mt-0.5">{unit.subtitle}</p>}
            </>
          ) : (
            <div className="mt-1 text-[15px] font-semibold text-white/80">
              {scheduled ? 'Between programs' : 'Nothing scheduled'}
            </div>
          )}
        </div>

        {canWatch && (
          <button
            onClick={onWatch}
            aria-label={`Watch ${channel.name}`}
            className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-200"
          >
            <span className="grid place-items-center w-14 h-14 rounded-full bg-white/95 text-black shadow-[0_12px_40px_-4px_rgb(0_0_0/0.8)] scale-90 group-hover:scale-100 transition-transform duration-200">
              <Icon name="play" size={22} className="translate-x-0.5 fill-current" />
            </span>
          </button>
        )}
      </div>

      {/* Progress + next */}
      <div className="flex flex-col gap-3 p-4 flex-1">
        {draft ? (
          <p className="text-[12.5px] text-ink-muted leading-relaxed">
            Give it a number to put it in the playlist and guide.
          </p>
        ) : unit ? (
          <div>
            <ProgressBar value={value} tone={unit.kind === 'filler' ? 'neutral' : 'live'} />
            <div className="flex justify-between mt-1.5 text-[11.5px] tabular-nums text-ink-faint">
              <span>
                {formatClock(unit.startTime)} – {formatClock(unit.stopTime)}
              </span>
              <span className="text-ink-muted">{formatRemaining(remaining)}</span>
            </div>
          </div>
        ) : null}
        {!draft && <UpNext next={now?.next[0]} />}

        {variant === 'manage' && (
          <div className="mt-auto pt-3 border-t border-edge/70 flex items-center gap-2">
            <span className="flex-1 min-w-0 truncate text-[12px] text-ink-faint">
              {scheduled ? (
                <>
                  {channel.blockCount > 0 && `${channel.blockCount} block${channel.blockCount === 1 ? '' : 's'}`}
                  {channel.blockCount > 0 && channel.rotationCount > 0 && ' · '}
                  {channel.rotationCount > 0 && `${channel.rotationCount} in rotation`}
                </>
              ) : (
                'No schedule yet'
              )}
            </span>
            {canWatch && (
              <button onClick={onWatch} className={buttonClass('ghost', 'sm', 'px-2.5')}>
                <Icon name="play" size={14} /> Watch
              </button>
            )}
            <Link to={`/channels/${channel.id}`} className={buttonClass('secondary', 'sm')}>
              <Icon name="edit" size={14} /> Edit
            </Link>
            {menu && <Menu items={menu} />}
          </div>
        )}
      </div>
    </article>
  )
}
