// Lightweight global toast notifications — a plain pub-sub so any save
// handler can fire `toast.success(...)` without needing React context or
// prop-drilling. Rendered once by <ToastContainer /> in Layout.

export type ToastType = 'success' | 'error' | 'info'
export type ToastMsg = { id: number; type: ToastType; text: string }

type Listener = (toasts: ToastMsg[]) => void

let toasts: ToastMsg[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((l) => l(toasts))
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

function push(type: ToastType, text: string, durationMs: number) {
  const id = nextId++
  toasts = [...toasts, { id, type, text }]
  emit()
  setTimeout(() => dismiss(id), durationMs)
}

export const toast = {
  success: (text: string, durationMs = 2500) => push('success', text, durationMs),
  error: (text: string, durationMs = 4000) => push('error', text, durationMs),
  info: (text: string, durationMs = 3000) => push('info', text, durationMs),
  dismiss,
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    listener(toasts)
    return () => listeners.delete(listener)
  },
}
