import { useEffect, useRef, useState } from 'react'
import { api, logoImageUrl, type Logo, type WatermarkConfig } from '../lib/api'
import WatermarkFields from '../components/WatermarkFields'
import { toast } from '../lib/toast'

export default function Logos({ embedded = false }: { embedded?: boolean }) {
  const [logos, setLogos] = useState<Logo[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Logo | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => api.logos().then(setLogos).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  async function upload(e: React.FormEvent) {
    e.preventDefault()
    const f = fileRef.current?.files?.[0]
    if (!f || !name.trim()) {
      setError('A name and an image file are required.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.onerror = rej
        r.readAsDataURL(f)
      })
      await api.uploadLogo(name.trim(), dataUrl)
      setName('')
      if (fileRef.current) fileRef.current.value = ''
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function del(id: number) {
    await api.deleteLogo(id).catch(() => {})
    refresh()
  }

  return (
    <div>
      {!embedded && (
        <>
          <h1 className="text-2xl font-bold mb-1">Logos</h1>
          <p className="text-slate-400 text-sm mb-6">
            Upload logos once, then pick them as channel or block watermarks (and guide images). Each logo
            carries its own watermark settings — click <span className="text-slate-300">Watermark</span> on a
            logo to tune size, position, opacity, and timing.
          </p>
        </>
      )}

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm p-3 mb-5">
          {error}
        </div>
      )}

      <form onSubmit={upload} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 mb-6 flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 text-sm flex-1 min-w-40">
          <span className="text-slate-400">Name</span>
          <input className="rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm focus:border-indigo-500 outline-none" placeholder="Nick @ Night" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-400">Image (PNG/JPG/WEBP)</span>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-slate-200 file:text-sm" />
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 px-5 py-2 text-sm font-medium">
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      {logos.length === 0 ? (
        <div className="text-slate-500 text-sm">No logos yet.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {logos.map((l) => (
            <div key={l.id} className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
              <div className="aspect-video flex items-center justify-center p-4 bg-[repeating-conic-gradient(#1e293b_0_25%,#0f172a_0_50%)] bg-[length:20px_20px]">
                <img src={logoImageUrl(l.id)} alt={l.name} className="max-h-full max-w-full object-contain" />
              </div>
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="text-sm truncate flex-1" title={l.name}>{l.name}</span>
                <button onClick={() => del(l.id)} className="text-slate-600 hover:text-rose-400 text-sm" aria-label="Delete">×</button>
              </div>
              <div className="px-3 pb-2 flex items-center justify-between">
                <span className="text-[11px] text-slate-500">
                  {l.watermark.mode === 'none'
                    ? 'watermark off'
                    : `${l.watermark.mode} · ${l.watermark.position}${l.watermark.constrainToMedia ? ' · media-fit' : ''}`}
                </span>
                <button
                  onClick={() => setEditing(l)}
                  className="text-xs rounded-md border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 px-2 py-0.5"
                >
                  Watermark
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <WatermarkEditor
          logo={editing}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setLogos((ls) => ls.map((l) => (l.id === updated.id ? updated : l)))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function WatermarkEditor({
  logo,
  onClose,
  onSaved,
}: {
  logo: Logo
  onClose: () => void
  onSaved: (l: Logo) => void
}) {
  const [wm, setWm] = useState<WatermarkConfig>(logo.watermark)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const updated = await api.updateLogo(logo.id, { watermark: wm })
      onSaved(updated)
      toast.success('Watermark saved')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-5 max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="w-16 h-10 rounded flex items-center justify-center bg-[repeating-conic-gradient(#1e293b_0_25%,#0f172a_0_50%)] bg-[length:14px_14px] shrink-0">
            <img src={logoImageUrl(logo.id)} alt={logo.name} className="max-h-full max-w-full object-contain" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold truncate">{logo.name}</h2>
            <p className="text-xs text-slate-500">Watermark settings for this logo</p>
          </div>
        </div>

        {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm p-2 mb-3">{err}</div>}

        <WatermarkFields wm={wm} onChange={setWm} />

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="rounded-lg border border-slate-700 hover:border-slate-500 px-4 py-2 text-sm">
            Cancel
          </button>
          <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 px-5 py-2 text-sm font-medium">
            {saving ? 'Saving…' : 'Save watermark'}
          </button>
        </div>
      </div>
    </div>
  )
}
