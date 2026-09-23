import { useEffect, useState } from 'react'
import Icon from './Icon'
import { toast, type ToastMsg } from '../lib/toast'
import { cx } from './ui'

// Stacked, self-dismissing toasts anchored bottom-right — mounted once in
// Layout so any save handler anywhere can call toast.success()/error() and
// get visible confirmation without each page building its own banner.
export default function ToastContainer() {
  const [items, setItems] = useState<ToastMsg[]>([])

  useEffect(() => toast.subscribe(setItems), [])

  if (items.length === 0) return null

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 w-[22rem] max-w-[calc(100vw-2.5rem)]" aria-live="polite">
      {items.map((t) => {
        const tone =
          t.type === 'success'
            ? { icon: 'success' as const, color: 'text-emerald-400', bar: 'bg-emerald-400' }
            : t.type === 'error'
              ? { icon: 'warning' as const, color: 'text-rose-400', bar: 'bg-rose-400' }
              : { icon: 'info' as const, color: 'text-indigo-300', bar: 'bg-indigo-400' }
        return (
          <div
            key={t.id}
            onClick={() => toast.dismiss(t.id)}
            role="status"
            className="toast-in relative overflow-hidden cursor-pointer flex items-start gap-3 rounded-xl border border-edge-strong bg-overlay/95 backdrop-blur-xl pl-4 pr-3.5 py-3 text-[13.5px] text-ink shadow-[0_20px_50px_-12px_rgb(0_0_0/0.8),inset_0_1px_0_rgb(255_255_255/0.05)]"
          >
            <span className={cx('absolute left-0 inset-y-0 w-[3px]', tone.bar)} />
            <Icon name={tone.icon} size={17} className={cx('shrink-0 mt-px', tone.color)} />
            <span className="flex-1 min-w-0 leading-snug">{t.text}</span>
            <Icon name="close" size={14} className="shrink-0 mt-0.5 text-ink-faint" />
          </div>
        )
      })}
    </div>
  )
}
