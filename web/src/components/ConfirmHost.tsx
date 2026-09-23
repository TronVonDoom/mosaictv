import { useEffect, useRef, useState } from 'react'
import { subscribeConfirm, type PendingConfirm } from '../lib/confirm'
import { Button, IconTile, Modal } from './ui'

/** Draws whatever confirmDialog() is currently asking. Mounted once, in Layout. */
export default function ConfirmHost() {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => subscribeConfirm(setPending), [])
  // Focus the safe choice for a destructive question, the action otherwise, so
  // Enter does the expected thing and a stray keypress never deletes anything.
  useEffect(() => {
    if (pending && !pending.danger) confirmRef.current?.focus()
  }, [pending])

  if (!pending) return null
  const answer = (ok: boolean) => pending.resolve(ok)

  return (
    <Modal onClose={() => answer(false)} panelClassName="w-full max-w-md">
      <div className="p-5 flex gap-4">
        <IconTile name={pending.danger ? 'warning' : 'info'} color={pending.danger ? '#fb7185' : undefined} size="md" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-[15px] tracking-tight text-ink">{pending.title}</h2>
          {pending.message && <div className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">{pending.message}</div>}
        </div>
      </div>
      <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-edge bg-sunken/40">
        <Button variant="secondary" autoFocus={pending.danger} onClick={() => answer(false)}>
          {pending.cancelLabel ?? 'Cancel'}
        </Button>
        <Button ref={confirmRef} variant={pending.danger ? 'danger' : 'primary'} onClick={() => answer(true)}>
          {pending.confirmLabel ?? 'Continue'}
        </Button>
      </div>
    </Modal>
  )
}
