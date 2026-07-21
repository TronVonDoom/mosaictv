import { useEffect, useRef, useState } from 'react'
import { api, logoImageUrl, type Logo } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { Select } from './ui'

// A logo dropdown with an inline "+ Upload" so you never have to leave the page
// to add a logo. Self-contained: fetches its own list and refreshes after upload.
export default function LogoPicker({
  value,
  onChange,
  noneLabel = 'No logo',
}: {
  value: number | null
  onChange: (logoId: number | null) => void
  noneLabel?: string
}) {
  const [logos, setLogos] = useState<Logo[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = () => api.logos().then(setLogos).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setUploading(true)
    setError(null)
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.onerror = rej
        r.readAsDataURL(f)
      })
      const name = f.name.replace(/\.[^.]+$/, '') || 'Logo'
      const logo = await api.uploadLogo(name, dataUrl)
      await refresh()
      onChange(logo.id)
    } catch (err) {
      setError(errorMessage(err, 'Upload failed'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div>
      <div className="flex gap-2 items-center">
        <Select
          className="flex-1 min-w-0"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">{noneLabel}</option>
          {logos.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        {value != null && (
          <img src={logoImageUrl(value)} alt="" className="w-9 h-9 rounded object-contain bg-canvas border border-edge shrink-0" />
        )}
        <label className="rounded-lg border border-edge-strong hover:border-indigo-500 hover:text-indigo-300 px-3 py-2 text-sm cursor-pointer shrink-0 whitespace-nowrap">
          {uploading ? 'Uploading…' : '+ Upload'}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onFile} disabled={uploading} />
        </label>
      </div>
      {error && <div className="text-xs text-rose-400 mt-1">{error}</div>}
    </div>
  )
}
