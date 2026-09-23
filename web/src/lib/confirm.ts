// A promise-based stand-in for window.confirm(): `await confirmDialog({...})`
// resolves true/false, and <ConfirmHost/> (mounted once in Layout) draws it in
// the app's own style instead of the browser's grey box. Same shape as toast.ts
// — a tiny store any handler can reach without threading props around.

import type { ReactNode } from 'react'

export type ConfirmOptions = {
  title: ReactNode
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Paint the confirm button as destructive. */
  danger?: boolean
}

export type PendingConfirm = ConfirmOptions & { id: number; resolve: (ok: boolean) => void }

type Listener = (c: PendingConfirm | null) => void
let current: PendingConfirm | null = null
let nextId = 1
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l(current)
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  // A second request while one is open answers the first "no" — only one
  // question on screen at a time.
  current?.resolve(false)
  return new Promise((resolve) => {
    const id = nextId++
    current = {
      ...opts,
      id,
      resolve: (ok) => {
        if (current?.id === id) current = null
        emit()
        resolve(ok)
      },
    }
    emit()
  })
}

export function subscribeConfirm(l: Listener): () => void {
  listeners.add(l)
  l(current)
  return () => {
    listeners.delete(l)
  }
}
