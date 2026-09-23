import { useEffect, useMemo, useRef, useState } from 'react'
import { api, logoImageUrl, type Logo, type WatermarkConfig } from '../../lib/api'
import { confirmDialog } from '../../lib/confirm'
import { errorMessage } from '../../lib/errors'
import { toast } from '../../lib/toast'
import UploadDialog from '../UploadDialog'
import WatermarkFields from '../WatermarkFields'
import WatermarkPreview from '../WatermarkPreview'
import Icon from '../Icon'
import { Badge, Banner, Button, EmptyState, IconTile, Input, Menu, Skeleton, cx } from '../ui'
import Workspace, { InspectorPlaceholder } from './Workspace'

const CHECKER = 'bg-[repeating-conic-gradient(#171b26_0_25%,#0e1118_0_50%)] bg-[length:18px_18px]'

function wmSummary(wm: WatermarkConfig): string {
  if (wm.mode === 'none') return 'Watermark off'
  return `${wm.mode === 'permanent' ? 'Always on' : 'Intermittent'} · ${wm.position.replace('-', ' ')}`
}

/** The selected logo: its watermark, previewed live over a real frame. */
function LogoInspector({
  logo,
  busy,
  onSaved,
  onReplace,
  onDelete,
}: {
  logo: Logo
  busy: boolean
  onSaved: (l: Logo) => void
  onReplace: () => void
  onDelete: () => void
}) {
  const [wm, setWm] = useState<WatermarkConfig>(logo.watermark)
  const [name, setName] = useState(logo.name)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dirty = JSON.stringify(wm) !== JSON.stringify(logo.watermark) || name.trim() !== logo.name

  async function save() {
    setSaving(true)
    setErr(null)
    try {
      const updated = await api.updateLogo(logo.id, { name: name.trim() || logo.name, watermark: wm })
      onSaved(updated)
      toast.success('Logo saved')
    } catch (e) {
      setErr(errorMessage(e, 'Save failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      {err && <Banner>{err}</Banner>}
      <WatermarkPreview wm={wm} logoSrc={logoImageUrl(logo)} />

      <div>
        <div className="text-[12.5px] font-medium text-ink-soft mb-1.5">Name</div>
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
      </div>

      <div>
        <div className="text-[12.5px] font-medium text-ink-soft mb-2">Watermark</div>
        <WatermarkFields wm={wm} onChange={setWm} />
      </div>

      <div className="sticky bottom-0 -mx-5 -mb-5 px-5 py-3.5 border-t border-edge bg-surface/95 backdrop-blur flex items-center gap-2">
        <Button variant="secondary" size="sm" icon="upload" onClick={onReplace} disabled={busy} title="Swap the image, keeping this logo's name, watermark and every channel using it">
          Replace image
        </Button>
        <Button variant="subtle" size="sm" icon="trash" onClick={onDelete}>
          Delete
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {dirty && (
            <Button variant="ghost" size="sm" onClick={() => { setWm(logo.watermark); setName(logo.name) }}>
              Revert
            </Button>
          )}
          <Button size="sm" onClick={save} loading={saving} disabled={!dirty}>
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Studio → Logos: every logo, and the watermark each one renders as. */
export default function LogosStudio({ onCount }: { onCount: (n: number) => void }) {
  const [logos, setLogos] = useState<Logo[] | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // One hidden picker, aimed at the selected logo when Replace is clicked.
  const replaceRef = useRef<HTMLInputElement>(null)

  const refresh = () =>
    api
      .logos()
      .then((ls) => {
        setLogos(ls)
        onCount(ls.length)
      })
      .catch(() => setLogos((l) => l ?? []))
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selected = logos?.find((l) => l.id === selectedId) ?? null
  const shown = useMemo(
    () => (logos ?? []).filter((l) => !query.trim() || l.name.toLowerCase().includes(query.trim().toLowerCase())),
    [logos, query],
  )

  async function replaceImage(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !selected) return
    setBusy(true)
    setError(null)
    try {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result))
        r.onerror = rej
        r.readAsDataURL(f)
      })
      await api.replaceLogoImage(selected.id, dataUrl)
      toast.success('Logo image replaced')
      refresh()
    } catch (err) {
      setError(errorMessage(err, 'Replace failed'))
    } finally {
      setBusy(false)
    }
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
    setSelectedId(null)
    refresh()
  }

  return (
    <>
      <input ref={replaceRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={replaceImage} />
      <Workspace
        toolbar={
          <>
            <div className="relative flex-1 min-w-48 max-w-sm">
              <Icon name="search" size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint pointer-events-none" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter logos…" className="w-full pl-9" />
            </div>
            <Button icon="upload" onClick={() => setUploading(true)} className="ml-auto">
              Upload logo
            </Button>
          </>
        }
        inspector={
          selected && (
            <LogoInspector
              key={selected.id}
              logo={selected}
              busy={busy}
              onSaved={(u) => setLogos((ls) => (ls ?? []).map((l) => (l.id === u.id ? u : l)))}
              onReplace={() => replaceRef.current?.click()}
              onDelete={() => del(selected)}
            />
          )
        }
        inspectorTitle={selected?.name}
        inspectorSubtitle="Logo & watermark"
        onCloseInspector={() => setSelectedId(null)}
        placeholder={
          <InspectorPlaceholder icon={<IconTile name="image" size="lg" />} title="Select a logo">
            Its watermark opens here with a live preview — size, corner, opacity and timing, over a real frame from your
            library.
          </InspectorPlaceholder>
        }
      >
        {error && <Banner className="mb-4">{error}</Banner>}
        {logos == null ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
            ))}
          </div>
        ) : logos.length === 0 ? (
          <EmptyState
            icon="image"
            title="No logos yet"
            description="Upload a channel logo. It's shown in players' guides and as the on-screen watermark."
            action={
              <Button icon="upload" onClick={() => setUploading(true)}>
                Upload a logo
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
            {shown.map((l) => {
              const on = l.id === selectedId
              return (
                // A div acting as a button: the card holds a menu of its own
                // buttons, and a <button> can't contain another.
                <div
                  key={l.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={on}
                  onClick={() => setSelectedId(on ? null : l.id)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      setSelectedId(on ? null : l.id)
                    }
                  }}
                  className={cx(
                    'group cursor-pointer text-left rounded-2xl border overflow-hidden surface-card transition-[border-color,box-shadow]',
                    on ? 'border-indigo-400/70 shadow-[0_0_0_1px_rgb(139_92_246/0.45),0_12px_30px_-14px_rgb(139_92_246/0.6)]' : 'border-edge hover:border-edge-strong',
                  )}
                >
                  {/* The logo is pinned inside a fixed 16:9 frame — as a grid
                      item a tall logo stretched its tile past the others. */}
                  <div className={cx('relative aspect-video border-b border-edge', CHECKER)}>
                    <img
                      src={logoImageUrl(l)}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 m-auto max-h-[72%] max-w-[80%] object-contain drop-shadow-[0_4px_12px_rgb(0_0_0/0.6)] transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                  <div className="px-3.5 py-3 flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium truncate">{l.name}</div>
                      <div className="mt-1">
                        <Badge tone={l.watermark.mode === 'none' ? 'neutral' : 'accent'}>{wmSummary(l.watermark)}</Badge>
                      </div>
                    </div>
                    <span onClick={(e) => e.stopPropagation()}>
                      <Menu
                        items={[
                          { label: 'Edit watermark', icon: 'sliders', onSelect: () => setSelectedId(l.id) },
                          {
                            label: 'Replace image',
                            icon: 'upload',
                            onSelect: () => {
                              setSelectedId(l.id)
                              setTimeout(() => replaceRef.current?.click())
                            },
                          },
                          'divider',
                          { label: 'Delete logo', icon: 'trash', danger: true, onSelect: () => del(l) },
                        ]}
                      />
                    </span>
                  </div>
                </div>
              )
            })}
            {shown.length === 0 && <p className="col-span-full text-[13px] text-ink-faint">No logo matches “{query}”.</p>}
          </div>
        )}
      </Workspace>

      {uploading && (
        <UploadDialog
          title="Upload a logo"
          subtitle="A PNG with transparency looks best on screen."
          icon="image"
          kind="image"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onClose={() => setUploading(false)}
          onUpload={async (name, file) => {
            const dataUrl = await new Promise<string>((res, rej) => {
              const r = new FileReader()
              r.onload = () => res(String(r.result))
              r.onerror = rej
              r.readAsDataURL(file)
            })
            const created = await api.uploadLogo(name, dataUrl)
            toast.success(`Uploaded ${name}`)
            setUploading(false)
            await refresh()
            setSelectedId(created.id)
          }}
        />
      )}
    </>
  )
}
