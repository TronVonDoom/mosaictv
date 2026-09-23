import { useEffect, useRef, useState } from 'react'
import Icon, { type IconName } from './Icon'
import { errorMessage } from '../lib/errors'
import { Banner, Button, Field, Input, Modal, ModalHeader, cx } from './ui'

function fmtSize(bytes: number): string {
  const u = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

/**
 * Upload one file: a drop zone (or click to browse), a preview of what was
 * picked, and a name that defaults to the file's. Replaces the always-open
 * upload forms that used to sit on top of every Studio section.
 */
export default function UploadDialog({
  title,
  subtitle,
  icon,
  accept,
  kind,
  onClose,
  onUpload,
}: {
  title: string
  subtitle?: string
  icon: IconName
  /** The file input's accept list, e.g. "image/*". */
  accept: string
  /** How to preview the chosen file. */
  kind: 'image' | 'audio' | 'video'
  onClose: () => void
  /** Do the upload; throw to show an error and keep the dialog open. */
  onUpload: (name: string, file: File) => Promise<void>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [url, setUrl] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // An object URL for the preview, revoked when replaced or closed.
  useEffect(() => {
    if (!file) return
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  const choose = (f: File | undefined) => {
    if (!f) return
    setFile(f)
    setError(null)
    setName((n) => n || f.name.replace(/\.[^.]+$/, ''))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      await onUpload(name.trim() || file.name.replace(/\.[^.]+$/, ''), file)
    } catch (err) {
      setError(errorMessage(err, 'Upload failed'))
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-lg">
      <ModalHeader icon={icon} title={title} subtitle={subtitle} onClose={onClose} />
      <form onSubmit={submit} className="p-5 space-y-4">
        {error && <Banner>{error}</Banner>}

        <label
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            choose(e.dataTransfer.files?.[0])
          }}
          className={cx(
            'relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-center cursor-pointer transition-colors',
            file ? 'py-4' : 'py-10',
            over ? 'border-indigo-400 bg-indigo-500/[0.08]' : 'border-edge-strong bg-sunken/60 hover:border-ink-ghost',
          )}
        >
          <input ref={inputRef} type="file" accept={accept} className="sr-only" onChange={(e) => choose(e.target.files?.[0])} />
          {file && url ? (
            <>
              {kind === 'image' && (
                <span className="grid place-items-center w-full h-32 rounded-lg bg-[repeating-conic-gradient(#171b26_0_25%,#0e1118_0_50%)] bg-[length:16px_16px]">
                  <img src={url} alt="" className="max-h-28 max-w-[80%] object-contain" />
                </span>
              )}
              {kind === 'video' && <video src={url} muted controls className="w-full max-h-40 rounded-lg bg-black" />}
              {kind === 'audio' && <audio src={url} controls className="w-full" />}
              <span className="text-[12.5px] text-ink-soft">
                {file.name} <span className="text-ink-faint">· {fmtSize(file.size)}</span>
              </span>
              <span className="text-[11.5px] text-indigo-300">Click or drop to choose another</span>
            </>
          ) : (
            <>
              <span className="grid place-items-center w-11 h-11 rounded-full bg-indigo-500/15 text-indigo-300">
                <Icon name="upload" size={20} />
              </span>
              <span className="text-[13.5px] font-medium text-ink">Drop a file here, or click to browse</span>
              <span className="text-[12px] text-ink-faint">{accept.replace(/[a-z]+\/\*/g, (m) => m.split('/')[0] + ' files').replace(/,/g, ', ')}</span>
            </>
          )}
        </label>

        <Field label="Name" hint="Defaults to the file name.">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" icon="upload" loading={busy} disabled={!file}>
            Upload
          </Button>
        </div>
      </form>
    </Modal>
  )
}
