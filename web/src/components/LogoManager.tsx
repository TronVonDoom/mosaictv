import { useEffect, useRef, useState } from 'react'
import { api, logoImageUrl, type Logo, type WatermarkConfig } from '../lib/api'
import WatermarkFields from './WatermarkFields'
import { toast } from '../lib/toast'
import { errorMessage } from '../lib/errors'
import { Badge, Banner, Button, Card, EmptyState, Field, IconButton, Input, Menu, Modal } from './ui'
import { confirmDialog } from '../lib/confirm'

/** The logo library: upload an image, then tune the watermark it renders as.
 *  Lives under Studio → Logos; it had its own route until that page absorbed it. */
export default function LogoManager() {
  const [logos, setLogos] = useState<Logo[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Logo | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // One hidden picker, aimed at whichever logo's Replace was clicked.
  const replaceRef = useRef<HTMLInputElement>(null)
  const [replacingId, setReplacingId] = useState<number | null>(null)

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
      setError(errorMessage(err, 'Upload failed'))
    } finally {
      setBusy(false)
    }
  }

  /** Swap a logo's image in place: same id, so every channel and block that
   *  already points at it keeps pointing at it, watermark settings and all. */
  async function replaceImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    const id = replacingId
    e.target.value = '' // let the same file be picked again after a failure
    if (!f || id == null) return
    setBusy(true)
    setError(null)
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.onerror = rej
        r.readAsDataURL(f)
      })
      await api.replaceLogoImage(id, dataUrl)
      toast.success('Logo replaced')
      refresh()
    } catch (err) {
      setError(errorMessage(err, 'Replace failed'))
    } finally {
      setBusy(false)
      setReplacingId(null)
    }
  }

  function pickReplacement(id: number) {
    setReplacingId(id)
    replaceRef.current?.click()
  }

  async function del(l: Logo) {
    const ok = await confirmDialog({
      title: `Delete the “${l.name}” logo?`,
      message: 'Channels, blocks and collections using it fall back to their next logo — or none.',
      confirmLabel: 'Delete logo',
      danger: true,
    })
    if (!ok) return
    await api.deleteLogo(l.id).catch(() => {})
    refresh()
  }

  return (
    <div>
      {error && <Banner className="mb-5">{error}</Banner>}

      <input
        ref={replaceRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={replaceImage}
      />

      <Card className="p-5 mb-6">
        <form onSubmit={upload} className="flex flex-wrap gap-3 items-end">
          <Field label="Name" className="flex-1 min-w-48">
            <Input placeholder="Nick @ Night" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Image" hint="PNG with transparency looks best on screen.">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="h-9 text-[13px] text-ink-muted file:mr-3 file:h-9 file:rounded-lg file:border file:border-edge-strong file:bg-raised file:px-3 file:text-ink-soft file:text-[13px] file:font-medium hover:file:bg-overlay file:cursor-pointer cursor-pointer"
            />
          </Field>
          <Button type="submit" icon="upload" loading={busy}>
            Upload logo
          </Button>
        </form>
      </Card>

      {logos.length === 0 ? (
        <EmptyState
          icon="image"
          title="No logos yet"
          description="Upload a channel logo above. It's used in players' guides and as the on-screen watermark."
        />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
          {logos.map((l) => (
            <Card key={l.id} className="group overflow-hidden flex flex-col">
              <button
                onClick={() => setEditing(l)}
                title="Watermark settings"
                className="relative aspect-video flex items-center justify-center p-5 bg-[repeating-conic-gradient(#171b26_0_25%,#0e1118_0_50%)] bg-[length:18px_18px] border-b border-edge"
              >
                <img
                  src={logoImageUrl(l)}
                  alt={l.name}
                  className="max-h-full max-w-full object-contain drop-shadow-[0_4px_12px_rgb(0_0_0/0.6)] transition-transform duration-300 group-hover:scale-105"
                />
              </button>
              <div className="p-3.5 flex-1 flex flex-col gap-2.5">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium truncate" title={l.name}>
                      {l.name}
                    </div>
                    <div className="mt-1">
                      {l.watermark.mode === 'none' ? (
                        <Badge>Watermark off</Badge>
                      ) : (
                        <Badge tone="accent" title={l.watermark.constrainToMedia ? 'Fitted to the picture, not the frame' : undefined}>
                          {l.watermark.mode === 'permanent' ? 'Always on' : 'Intermittent'} · {l.watermark.position}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Menu
                    items={[
                      {
                        label: 'Replace image',
                        icon: 'upload',
                        disabled: busy,
                        hint: 'keeps settings',
                        onSelect: () => pickReplacement(l.id),
                      },
                      'divider',
                      { label: 'Delete logo', icon: 'trash', danger: true, onSelect: () => del(l) },
                    ]}
                  />
                </div>
                <Button variant="secondary" size="sm" icon="sliders" onClick={() => setEditing(l)} className="mt-auto w-full">
                  Watermark settings
                </Button>
              </div>
            </Card>
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
      setErr(errorMessage(e, 'Save failed'))
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-2xl p-5 max-h-[90vh] overflow-auto">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-16 h-10 rounded-lg flex items-center justify-center bg-[repeating-conic-gradient(#171b26_0_25%,#0e1118_0_50%)] bg-[length:12px_12px] border border-edge shrink-0">
          <img src={logoImageUrl(logo)} alt={logo.name} className="max-h-[80%] max-w-[85%] object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-[15px] truncate">{logo.name}</h2>
          <p className="text-[13px] text-ink-muted">Watermark settings for this logo</p>
        </div>
        <IconButton icon="close" label="Close" size="sm" onClick={onClose} />
      </div>

      {err && <Banner className="mb-3">{err}</Banner>}

      <WatermarkFields wm={wm} onChange={setWm} />

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={save} loading={saving}>
          Save watermark
        </Button>
      </div>
    </Modal>
  )
}
