import { useRef, type ReactNode } from 'react'
import { IconButton, SectionHeading } from './ui'

/**
 * A titled, horizontally scrolling row of posters — the streaming-app shelf.
 * Arrow buttons page it a screenful at a time; touch and trackpads scroll it
 * natively, snapping to tiles.
 */
export default function PosterRail({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: 'smooth' })
  return (
    <section>
      <SectionHeading
        title={title}
        description={description}
        actions={
          <>
            {actions}
            <IconButton icon="chevronLeft" label="Scroll left" size="sm" variant="secondary" onClick={() => page(-1)} />
            <IconButton icon="chevronRight" label="Scroll right" size="sm" variant="secondary" onClick={() => page(1)} />
          </>
        }
      />
      <div
        ref={ref}
        className="-mx-1 px-1 pb-2 flex gap-5 overflow-x-auto no-scrollbar snap-x snap-mandatory scroll-px-1"
      >
        {children}
      </div>
    </section>
  )
}

/** One tile's slot in a rail — fixed width so rows line up. */
export function RailItem({ children }: { children: ReactNode }) {
  return <div className="w-[150px] shrink-0 snap-start pt-1">{children}</div>
}
