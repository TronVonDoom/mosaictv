import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'

/**
 * An image shown as large as the screen allows. Click anywhere or press Escape
 * to close. It can open from inside a dialog: the Escape is caught before the
 * dialog's own handler, so only the enlarged image closes.
 */
export default function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-[70] grid cursor-zoom-out place-items-center bg-black/85 p-4 backdrop-blur-sm fade-in sm:p-10"
      onClick={onClose}
    >
      <img src={src} alt={alt} className="modal-in max-h-full max-w-full rounded-lg shadow-[0_30px_90px_-20px_rgb(0_0_0/0.9)]" />
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <Icon name="close" size={18} />
      </button>
    </div>,
    document.body,
  )
}
