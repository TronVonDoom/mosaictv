import { useEffect, useRef, useState } from 'react'
import { api, type Asset, type Filler, type FillerInput, type FillerOwner } from '../lib/api'
import { errorMessage } from '../lib/errors'
import LogoPicker from './LogoPicker'
import { Banner, Field, Input, Section, Select } from './ui'

export const emptyFillerDraft: FillerInput = {
  name: '',
  style: 'frosted',
  assetId: null,
  audioAssetId: null,
  logoId: null,
  durationMode: 'fixed',
  durationSec: 30,
  resolution: '1080p',
  logoScale: 1,
}

// Styles whose generated clip is branded with a logo — the only ones for which
// a logo override / logo size makes sense (a custom clip carries its own artwork).
const LOGO_STYLES = new Set(['frosted', 'spotlight', 'logowall', 'pulse'])

// Generated visual presets you can create (custom = an uploaded clip instead).
// The retired looks (logo wall, pulse, animated, vintage, retro) stay defined
// for when they're refined — re-add them here to bring them back.
export const STYLES: { id: FillerInput['style']; label: string; desc: string }[] = [
  { id: 'frosted', label: 'Frosted glass', desc: 'logos scrolling behind blurred glass, sharp logos in front' },
  { id: 'spotlight', label: 'Spotlight', desc: 'a lit glass card with a sweeping gleam, logo above the wordmark' },
  { id: 'custom', label: 'Custom clip', desc: 'an uploaded video from the Studio page' },
]

const RESOLUTIONS: { id: FillerInput['resolution']; label: string }[] = [
  { id: '720p', label: '720p · HD' },
  { id: '1080p', label: '1080p · Full HD' },
  { id: '1440p', label: '1440p · QHD' },
]

// Display names, including the retired styles that older rows may still carry.
const LEGACY_LABELS: Record<string, string> = {
  animated: 'Animated',
  logowall: 'Logo wall',
  pulse: 'Logo pulse',
  retro: 'Retro bars',
  vintage: 'Vintage',
}
export const fillerStyleLabel = (s: string): string =>
  STYLES.find((x) => x.id === s)?.label ?? LEGACY_LABELS[s] ?? s
/** Retired styles can still be played and displayed, just not created. */
export const isLegacyStyle = (s: string): boolean => s in LEGACY_LABELS

/** One-line summary of a filler, shared by the library and the assignment list. */
export function fillerSummary(f: Filler): string {
  const len = f.durationMode === 'audio' ? 'match audio' : `${f.durationSec}s`
  return `${fillerStyleLabel(f.style)} · ${len}`
}

// The render-affecting inputs that change how a still looks — when any of these
// change, an existing still preview no longer matches and is cleared.
const stillKey = (d: FillerInput) => `${d.style}:${d.assetId}:${d.logoId}:${d.logoScale}:${d.resolution}`

/**
 * The create/edit form for one filler, owning its own draft state and the save
 * call. Used inline by the library (Studio → Fillers) and inside a modal from a
 * channel's Fillers tab, so a filler can be made without leaving the channel.
 *
 * `previewOwner` is whose logo the still preview is branded with — the channel
 * picked in the library, or the channel/block a modal was opened from.
 */
export default function FillerEditor({
  editId = null,
  initial,
  previewOwner,
  onCancel,
  onSaved,
}: {
  editId?: number | null
  initial?: FillerInput
  previewOwner?: FillerOwner
  onCancel: () => void
  onSaved: (f: Filler) => void
}) {
  const [draft, setDraft] = useState<FillerInput>(initial ?? emptyFillerDraft)
  const [fillerAssets, setFillerAssets] = useState<Asset[]>([])
  const [audioAssets, setAudioAssets] = useState<Asset[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Still preview: a blob object URL (revoked when replaced/unmounted so nothing
  // leaks), plus its loading and error state.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewUrlRef = useRef<string | null>(null)

  const setPreview = (url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = url
    setPreviewUrl(url)
  }

  useEffect(() => {
    // Only real uploads are choosable as a custom clip — a generated one is
    // already the output of another filler. An existing pick is kept either way
    // so opening the form can't silently clear it.
    api
      .assets('filler')
      .then((a) => setFillerAssets(a.filter((x) => !x.generated || x.id === initial?.assetId)))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
    api.assets('audio').then(setAudioAssets).catch(() => {})
    return () => setPreview(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A stale still (from before the look was changed) would mislead — drop it
  // whenever a render-affecting field changes.
  const key = stillKey(draft)
  useEffect(() => {
    setPreview(null)
    setPreviewError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  function set<K extends keyof FillerInput>(k: K, v: FillerInput[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }

  // Only a custom filler keeps its clip asset; a generated one would ignore it.
  const payload = (): FillerInput => ({ ...draft, assetId: draft.style === 'custom' ? draft.assetId : null })

  const isLogoStyle = LOGO_STYLES.has(draft.style)
  // A custom filler can only be previewed once it has a clip to grab a frame from.
  const canPreview = draft.style !== 'custom' || draft.assetId != null

  async function preview() {
    setPreviewing(true)
    setPreviewError(null)
    try {
      const blob = await api.fillerPreviewImage(payload(), previewOwner)
      setPreview(URL.createObjectURL(blob))
    } catch (e) {
      setPreviewError(errorMessage(e, 'Could not build a preview'))
    } finally {
      setPreviewing(false)
    }
  }

  async function save() {
    const body = payload()
    if (body.style === 'custom' && body.assetId == null) {
      setError('Pick a clip for a custom filler, or choose a generated visual.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = editId ? await api.updateFiller(editId, body) : await api.addFiller(body)
      onSaved(saved)
    } catch (e) {
      setError(errorMessage(e, 'Could not save the filler'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-3">
      {error && <Banner tone="error">{error}</Banner>}

      <Section title="Look">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name (optional)">
            <Input value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Bumper" />
          </Field>
          <Field
            label="Visual"
            hint={STYLES.find((s) => s.id === draft.style)?.desc ?? 'a retired look — pick another to change it'}
          >
            <Select value={draft.style} onChange={(e) => set('style', e.target.value as FillerInput['style'])}>
              {STYLES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
              {/* Keep an existing retired style selectable so editing something
                  else about the filler doesn't silently convert it. */}
              {isLegacyStyle(draft.style) && <option value={draft.style}>{fillerStyleLabel(draft.style)} (retired)</option>}
            </Select>
          </Field>
          {draft.style === 'custom' && (
            <Field label="Clip" className="sm:col-span-2">
              <Select value={draft.assetId ?? ''} onChange={(e) => set('assetId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">Pick a filler clip…</option>
                {fillerAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
          )}
        </div>
      </Section>

      {isLogoStyle && (
        <Section title="Branding">
          <div className="grid grid-cols-1 gap-3">
            {/* Not a <Field>: LogoPicker has its own <label> (the upload button),
                and nesting labels would misroute clicks. */}
            <div className="flex flex-col gap-1 text-sm">
              <span className="text-ink-muted">Logo</span>
              <LogoPicker value={draft.logoId ?? null} onChange={(id) => set('logoId', id)} noneLabel="Use the channel / block logo" />
              <span className="text-xs text-ink-faint">
                Brands this filler with a specific logo everywhere it airs. Leave on “Use the channel / block logo”
                to keep taking each channel or block’s own logo.
              </span>
            </div>
            <Field label={<span className="flex justify-between">Logo size<span className="text-ink-faint tabular-nums">{Math.round(draft.logoScale * 100)}%</span></span>}>
              <input
                type="range"
                min={0.4}
                max={2}
                step={0.05}
                value={draft.logoScale}
                onChange={(e) => set('logoScale', Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
            </Field>
          </div>
        </Section>
      )}

      <Section title="Audio & timing">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Audio (optional)">
            <Select value={draft.audioAssetId ?? ''} onChange={(e) => set('audioAssetId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">None</option>
              {audioAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Length">
            <Select value={draft.durationMode} onChange={(e) => set('durationMode', e.target.value as FillerInput['durationMode'])}>
              <option value="fixed">Fixed</option>
              <option value="audio" disabled={draft.audioAssetId == null}>Match audio</option>
            </Select>
          </Field>
          {draft.durationMode === 'fixed' && (
            <Field label="Seconds">
              <Input type="number" min={5} max={600} value={draft.durationSec} onChange={(e) => set('durationSec', Number(e.target.value))} />
            </Field>
          )}
        </div>
      </Section>

      {draft.style !== 'custom' && (
        <Section title="Quality">
          <Field
            label="Resolution"
            hint="Higher looks sharper on HD channels but takes longer to generate. Playback still scales to each channel’s own resolution."
            className="sm:max-w-xs"
          >
            <Select value={draft.resolution} onChange={(e) => set('resolution', e.target.value as FillerInput['resolution'])}>
              {RESOLUTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
          </Field>
        </Section>
      )}

      <Section title="Preview">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="w-full sm:w-64 aspect-video rounded-lg border border-edge bg-black overflow-hidden grid place-items-center shrink-0">
            {previewUrl ? (
              <img src={previewUrl} alt="Filler preview" className="w-full h-full object-contain" />
            ) : (
              <span className="text-[11px] text-ink-faint px-3 text-center">
                {previewing ? 'Rendering a frame…' : 'A still frame of this filler will appear here.'}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-[12rem] space-y-2">
            <button
              onClick={preview}
              disabled={previewing || !canPreview}
              className="rounded-lg border border-edge-strong hover:border-indigo-500 hover:text-indigo-300 disabled:opacity-50 px-3 py-1.5 text-sm"
            >
              {previewing ? 'Rendering…' : previewUrl ? 'Refresh preview' : 'Preview image'}
            </button>
            <p className="text-[11px] text-ink-faint leading-tight">
              {canPreview
                ? 'A single frame, rendered in a second or two — check the look before committing to a full clip. Nothing is saved.'
                : 'Pick a clip above to preview a custom filler.'}
            </p>
            {previewError && <p className="text-[11px] text-rose-400">{previewError}</p>}
          </div>
        </div>
      </Section>

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-edge-strong hover:border-ink-faint px-3 py-1.5 text-sm">Cancel</button>
        <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 px-4 py-1.5 text-sm font-medium">
          {saving ? 'Saving…' : editId ? 'Save' : 'Add'}
        </button>
      </div>
      <p className="text-[11px] text-ink-faint">
        Uploaded clips &amp; music live on the Studio page. Fillers stretch to fill each gap; the chosen audio is
        baked into generated clips, and “Match audio” makes the loop equal the track length.
      </p>
    </div>
  )
}
