// Shared UI primitives. These are the surfaces and controls the app actually
// uses, in one place, so a padding or hover colour is defined once rather than
// copy-pasted into every page (which is how the sizes and disabled-state
// opacities drifted apart in the first place).
//
// Every primitive takes `className`, appended last so a caller can add layout
// (flex, margins, width) without forking the base style.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentPropsWithRef,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import Icon, { iconColor, type IconName } from './Icon'

/** Join class names, dropping falsy ones. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// ---- Surfaces ---------------------------------------------------------------

/** The panel surface every card, form, and list container is built from. */
const CARD_SURFACE = 'rounded-2xl border border-edge surface-card'

/** The card surface on its own, for elements that can't be a <Card> — e.g. a
 *  react-router <Link> that should look like one. */
export function cardClass(extra?: string): string {
  return cx(CARD_SURFACE, extra)
}

/** The standard panel surface: every card, form, and list container. */
export function Card({
  interactive = false,
  className,
  children,
  ...rest
}: {
  /** Adds the hover lift. Only for cards that are themselves a link or button —
   *  a static panel that rises under the cursor reads as broken. */
  interactive?: boolean
  className?: string
  children: ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx(CARD_SURFACE, interactive && 'card-interactive', className ?? 'p-5')} {...rest}>
      {children}
    </div>
  )
}

/** A card's titled top row: heading, optional one-liner, and actions. */
export function CardHeader({
  title,
  description,
  icon,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: IconName
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex items-start gap-3 mb-4', className)}>
      {icon && <IconTile name={icon} size="sm" />}
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold text-[15px] leading-tight tracking-tight text-ink">{title}</h2>
        {description && <p className="text-[13px] text-ink-muted mt-1 leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

/** An icon on a softly tinted tile, in the icon's identity hue. */
export function IconTile({
  name,
  size = 'md',
  color: override,
  className,
}: {
  name: IconName
  size?: 'sm' | 'md' | 'lg'
  /** Tint with this colour instead of the icon's own. */
  color?: string
  className?: string
}) {
  const color = override ?? iconColor(name)
  const dims = { sm: 'w-8 h-8 rounded-lg', md: 'w-10 h-10 rounded-xl', lg: 'w-14 h-14 rounded-2xl' }[size]
  const glyph = { sm: 16, md: 20, lg: 26 }[size]
  return (
    <span
      className={cx('shrink-0 grid place-items-center border', dims, className)}
      style={{
        color,
        background: `linear-gradient(160deg, color-mix(in oklab, ${color} 22%, transparent), color-mix(in oklab, ${color} 6%, transparent))`,
        borderColor: `color-mix(in oklab, ${color} 28%, transparent)`,
      }}
    >
      <Icon name={name} size={glyph} />
    </span>
  )
}

/** Small pill used for counts, kinds, and status ("configured", "12 items"). */
export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
  ...rest
}: {
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent' | 'live' | 'info'
  /** A leading status dot in the tone's colour. */
  dot?: boolean
  className?: string
  children: ReactNode
} & React.HTMLAttributes<HTMLSpanElement>) {
  const tones = {
    neutral: 'bg-raised text-ink-muted ring-edge-strong/70',
    good: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/25',
    warn: 'bg-amber-500/10 text-amber-300 ring-amber-500/25',
    bad: 'bg-rose-500/10 text-rose-300 ring-rose-500/25',
    accent: 'bg-indigo-500/12 text-indigo-200 ring-indigo-500/30',
    live: 'bg-live/12 text-[#ff8a96] ring-live/35',
    info: 'bg-sky-500/10 text-sky-300 ring-sky-500/25',
  }
  const dots = {
    neutral: 'bg-ink-faint',
    good: 'bg-emerald-400',
    warn: 'bg-amber-400',
    bad: 'bg-rose-400',
    accent: 'bg-indigo-400',
    live: 'bg-live',
    info: 'bg-sky-400',
  }
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset',
        tones[tone],
        className,
      )}
      {...rest}
    >
      {dot && <span className={cx('w-1.5 h-1.5 rounded-full', dots[tone])} />}
      {children}
    </span>
  )
}

/** The red on-air tally: "● LIVE", with the dot breathing. */
export function LiveBadge({ label = 'Live', className }: { label?: string; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md bg-live px-1.5 py-0.5 text-[10px] font-bold uppercase leading-4 tracking-wider text-white shadow-[0_0_16px_-2px_rgb(255_59_79/0.65)]',
        className,
      )}
    >
      <span className="relative flex w-1.5 h-1.5">
        <span className="pulse-live absolute inset-0 rounded-full bg-white/80" />
        <span className="relative w-1.5 h-1.5 rounded-full bg-white" />
      </span>
      {label}
    </span>
  )
}

/** A thin progress bar. `value` is 0–1. */
export function ProgressBar({
  value,
  tone = 'brand',
  className,
}: {
  value: number
  tone?: 'brand' | 'live' | 'rainbow' | 'neutral'
  className?: string
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100
  const fills = {
    brand: 'bg-gradient-to-r from-indigo-500 to-sky-400',
    live: 'bg-gradient-to-r from-live to-[#ff7a59]',
    rainbow: 'bg-gradient-brand',
    neutral: 'bg-ink-muted',
  }
  return (
    <div className={cx('h-1 rounded-full bg-white/[0.07] overflow-hidden', className)}>
      <div
        className={cx('h-full rounded-full transition-[width] duration-700 ease-out', fills[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ---- Buttons ----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'subtle' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium select-none ' +
  'transition-[color,background-color,border-color,box-shadow,opacity] duration-150 ' +
  'disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'text-white bg-gradient-to-b from-indigo-500 to-indigo-600 hover:from-indigo-400 hover:to-indigo-500 glow-brand',
  secondary:
    'border border-edge-strong bg-raised/70 text-ink-soft hover:text-ink hover:bg-raised hover:border-ink-ghost ' +
    'shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]',
  danger: 'border border-rose-500/35 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 hover:border-rose-500/55',
  // For destructive/secondary actions that shouldn't draw the eye until hovered.
  subtle: 'border border-edge text-ink-faint hover:border-rose-500/45 hover:text-rose-300 hover:bg-rose-500/5',
  ghost: 'text-ink-muted hover:text-ink hover:bg-white/[0.06]',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-10 px-4.5 text-sm',
}

/**
 * The button classes on their own, for elements that can't be a <Button> —
 * chiefly react-router's <Link>, which must render its own anchor.
 */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string): string {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], extra)
}

type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** A leading icon. */
  icon?: IconName
  /** A trailing icon — for "next step" and disclosure buttons. */
  iconRight?: IconName
  /** Swaps the leading icon for a spinner and blocks clicks. */
  loading?: boolean
} & ComponentPropsWithRef<'button'>

export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const glyph = size === 'sm' ? 15 : 16
  return (
    <button className={buttonClass(variant, size, className)} disabled={disabled || loading} {...rest}>
      {loading ? (
        <LoaderCircle size={glyph} className="animate-spin" aria-hidden="true" />
      ) : (
        icon && <Icon name={icon} size={glyph} />
      )}
      {children}
      {iconRight && <Icon name={iconRight} size={glyph} className="-mr-0.5 opacity-80" />}
    </button>
  )
}

/** A square, icon-only button. `label` is required: it's the tooltip and the
 *  accessible name, since there's no visible text. */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  className,
  ...rest
}: {
  icon: IconName
  label: string
  variant?: ButtonVariant
  size?: ButtonSize
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>) {
  const dims = { sm: 'w-8 px-0', md: 'w-9 px-0', lg: 'w-10 px-0' }[size]
  return (
    <button
      title={label}
      aria-label={label}
      className={buttonClass(variant, size, cx(dims, className))}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 15 : 17} />
    </button>
  )
}

/** An <a> styled as a button — for downloads and external links. */
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: { variant?: ButtonVariant; size?: ButtonSize; icon?: IconName } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={buttonClass(variant, size, className)} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 16} />}
      {children}
    </a>
  )
}

/** A keyboard key, for shortcut hints. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex items-center rounded-md border border-edge-strong bg-raised/80 px-1.5 font-sans text-[10.5px] font-medium leading-5 text-ink-muted shadow-[inset_0_-1px_0_rgb(0_0_0/0.4)]',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

// ---- Form controls ----------------------------------------------------------

const CONTROL_BASE =
  'h-9 rounded-lg bg-sunken border border-edge-strong px-3 text-sm text-ink placeholder:text-ink-ghost ' +
  'outline-none transition-[border-color,box-shadow] duration-150 ' +
  'hover:border-ink-ghost focus:border-indigo-500 focus:ring-3 focus:ring-indigo-500/20 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed'

// `ComponentPropsWithRef` rather than `InputHTMLAttributes` so callers can pass
// a `ref` (React 19 forwards it as an ordinary prop, but the attribute types
// don't include it).
export function Input({ className, ...rest }: ComponentPropsWithRef<'input'>) {
  return <input className={cx(CONTROL_BASE, className)} {...rest} />
}

// The native arrow is replaced with our own chevron so selects match inputs.
const SELECT_CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238f96a8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")"

export function Select({ className, children, style, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(CONTROL_BASE, 'appearance-none pr-8 bg-no-repeat cursor-pointer', className)}
      style={{ backgroundImage: SELECT_CHEVRON, backgroundPosition: 'right 0.55rem center', ...style }}
      {...rest}
    >
      {children}
    </select>
  )
}

/** A labelled control: the label text above whatever you pass as children. */
export function Field({
  label,
  hint,
  className,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <label className={cx('flex flex-col gap-1.5 text-sm', className)}>
      <span className="text-[12.5px] font-medium text-ink-soft">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-faint leading-snug">{hint}</span>}
    </label>
  )
}

/** A titled group of fields inside a form panel. */
export function Section({
  title,
  className,
  children,
}: {
  title: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cx('rounded-xl border border-edge bg-sunken/60 p-4', className)}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint mb-3">{title}</div>
      {children}
    </div>
  )
}

/** A pill-shaped choice between a few options — view modes, filters. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
}: {
  options: readonly { value: T; label: ReactNode; icon?: IconName; title?: string }[]
  value: T
  onChange: (v: T) => void
  size?: 'sm' | 'md'
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      className={cx('inline-flex items-center gap-0.5 rounded-lg border border-edge bg-sunken p-0.5', className)}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
              on
                ? 'bg-raised text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.06),0_1px_2px_rgb(0_0_0/0.4)]'
                : 'text-ink-muted hover:text-ink-soft',
            )}
          >
            {o.icon && <Icon name={o.icon} size={14} />}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

// ---- Feedback ---------------------------------------------------------------

/**
 * An inline message attached to a specific form or panel. Use this only for
 * state the user needs to keep seeing (a validation error blocking a submit, a
 * standing warning). Transient "it worked" confirmations belong in a toast —
 * see lib/toast.ts.
 */
export function Banner({
  tone = 'error',
  className,
  children,
}: {
  tone?: 'error' | 'success' | 'warn' | 'info' | 'accent'
  className?: string
  children: ReactNode
}) {
  const tones = {
    error: { box: 'border-rose-500/35 bg-rose-500/[0.07] text-rose-200', icon: 'warning' as const, ic: 'text-rose-400' },
    success: { box: 'border-emerald-500/35 bg-emerald-500/[0.07] text-emerald-200', icon: 'success' as const, ic: 'text-emerald-400' },
    warn: { box: 'border-amber-500/35 bg-amber-500/[0.07] text-amber-200', icon: 'warning' as const, ic: 'text-amber-400' },
    info: { box: 'border-edge-strong bg-raised/50 text-ink-soft', icon: 'info' as const, ic: 'text-ink-muted' },
    accent: { box: 'border-indigo-500/30 bg-indigo-500/[0.06] text-ink-soft', icon: 'sparkles' as const, ic: 'text-indigo-300' },
  }[tone]
  return (
    <div className={cx('flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm leading-relaxed', tones.box, className)}>
      <Icon name={tones.icon} size={16} className={cx('shrink-0 mt-0.5', tones.ic)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/**
 * A labelled progress bar with an optional stat line and trailing detail —
 * the shape used by the library scan and the TMDB metadata fetch.
 */
export function ProgressPanel({
  tone,
  title,
  processed,
  total,
  stats,
  detail,
  className,
}: {
  tone: 'indigo' | 'violet'
  title: ReactNode
  processed: number
  total: number
  stats?: ReactNode
  detail?: string | null
  className?: string
}) {
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0
  const tones = {
    indigo: { edge: 'border-indigo-500/30 bg-indigo-500/[0.06]', text: 'text-indigo-200' },
    violet: { edge: 'border-fuchsia-500/25 bg-fuchsia-500/[0.05]', text: 'text-fuchsia-200' },
  }[tone]
  return (
    <div className={cx('rounded-xl border p-4', tones.edge, className)}>
      <div className="flex justify-between items-center text-sm mb-2.5">
        <span className={cx('font-medium inline-flex items-center gap-2', tones.text)}>
          <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
          {title}
        </span>
        <span className="text-ink-muted tabular-nums text-[13px]">
          {processed.toLocaleString()} / {total.toLocaleString()} · {pct}%
        </span>
      </div>
      <ProgressBar value={pct / 100} tone="brand" className="h-1.5" />
      {stats && <div className="flex flex-wrap gap-4 text-xs text-ink-muted mt-2.5">{stats}</div>}
      {detail && <div className="text-xs text-ink-faint mt-1 truncate font-mono">{detail}</div>}
    </div>
  )
}

// ---- Page scaffolding -------------------------------------------------------

/**
 * The title block every page opens with: heading, one-line description, and an
 * optional cluster of actions pinned to the right.
 *
 * `description` should be a single plain sentence answering "what is this page
 * for" — not the operating manual. Detail belongs in an <InfoHint> next to the
 * control it explains.
 */
export function PageHeader({
  title,
  description,
  icon,
  eyebrow,
  actions,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: IconName
  /** A small line above the title — breadcrumbs, or a section name. */
  eyebrow?: ReactNode
  /** Buttons and links, right-aligned on the title row. */
  actions?: ReactNode
  /** Anything below the description — usually a <Tabs> strip. */
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('mb-7', className)}>
      {eyebrow && <div className="mb-3 text-[13px] text-ink-faint">{eyebrow}</div>}
      <div className="flex items-center gap-4 flex-wrap">
        {icon && <IconTile name={icon} size="md" className="hidden sm:grid" />}
        {/* The 16rem basis wraps the actions below the text on a phone instead
            of squeezing the description into a narrow column beside them. */}
        <div className="min-w-0 flex-[1_1_16rem]">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] leading-tight text-ink">{title}</h1>
          {description && <p className="text-ink-muted text-sm mt-1 max-w-2xl leading-relaxed">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {children && <div className="mt-6">{children}</div>}
    </div>
  )
}

/** A section heading inside a page — smaller than the page title, with room
 *  for a trailing action ("View all →"). */
export function SectionHeading({
  title,
  description,
  icon,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: IconName
  actions?: ReactNode
  className?: string
}) {
  return (
    // Wraps on a phone: the actions (often a few segmented controls) drop
    // below the title instead of running off the edge.
    <div className={cx('flex flex-wrap items-end gap-x-3 gap-y-2.5 mb-3.5', className)}>
      <div className="min-w-0 flex-[1_1_14rem]">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
          {icon && <Icon name={icon} size={16} className="text-ink-muted" />}
          {title}
        </h2>
        {description && <p className="text-[13px] text-ink-faint mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap max-w-full">{actions}</div>}
    </div>
  )
}

/** A breadcrumb trail for the page eyebrow. The last crumb is the current page. */
export function Breadcrumbs({ items }: { items: { label: ReactNode; to?: string; onClick?: () => void }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 flex-wrap text-[13px]">
      {items.map((c, i) => {
        const last = i === items.length - 1
        const cls = 'text-ink-faint hover:text-ink transition-colors'
        return (
          <span key={i} className="inline-flex items-center gap-1.5 min-w-0">
            {c.to && !last ? (
              <Link to={c.to} className={cls}>
                {c.label}
              </Link>
            ) : c.onClick && !last ? (
              <button onClick={c.onClick} className={cls}>
                {c.label}
              </button>
            ) : (
              <span className={last ? 'text-ink-soft truncate' : 'text-ink-faint'}>{c.label}</span>
            )}
            {!last && <Icon name="chevronRight" size={13} className="text-ink-ghost shrink-0" />}
          </span>
        )
      })}
    </nav>
  )
}

/**
 * What a page shows instead of an empty grid. An empty state that only says
 * "nothing here" wastes the one moment the user is definitely looking — so
 * `action` is where the next step goes, and it should almost always be set.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: IconName
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cx(
        'relative overflow-hidden rounded-2xl border border-dashed border-edge-strong bg-surface/40 bg-dots',
        'px-6 py-14 flex flex-col items-center text-center',
        className,
      )}
    >
      {icon && (
        <div className="relative mb-5">
          <div
            className="absolute inset-0 -m-6 rounded-full blur-2xl opacity-40"
            style={{ background: iconColor(icon) }}
            aria-hidden="true"
          />
          <IconTile name={icon} size="lg" className="relative" />
        </div>
      )}
      <div className="font-semibold text-ink text-[15px]">{title}</div>
      {description && <p className="text-sm text-ink-muted mt-1.5 max-w-md leading-relaxed">{description}</p>}
      {action && <div className="mt-6 flex items-center gap-2 flex-wrap justify-center">{action}</div>}
    </div>
  )
}

/**
 * A loading placeholder shaped like the thing that's coming. Prefer this over a
 * spinner: the page keeps its layout, so content doesn't jump when it lands.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-lg', className ?? 'h-4 w-full')} aria-hidden="true" />
}

/** A stack of skeleton cards, for a list or grid that hasn't loaded yet. */
export function SkeletonCards({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cx('grid gap-4', className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-24 rounded-2xl" />
      ))}
    </div>
  )
}

/**
 * The small ⓘ that carries an explanation without spending a paragraph on it.
 * This is the pressure valve for dense pages: put the one-line "what" in the
 * label and the "why / when / what happens if" in here.
 */
export function InfoHint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx('relative inline-flex group align-middle', className)}>
      <span
        tabIndex={0}
        role="button"
        aria-label="More information"
        className="grid place-items-center w-4 h-4 rounded-full text-ink-faint cursor-help transition-colors hover:text-indigo-300 focus:text-indigo-300"
      >
        <Icon name="info" size={14} />
      </span>
      <span
        role="tooltip"
        className={cx(
          // Out of layout until shown: even at opacity 0 an absolutely placed
          // tooltip near the right edge widened the page into a sideways scroll.
          'pointer-events-none absolute left-1/2 bottom-full z-40 mb-2 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2',
          'rounded-xl border border-edge-strong bg-overlay/95 backdrop-blur px-3.5 py-2.5 text-xs font-normal normal-case tracking-normal leading-relaxed text-ink-soft shadow-2xl shadow-black/60',
          'hidden group-hover:block group-focus-within:block fade-in',
        )}
      >
        {children}
      </span>
    </span>
  )
}

/**
 * A single headline number. `tone` tints the value for stats that carry a
 * verdict (missing files, errors) — leave it off for neutral counts.
 */
export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = 'neutral',
  className,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  icon?: IconName
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
  className?: string
}) {
  const valueTone = {
    neutral: 'text-ink',
    good: 'text-emerald-300',
    warn: 'text-amber-300',
    bad: 'text-rose-300',
  }[tone]
  return (
    <Card className={cx('p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-ink-muted text-[12.5px] font-medium">{label}</div>
        {icon && <IconTile name={icon} size="sm" />}
      </div>
      <div className={cx('text-[26px] font-semibold tracking-tight mt-1 tabular-nums leading-none', valueTone)}>
        {value}
      </div>
      {sub && <div className="text-ink-faint text-xs mt-2">{sub}</div>}
    </Card>
  )
}

// ---- Overlays ---------------------------------------------------------------

/**
 * A centred modal over a dimmed backdrop. Clicking the backdrop or pressing
 * Escape closes it; clicks inside the panel don't bubble out. The page behind
 * stops scrolling while it's open.
 *
 * `panelClassName` sets the panel's own width/padding/layout — the sizes vary
 * a lot between a folder picker and a video preview.
 */
export function Modal({
  onClose,
  panelClassName,
  children,
}: {
  onClose: () => void
  panelClassName?: string
  children: ReactNode
}) {
  // Held in a ref so a parent that re-creates onClose each render doesn't
  // re-bind the listener (and lose the scroll-lock state) on every keystroke.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [])

  // Portalled to <body>: a page's entry animation leaves it a stacking
  // context, and a modal rendered inside one sat beneath the sidebar and the
  // sticky top bar — which covered its title and close button.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-[3px] fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cx(
          'modal-in max-h-[calc(100vh-2rem)] overflow-auto rounded-2xl border border-edge-strong bg-surface shadow-[0_32px_80px_-20px_rgb(0_0_0/0.9),inset_0_1px_0_rgb(255_255_255/0.05)]',
          panelClassName,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** A modal's title bar: heading, optional subtitle, and a close button. */
export function ModalHeader({
  title,
  subtitle,
  icon,
  onClose,
}: {
  title: ReactNode
  subtitle?: ReactNode
  icon?: IconName
  onClose: () => void
}) {
  return (
    <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-edge">
      {icon && <IconTile name={icon} size="sm" />}
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold text-[15px] tracking-tight">{title}</h2>
        {subtitle && <p className="text-[13px] text-ink-muted mt-0.5">{subtitle}</p>}
      </div>
      <IconButton icon="close" label="Close" size="sm" onClick={onClose} className="-mr-1.5 -mt-1" />
    </div>
  )
}

/** One entry in a <Menu>. */
export type MenuItem =
  | {
      label: ReactNode
      icon?: IconName
      onSelect: () => void
      danger?: boolean
      disabled?: boolean
      hint?: ReactNode
    }
  | 'divider'

/**
 * An overflow menu: an icon button that opens a small popover of actions.
 * Closes on selection, outside click, or Escape. For secondary and
 * destructive actions that shouldn't sit on the surface as buttons.
 *
 * The popover is portalled to <body> and placed against the trigger: rendered
 * in place, a card's overflow-hidden clipped it to the tile. It opens below
 * the trigger, or above when there's no room, and stays inside the viewport.
 */
export function Menu({
  items,
  label = 'More actions',
  icon = 'more',
  align = 'end',
  trigger,
  className,
}: {
  items: MenuItem[]
  label?: string
  icon?: IconName
  align?: 'start' | 'end'
  /** A custom trigger; defaults to a ghost icon button. */
  trigger?: (props: { open: boolean; toggle: () => void }) => ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuItems = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)') ?? [])]

  // Placed before paint, written straight to the style so there's no frame at
  // the wrong spot.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const anchor = ref.current?.getBoundingClientRect()
      const menu = menuRef.current
      if (!anchor || !menu) return
      // offset* rather than the rect: the entry animation scales the panel.
      const w = menu.offsetWidth
      const h = menu.offsetHeight
      const gap = 6
      const pad = 8
      const vw = document.documentElement.clientWidth
      const vh = window.innerHeight
      const left = Math.max(pad, Math.min(align === 'end' ? anchor.right - w : anchor.left, vw - w - pad))
      const below = anchor.bottom + gap
      const top = below + h > vh - pad && anchor.top - gap - h >= pad ? anchor.top - gap - h : below
      menu.style.left = `${left}px`
      menu.style.top = `${top}px`
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, align])

  useEffect(() => {
    if (!open) return
    // Opened from the keyboard: the portalled items no longer follow the
    // trigger in the tab order, so focus moves into the menu, and back to the
    // trigger when it closes.
    const opener = document.activeElement as HTMLElement | null
    const fromKeyboard = !!opener && !!ref.current?.contains(opener) && opener.matches(':focus-visible')
    if (fromKeyboard) menuItems()[0]?.focus()

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!ref.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      // Only if focus fell to <body> with the menu — not if an action moved it.
      if (fromKeyboard && (!document.activeElement || document.activeElement === document.body)) opener.focus()
    }
  }, [open])

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const list = menuItems()
      const i = list.indexOf(document.activeElement as HTMLElement)
      const next = e.key === 'ArrowDown' ? (i + 1) % list.length : i <= 0 ? list.length - 1 : i - 1
      list[next]?.focus()
    } else if (e.key === 'Tab') {
      // Back to the trigger, so Tab carries on from where the menu sits.
      ref.current?.querySelector<HTMLElement>('button, [tabindex]')?.focus()
      if (e.shiftKey) e.preventDefault()
      setOpen(false)
    }
  }

  const toggle = () => setOpen((v) => !v)
  return (
    <div ref={ref} className={cx('relative inline-flex', className)}>
      {trigger ? (
        trigger({ open, toggle })
      ) : (
        <IconButton icon={icon} label={label} size="sm" onClick={toggle} aria-expanded={open} className={open ? 'bg-white/[0.06] text-ink' : undefined} />
      )}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            // React events bubble through portals: keep a click on an item from
            // also reaching the card the trigger sits in.
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onMenuKeyDown}
            className="fixed z-[60] min-w-48 rounded-xl border border-edge-strong bg-overlay/95 backdrop-blur p-1 shadow-2xl shadow-black/60 modal-in"
          >
            {items.map((it, i) =>
              it === 'divider' ? (
                <div key={i} className="my-1 h-px bg-edge" />
              ) : (
                <button
                  key={i}
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false)
                    it.onSelect()
                  }}
                  className={cx(
                    'w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors disabled:opacity-40 disabled:pointer-events-none',
                    it.danger ? 'text-rose-300 hover:bg-rose-500/12' : 'text-ink-soft hover:bg-white/[0.06] hover:text-ink',
                  )}
                >
                  {it.icon && <Icon name={it.icon} size={15} className="shrink-0 opacity-80" />}
                  <span className="flex-1">{it.label}</span>
                  {it.hint && <span className="text-[11px] text-ink-faint">{it.hint}</span>}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </div>
  )
}

// ---- Navigation -------------------------------------------------------------

/** The underlined tab strip used on Settings and the channel editor. */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: readonly { id: T; label: string; badge?: number; icon?: IconName }[]
  active: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={cx('flex gap-1 border-b border-edge overflow-x-auto no-scrollbar', className)} role="tablist">
      {tabs.map((t) => {
        const on = active === t.id
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.id)}
            className={cx(
              'relative inline-flex items-center gap-2 h-10 px-3.5 text-[13.5px] font-medium whitespace-nowrap transition-colors rounded-t-lg',
              on ? 'text-ink' : 'text-ink-muted hover:text-ink-soft hover:bg-white/[0.03]',
            )}
          >
            {t.icon && <Icon name={t.icon} size={15} className={on ? 'text-indigo-300' : undefined} />}
            {t.label}
            {t.badge != null && (
              <span
                className={cx(
                  'text-[10.5px] tabular-nums rounded-md px-1.5 leading-[18px] transition-colors',
                  on ? 'bg-indigo-500/20 text-indigo-200' : 'bg-raised text-ink-faint',
                )}
              >
                {t.badge}
              </span>
            )}
            {on && (
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-indigo-400 to-sky-400" />
            )}
          </button>
        )
      })}
    </div>
  )
}
