import type { ReactNode } from 'react'
import { useMediaQuery } from '../../lib/hooks'
import { IconButton, Modal } from '../ui'

/**
 * The Studio's working area: the section's library on the left, and an
 * inspector for whatever is selected on the right — pinned beside the grid on
 * a wide screen, a dialog on anything narrower, so editing never means losing
 * sight of the library on a desktop, nor squeezing it on a laptop.
 */
export default function Workspace({
  toolbar,
  children,
  inspector,
  inspectorTitle,
  inspectorSubtitle,
  onCloseInspector,
  placeholder,
}: {
  toolbar: ReactNode
  children: ReactNode
  /** The selected item's panel; null when nothing is selected. */
  inspector: ReactNode | null
  inspectorTitle?: ReactNode
  inspectorSubtitle?: ReactNode
  onCloseInspector: () => void
  /** What the pinned inspector shows with nothing selected. */
  placeholder: ReactNode
}) {
  const wide = useMediaQuery('(min-width: 1280px)')

  const head = (
    <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-edge">
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold text-[15px] tracking-tight truncate">{inspectorTitle}</h2>
        {inspectorSubtitle && <p className="text-[12.5px] text-ink-muted mt-0.5">{inspectorSubtitle}</p>}
      </div>
      <IconButton icon="close" label="Close" size="sm" onClick={onCloseInspector} className="-mr-1.5 -mt-1" />
    </div>
  )

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_400px] 3xl:grid-cols-[minmax(0,1fr)_460px] items-start">
      <div className="min-w-0">
        <div className="flex items-center gap-3 flex-wrap mb-4">{toolbar}</div>
        {children}
      </div>
      {wide ? (
        <aside className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl border border-edge surface-card">
          {inspector ? (
            <div key={String(inspectorTitle)} className="fade-in">
              {head}
              <div className="p-5">{inspector}</div>
            </div>
          ) : (
            placeholder
          )}
        </aside>
      ) : (
        inspector && (
          <Modal onClose={onCloseInspector} panelClassName="w-full max-w-lg">
            {head}
            <div className="p-5">{inspector}</div>
          </Modal>
        )
      )}
    </div>
  )
}

/** The pinned inspector's resting state: what selecting something will do. */
export function InspectorPlaceholder({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="px-6 py-14 text-center bg-dots rounded-2xl">
      <div className="mx-auto mb-4 w-fit">{icon}</div>
      <div className="text-[14px] font-medium text-ink">{title}</div>
      <p className="text-[12.5px] text-ink-muted mt-1.5 leading-relaxed max-w-64 mx-auto">{children}</p>
    </div>
  )
}
