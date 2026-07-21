// Shared UI primitives. These are the handful of surfaces and controls the app
// actually uses, in one place, so a padding or hover colour is defined once
// rather than copy-pasted into every page (which is how the sizes and
// disabled-state opacities drifted apart in the first place).
//
// Every primitive takes `className`, appended last so a caller can add layout
// (flex, margins, width) without forking the base style.

import type { ButtonHTMLAttributes, ComponentPropsWithRef, ReactNode, SelectHTMLAttributes } from 'react'
import Icon, { type IconName } from './Icon'

/** Join class names, dropping falsy ones. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// ---- Surfaces ---------------------------------------------------------------

/** The panel surface every card, form, and list container is built from. */
const CARD_SURFACE = 'rounded-xl border border-edge bg-surface/60'

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

/** Small pill used for counts, kinds, and status ("configured", "12 items"). */
export function Badge({
  tone = 'neutral',
  className,
  children,
  ...rest
}: {
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'
  className?: string
  children: ReactNode
} & React.HTMLAttributes<HTMLSpanElement>) {
  const tones = {
    neutral: 'bg-raised text-ink-muted',
    good: 'bg-emerald-500/15 text-emerald-300',
    warn: 'bg-amber-500/15 text-amber-300',
    bad: 'bg-rose-500/15 text-rose-300',
    accent: 'bg-indigo-500/15 text-indigo-300',
  }
  return (
    <span className={cx('text-xs rounded-full px-2 py-0.5', tones[tone], className)} {...rest}>
      {children}
    </span>
  )
}

// ---- Buttons ----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'subtle'
type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-500 hover:bg-indigo-400 font-medium',
  secondary: 'border border-edge-strong hover:border-indigo-500 hover:text-indigo-300',
  danger: 'border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20',
  // For destructive/secondary actions that shouldn't draw the eye until hovered.
  subtle: 'border border-edge text-ink-faint hover:border-rose-500/50 hover:text-rose-400',
}

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2 text-sm',
}

/**
 * The button classes on their own, for elements that can't be a <Button> —
 * chiefly react-router's <Link>, which must render its own anchor.
 */
export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra?: string): string {
  return cx('rounded-lg transition-colors', BUTTON_VARIANTS[variant], BUTTON_SIZES[size], extra)
}

type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
} & ButtonHTMLAttributes<HTMLButtonElement>

export function Button({ variant = 'primary', size = 'md', className, ...rest }: ButtonProps) {
  return (
    <button
      className={cx(
        'rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    />
  )
}

/** An <a> styled as a button — for downloads and external links. */
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: { variant?: ButtonVariant; size?: ButtonSize } & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={cx(
        'inline-block rounded-lg transition-colors',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    />
  )
}

// ---- Form controls ----------------------------------------------------------

const CONTROL_BASE =
  'rounded-lg bg-canvas border border-edge-strong px-3 py-2 text-sm outline-none transition-colors focus:border-indigo-500'

// `ComponentPropsWithRef` rather than `InputHTMLAttributes` so callers can pass
// a `ref` (React 19 forwards it as an ordinary prop, but the attribute types
// don't include it).
export function Input({ className, ...rest }: ComponentPropsWithRef<'input'>) {
  return <input className={cx(CONTROL_BASE, className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(CONTROL_BASE, className)} {...rest}>
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
    <label className={cx('flex flex-col gap-1 text-sm', className)}>
      <span className="text-ink-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-faint">{hint}</span>}
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
    <div className={cx('rounded-lg border border-edge bg-sunken/40 p-3', className)}>
      <div className="text-xs uppercase tracking-wide text-ink-faint mb-2.5">{title}</div>
      {children}
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
    error: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
    success: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    warn: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
    info: 'border-edge-strong bg-raised/40 text-ink-soft',
    accent: 'border-violet-500/30 bg-violet-500/5 text-ink-soft',
  }
  return <div className={cx('rounded-lg border text-sm p-3', tones[tone], className)}>{children}</div>
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
    indigo: { edge: 'border-indigo-500/30 bg-indigo-500/5', text: 'text-indigo-300', bar: 'bg-indigo-500' },
    violet: { edge: 'border-violet-500/30 bg-violet-500/5', text: 'text-violet-300', bar: 'bg-violet-500' },
  }[tone]
  return (
    <div className={cx('rounded-xl border p-4', tones.edge, className)}>
      <div className="flex justify-between text-sm mb-2">
        <span className={cx('font-medium', tones.text)}>{title}</span>
        <span className="text-slate-400">
          {processed} / {total} ({pct}%)
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
        <div className={cx('h-full transition-all duration-300', tones.bar)} style={{ width: `${pct}%` }} />
      </div>
      {stats && <div className="flex gap-4 text-xs text-slate-400 mt-2">{stats}</div>}
      {detail && <div className="text-xs text-slate-600 mt-1 truncate">{detail}</div>}
    </div>
  )
}

// ---- Page scaffolding -------------------------------------------------------

/**
 * The title block every page opens with: heading, one-line description, and an
 * optional cluster of actions pinned to the right. Every page was hand-rolling
 * this `<h1>` + `<p>` pair, which is how the bottom margins drifted between
 * `mb-5` and `mb-6` and why no page had room for a toolbar.
 *
 * `description` should be a single plain sentence answering "what is this page
 * for" — not the operating manual. Detail belongs in an <InfoHint> next to the
 * control it explains.
 */
export function PageHeader({
  title,
  description,
  icon,
  actions,
  children,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  icon?: IconName
  /** Buttons and links, right-aligned on the title row. */
  actions?: ReactNode
  /** Anything below the description — usually a <Tabs> strip. */
  children?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('mb-6', className)}>
      <div className="flex items-start gap-3 flex-wrap">
        {icon && (
          <span className="shrink-0 grid place-items-center w-10 h-10 rounded-xl border border-edge bg-surface/60">
            <Icon name={icon} size={22} colored />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && <p className="text-ink-muted text-sm mt-1 max-w-2xl">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </div>
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
        'rounded-xl border border-dashed border-edge-strong bg-surface/30',
        'px-6 py-12 flex flex-col items-center text-center',
        className,
      )}
    >
      {icon && (
        <span className="grid place-items-center w-14 h-14 rounded-2xl border border-edge bg-surface mb-4">
          <Icon name={icon} size={28} colored />
        </span>
      )}
      <div className="font-medium text-ink">{title}</div>
      {description && <p className="text-sm text-ink-muted mt-1.5 max-w-md">{description}</p>}
      {action && <div className="mt-5 flex items-center gap-2 flex-wrap justify-center">{action}</div>}
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
        <Skeleton key={i} className="h-24 rounded-xl" />
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
        className="grid place-items-center w-4 h-4 rounded-full border border-edge-strong text-[10px] text-ink-faint cursor-help transition-colors hover:border-indigo-500 hover:text-indigo-300"
      >
        i
      </span>
      <span
        role="tooltip"
        className={cx(
          'pointer-events-none absolute left-1/2 bottom-full z-40 mb-2 w-64 -translate-x-1/2',
          'rounded-lg border border-edge-strong bg-raised px-3 py-2 text-xs font-normal text-ink-soft shadow-xl',
          'opacity-0 transition-opacity duration-150',
          'group-hover:opacity-100 group-focus-within:opacity-100',
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
      <div className="flex items-center gap-2">
        {icon && <Icon name={icon} size={15} colored />}
        <div className="text-ink-muted text-xs uppercase tracking-wide">{label}</div>
      </div>
      <div className={cx('text-2xl font-semibold mt-1.5 tabular-nums', valueTone)}>{value}</div>
      {sub && <div className="text-ink-faint text-xs mt-1">{sub}</div>}
    </Card>
  )
}

// ---- Overlays ---------------------------------------------------------------

/**
 * A centred modal over a dimmed backdrop. Clicking the backdrop closes it;
 * clicks inside the panel don't bubble out (every modal was re-implementing
 * that stopPropagation dance, with a slightly different backdrop each time).
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
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={cx('rounded-2xl border border-edge-strong bg-surface shadow-2xl', panelClassName)}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
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
    <div className={cx('flex gap-1 border-b border-edge overflow-x-auto', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'px-4 py-2 text-sm rounded-t-lg border-b-2 -mb-px whitespace-nowrap transition-colors',
            'inline-flex items-center gap-1.5',
            active === t.id
              ? 'border-indigo-400 text-indigo-300'
              : 'border-transparent text-ink-muted hover:text-ink-soft',
          )}
        >
          {t.icon && <Icon name={t.icon} size={15} colored={active === t.id} />}
          {t.label}
          {t.badge != null && (
            <span
              className={cx(
                'text-[10px] rounded-full px-1.5 py-0.5 transition-colors',
                active === t.id ? 'bg-indigo-500/20 text-indigo-200' : 'bg-raised text-ink-muted',
              )}
            >
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
