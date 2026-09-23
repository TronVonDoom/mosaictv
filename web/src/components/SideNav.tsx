import Icon, { type IconName } from './Icon'
import { cx } from './ui'

export type SideNavItem<T extends string> = {
  id: T
  label: string
  icon: IconName
  /** A one-line "what's in here", shown under the label on wide screens. */
  description?: string
  count?: number | null
}

/**
 * A page's own section list — the rail down the left of Settings and Studio.
 * On a phone or tablet it becomes a scrolling strip of pills above the
 * content, so it never eats the width the content needs.
 */
export default function SideNav<T extends string>({
  items,
  active,
  onChange,
  label,
  className,
}: {
  items: readonly SideNavItem<T>[]
  active: T
  onChange: (id: T) => void
  label: string
  className?: string
}) {
  return (
    <nav aria-label={label} className={cx('lg:sticky lg:top-20 self-start', className)}>
      <div className="flex lg:flex-col gap-1 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1 lg:pb-0">
        {items.map((it) => {
          const on = it.id === active
          return (
            <button
              key={it.id}
              onClick={() => onChange(it.id)}
              aria-current={on ? 'page' : undefined}
              className={cx(
                'group relative shrink-0 flex items-center gap-3 rounded-xl text-left transition-colors',
                'h-10 px-3 lg:h-auto lg:py-2.5',
                on
                  ? 'bg-white/[0.07] text-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]'
                  : 'text-ink-muted hover:text-ink-soft hover:bg-white/[0.035]',
              )}
            >
              {on && (
                <span className="hidden lg:block absolute -left-1 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-full bg-gradient-to-b from-indigo-400 to-sky-400" />
              )}
              <Icon name={it.icon} size={17} className={cx('shrink-0', on ? 'text-indigo-300' : 'text-ink-faint group-hover:text-ink-muted')} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-medium whitespace-nowrap">{it.label}</span>
                {it.description && (
                  <span className="hidden lg:block text-[11.5px] text-ink-faint leading-snug mt-0.5">{it.description}</span>
                )}
              </span>
              {it.count != null && (
                <span
                  className={cx(
                    'shrink-0 text-[11px] tabular-nums rounded-md px-1.5 leading-5',
                    on ? 'bg-indigo-500/20 text-indigo-200' : 'bg-raised text-ink-faint',
                  )}
                >
                  {it.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
