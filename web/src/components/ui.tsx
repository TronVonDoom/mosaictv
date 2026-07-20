// Shared UI primitives. These are the handful of surfaces and controls the app
// actually uses, in one place, so a padding or hover colour is defined once
// rather than copy-pasted into every page (which is how the sizes and
// disabled-state opacities drifted apart in the first place).
//
// Every primitive takes `className`, appended last so a caller can add layout
// (flex, margins, width) without forking the base style.

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'

/** Join class names, dropping falsy ones. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// ---- Surfaces ---------------------------------------------------------------

/** The panel surface every card, form, and list container is built from. */
const CARD_SURFACE = 'rounded-xl border border-slate-800 bg-slate-900/60'

/** The card surface on its own, for elements that can't be a <Card> — e.g. a
 *  react-router <Link> that should look like one. */
export function cardClass(extra?: string): string {
  return cx(CARD_SURFACE, extra)
}

/** The standard panel surface: every card, form, and list container. */
export function Card({
  className,
  children,
  ...rest
}: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx(CARD_SURFACE, className ?? 'p-5')} {...rest}>
      {children}
    </div>
  )
}

/** Small pill used for counts, kinds, and status ("configured", "12 items"). */
export function Badge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'
  className?: string
  children: ReactNode
}) {
  const tones = {
    neutral: 'bg-slate-800 text-slate-400',
    good: 'bg-emerald-500/15 text-emerald-300',
    warn: 'bg-amber-500/15 text-amber-300',
    bad: 'bg-rose-500/15 text-rose-300',
    accent: 'bg-indigo-500/15 text-indigo-300',
  }
  return <span className={cx('text-xs rounded-full px-2 py-0.5', tones[tone], className)}>{children}</span>
}

// ---- Buttons ----------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'subtle'
type ButtonSize = 'sm' | 'md' | 'lg'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-500 hover:bg-indigo-400 font-medium',
  secondary: 'border border-slate-700 hover:border-indigo-500 hover:text-indigo-300',
  danger: 'border border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20',
  // For destructive/secondary actions that shouldn't draw the eye until hovered.
  subtle: 'border border-slate-800 text-slate-500 hover:border-rose-500/50 hover:text-rose-400',
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
  'rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm outline-none transition-colors focus:border-indigo-500'

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
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
      <span className="text-slate-400">{label}</span>
      {children}
      {hint && <span className="text-xs text-slate-600">{hint}</span>}
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
    <div className={cx('rounded-lg border border-slate-800 bg-slate-950/40 p-3', className)}>
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-2.5">{title}</div>
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
    info: 'border-slate-700 bg-slate-800/40 text-slate-300',
    accent: 'border-violet-500/30 bg-violet-500/5 text-slate-300',
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
        className={cx('rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl', panelClassName)}
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
  tabs: readonly { id: T; label: string; badge?: number }[]
  active: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={cx('flex gap-1 border-b border-slate-800 overflow-x-auto', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            'px-4 py-2 text-sm rounded-t-lg border-b-2 -mb-px whitespace-nowrap transition-colors',
            active === t.id
              ? 'border-indigo-400 text-indigo-300'
              : 'border-transparent text-slate-400 hover:text-slate-200',
          )}
        >
          {t.label}
          {t.badge != null && (
            <span className="ml-1.5 text-[10px] rounded-full bg-slate-800 text-slate-400 px-1.5 py-0.5">
              {t.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
