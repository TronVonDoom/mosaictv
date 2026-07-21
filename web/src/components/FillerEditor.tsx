import { useEffect, useState } from 'react'
import { api, type Asset, type Filler, type FillerInput } from '../lib/api'
import { errorMessage } from '../lib/errors'
import { Banner, Input, Select } from './ui'

export const emptyFillerDraft: FillerInput = {
  name: '',
  style: 'frosted',
  assetId: null,
  audioAssetId: null,
  durationMode: 'fixed',
  durationSec: 30,
}

// Generated visual presets you can create (custom = an uploaded clip instead).
// Only the polished frosted-glass ident ships for now; the other generated
// looks (logo wall, pulse, animated, vintage, retro) stay defined for when
// they're refined — re-add them here to bring them back.
export const STYLES: { id: FillerInput['style']; label: string; desc: string }[] = [
  { id: 'frosted', label: 'Frosted glass', desc: 'logos scrolling behind blurred glass, sharp logos in front' },
  { id: 'custom', label: 'Custom clip', desc: 'an uploaded video from the Media page' },
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

/**
 * The create/edit form for one filler, owning its own draft state and the save
 * call. Used inline by the library (Media → Fillers) and inside a modal from a
 * channel's Fillers tab, so a filler can be made without leaving the channel.
 */
export default function FillerEditor({
  editId = null,
  initial,
  onCancel,
  onSaved,
}: {
  editId?: number | null
  initial?: FillerInput
  onCancel: () => void
  onSaved: (f: Filler) => void
}) {
  const [draft, setDraft] = useState<FillerInput>(initial ?? emptyFillerDraft)
  const [fillerAssets, setFillerAssets] = useState<Asset[]>([])
  const [audioAssets, setAudioAssets] = useState<Asset[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  }, [])

  function set<K extends keyof FillerInput>(k: K, v: FillerInput[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }

  async function save() {
    // Only a custom filler keeps an asset; a generated one would ignore it.
    const payload = { ...draft, assetId: draft.style === 'custom' ? draft.assetId : null }
    if (payload.style === 'custom' && payload.assetId == null) {
      setError('Pick a clip for a custom filler, or choose a generated visual.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const saved = editId ? await api.updateFiller(editId, payload) : await api.addFiller(payload)
      onSaved(saved)
    } catch (e) {
      setError(errorMessage(e, 'Could not save the filler'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-2">
      {error && <Banner tone="error">{error}</Banner>}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-slate-400">Name (optional)</span>
          <Input className="px-2.5 py-1.5" value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Bumper" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-slate-400">Visual</span>
          <Select className="px-2.5 py-1.5" value={draft.style} onChange={(e) => set('style', e.target.value as FillerInput['style'])}>
            {STYLES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
            {/* Keep an existing retired style selectable so editing something
                else about the filler doesn't silently convert it. */}
            {isLegacyStyle(draft.style) && <option value={draft.style}>{fillerStyleLabel(draft.style)} (retired)</option>}
          </Select>
          <span className="text-[10px] text-slate-500 leading-tight">
            {STYLES.find((s) => s.id === draft.style)?.desc ?? 'a retired look — pick another to change it'}
          </span>
        </label>
        {draft.style === 'custom' && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-slate-400">Clip</span>
            <Select className="px-2.5 py-1.5" value={draft.assetId ?? ''} onChange={(e) => set('assetId', e.target.value ? Number(e.target.value) : null)}>
              <option value="">Pick a filler clip…</option>
              {fillerAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-slate-400">Audio (optional)</span>
          <Select className="px-2.5 py-1.5" value={draft.audioAssetId ?? ''} onChange={(e) => set('audioAssetId', e.target.value ? Number(e.target.value) : null)}>
            <option value="">None</option>
            {audioAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-slate-400">Length</span>
          <Select className="px-2.5 py-1.5" value={draft.durationMode} onChange={(e) => set('durationMode', e.target.value as FillerInput['durationMode'])}>
            <option value="fixed">Fixed</option>
            <option value="audio" disabled={draft.audioAssetId == null}>Match audio</option>
          </Select>
        </label>
        {draft.durationMode === 'fixed' && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-slate-400">Seconds</span>
            <input type="number" min={5} max={600} className="px-2.5 py-1.5" value={draft.durationSec} onChange={(e) => set('durationSec', Number(e.target.value))} />
          </label>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-lg border border-slate-700 hover:border-slate-500 px-3 py-1 text-sm">Cancel</button>
        <button onClick={save} disabled={saving} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 px-4 py-1 text-sm font-medium">
          {saving ? 'Saving…' : editId ? 'Save' : 'Add'}
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Uploaded clips &amp; music live on the Media page. Fillers stretch to fill each gap; the chosen audio is
        baked into generated clips, and “Match audio” makes the loop equal the track length.
      </p>
    </div>
  )
}
