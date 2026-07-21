import { useEffect, useRef, useState } from 'react'
import { api, assetFileUrl, type Asset, type AssetKind } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { toast } from '../lib/toast'
import { Button, Card, Field, Input } from './ui'

function fmtSize(bytes: number | null): string {
  if (!bytes) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

export default function AssetManager({
  kind,
  accept,
  emptyText,
  hint,
}: {
  kind: AssetKind
  accept: string
  emptyText: string
  hint?: string
}) {
  const [assets, setAssets] = useState<Asset[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => api.assets(kind).then(setAssets).catch(() => {})
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  async function upload(e: React.FormEvent) {
    e.preventDefault()
    const f = fileRef.current?.files?.[0]
    const nm = name.trim() || f?.name.replace(/\.[^.]+$/, '') || ''
    if (!f || !nm) {
      toast.error('Pick a file (a name is optional).')
      return
    }
    setBusy(true)
    try {
      await api.uploadAsset(kind, nm, f)
      setName('')
      if (fileRef.current) fileRef.current.value = ''
      toast.success(`Uploaded ${nm}`)
      refresh()
    } catch (err) {
      toast.error(errorMessage(err, 'Upload failed'))
    } finally {
      setBusy(false)
    }
  }

  async function del(id: number) {
    await api.deleteAsset(id).catch(() => {})
    refresh()
  }

  return (
    <div>
      {hint && <p className="text-xs text-ink-faint mb-3">{hint}</p>}

      <Card className="p-5 mb-6">
        <form onSubmit={upload} className="flex flex-wrap gap-3 items-end">
          <Field label="Name (optional)" className="flex-1 min-w-40">
            <Input
              placeholder="defaults to the file name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="File">
            <input
              ref={fileRef}
              type="file"
              accept={accept}
              className="text-sm text-ink-muted file:mr-3 file:rounded-lg file:border-0 file:bg-raised file:px-3 file:py-2 file:text-ink file:text-sm"
            />
          </Field>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Uploading…' : 'Upload'}
          </Button>
        </form>
      </Card>

      {assets.length === 0 ? (
        <div className="text-ink-faint text-sm">{emptyText}</div>
      ) : (
        <div className="space-y-2">
          {assets.map((a) => (
            <Card key={a.id} className="p-3 flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate" title={a.name}>{a.name}</div>
                <div className="text-xs text-ink-faint">{a.mime}{a.sizeBytes ? ` · ${fmtSize(a.sizeBytes)}` : ''}</div>
              </div>
              {kind === 'audio' ? (
                <audio controls preload="none" src={assetFileUrl(a.id)} className="h-8 max-w-[240px]" />
              ) : (
                <video controls preload="none" src={assetFileUrl(a.id)} className="h-16 rounded bg-black" />
              )}
              <button onClick={() => del(a.id)} className="text-ink-faint hover:text-rose-400 text-lg px-1" aria-label="Delete">
                ×
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
