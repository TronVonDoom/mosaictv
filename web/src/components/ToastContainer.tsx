import { useEffect, useState } from 'react'
import { toast, type ToastMsg } from '../lib/toast'

// Stacked, self-dismissing toasts anchored bottom-right — mounted once in
// Layout so any save handler anywhere can call toast.success()/error() and
// get visible confirmation without each page building its own banner.
export default function ToastContainer() {
  const [items, setItems] = useState<ToastMsg[]>([])

  useEffect(() => toast.subscribe(setItems), [])

  if (items.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {items.map((t) => (
        <div
          key={t.id}
          onClick={() => toast.dismiss(t.id)}
          role="status"
          className={
            'toast-in cursor-pointer rounded-lg border px-4 py-2.5 text-sm font-medium shadow-lg shadow-black/30 backdrop-blur ' +
            (t.type === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
              : t.type === 'error'
                ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                : 'border-edge-strong bg-raised/90 text-ink')
          }
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}
