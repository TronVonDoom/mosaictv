import { useEffect, useState } from 'react'
import { api, assetFileUrl, type Asset, type Filler, type FillerInput, type FillerOwner } from '../lib/api'

const inp = 'rounded-lg bg-slate-950 border border-slate-700 px-2.5 py-1.5 text-sm focus:border-indigo-500 outline-none'
const emptyDraft: FillerInput = { name: '', style: 'frosted', assetId: null, audioAssetId: null, durationMode: 'fixed', durationSec: 30 }

// Manage the filler pool for a channel or a time block (branded interstitials
// played during gaps). Generated styles bake the chosen audio in.
export default function FillerManager({ owner, hint }: { owner: FillerOwner; hint?: string }) {
  const [fillers, setFillers] = useState<Filler[]>([])
  const [fillerAssets, setFillerAssets] = useState<Asset[]>([])
  const [audioAssets, setAudioAssets] = useState<Asset[]>([])
  const [draft, setDraft] = useState<FillerInput>(emptyDraft)
  const [editId, setEditId] = useState<number | null>(null)
  const [open, setOpen] = useState(false)
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [generatingId, setGeneratingId] = useState<number | null>(null)
  const [genError, setGenError] = useState<string | null>(null)

  const ownerKey = owner.channelId ?? owner.timeBlockId
  const refresh = () => api.fillers(owner).then(setFillers).catch(() => {})
  useEffect(() => {
    refresh()
    api.assets('filler').then(setFillerAssets).catch(() => {})
    api.assets('audio').then(setAudioAssets).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey])

  function set<K extends keyof FillerInput>(k: K, v: FillerInput[K]) {
    setDraft((d) => ({ ...d, [k]: v }))
  }
  function startNew() {
    setEditId(null)
    setDraft(emptyDraft)
    setOpen(true)
  }
  function startEdit(f: Filler) {
    setEditId(f.id)
    setDraft({ name: f.name, style: f.style, assetId: f.assetId, audioAssetId: f.audioAssetId, durationMode: f.durationMode, durationSec: f.durationSec })
    setOpen(true)
  }
  async function save() {
    const payload = { ...draft, assetId: draft.style === 'custom' ? draft.assetId : null }
    if (editId) await api.updateFiller(editId, payload).catch(() => {})
    else await api.addFiller(owner, payload).catch(() => {})
    setOpen(false)
    setEditId(null)
    setDraft(emptyDraft)
    refresh()
  }
  async function del(id: number) {
    await api.deleteFiller(id).catch(() => {})
    if (previewId === id) setPreviewId(null)
    refresh()
  }
  async function generate(id: number) {
    setGeneratingId(id)
    setGenError(null)
    try {
      await api.generateFillerClip(id)
      await refresh()
      setPreviewId(id)
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Generation failed')
    } finally {
      setGeneratingId(null)
    }
  }

  const audioName = (id: number | null) => audioAssets.find((a) => a.id === id)?.name
  const clipName = (id: number | null) => fillerAssets.find((a) => a.id === id)?.name

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Fillers {hint && <span className="text-xs text-slate-500 font-normal">({hint})</span>}</span>
        {!open && <button onClick={startNew} className="text-xs rounded border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 px-2 py-0.5">+ Add filler</button>}
      </div>
      {genError && <div className="text-xs text-rose-400 mb-2">{genError}</div>}

      {fillers.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {fillers.map((f) => (
            <div key={f.id}>
              <div className="flex items-center gap-2 text-sm rounded bg-slate-900/60 border border-slate-800 px-2.5 py-1.5">
                <span className="flex-1 min-w-0 truncate">
                  {f.name || (f.style === 'custom' ? clipName(f.assetId) ?? 'Custom clip' : f.style === 'frosted' ? 'Frosted glass' : 'Animated')}
                </span>
                <span className="text-[11px] text-slate-500 shrink-0">
                  {f.style} · {f.durationMode === 'audio' ? 'match audio' : `${f.durationSec}s`}
                  {f.audioAssetId != null && ` · 🎵 ${audioName(f.audioAssetId) ?? 'audio'}`}
                </span>
                {generatingId === f.id ? (
                  <span className="text-xs text-indigo-300 shrink-0 inline-flex items-center gap-1">
                    <span className="inline-block w-3 h-3 border-2 border-indigo-400/40 border-t-indigo-300 rounded-full animate-spin" />
                    Generating…
                  </span>
                ) : f.generatedAssetId != null ? (
                  <>
                    <button onClick={() => setPreviewId(previewId === f.id ? null : f.id)} className="text-xs text-slate-400 hover:text-indigo-300">{previewId === f.id ? 'Hide' : 'Preview'}</button>
                    <button onClick={() => generate(f.id)} className="text-xs text-slate-400 hover:text-indigo-300" title="Rebuild after changing settings">Regenerate</button>
                  </>
                ) : (
                  <button onClick={() => generate(f.id)} disabled={generatingId != null} className="text-xs text-indigo-300 hover:text-indigo-200 disabled:opacity-40">Generate</button>
                )}
                <button onClick={() => startEdit(f)} className="text-xs text-slate-400 hover:text-indigo-300">Edit</button>
                <button onClick={() => del(f.id)} className="text-slate-600 hover:text-rose-400" aria-label="Delete">×</button>
              </div>
              {generatingId === f.id && (
                <p className="text-[11px] text-slate-500 mt-1 px-1">Building the clip (frosted can take ~20–40s). It's saved to the Media page when done.</p>
              )}
              {previewId === f.id && f.generatedAssetId != null && (
                <div className="mt-1.5 rounded border border-slate-800 bg-black p-2">
                  <video key={f.generatedAssetId} controls src={assetFileUrl(f.generatedAssetId)} className="w-full max-h-64 rounded" />
                  <p className="text-[11px] text-slate-500 mt-1">This is the exact clip that plays — saved on the Media page as a filler asset. Regenerate after changing the settings.</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="rounded border border-indigo-500/30 bg-indigo-500/5 p-3 space-y-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-slate-400">Name (optional)</span>
              <input className={inp} value={draft.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Bumper" />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-slate-400">Visual</span>
              <select className={inp} value={draft.style} onChange={(e) => set('style', e.target.value as FillerInput['style'])}>
                <option value="frosted">Frosted glass (this logo + app logo)</option>
                <option value="animated">Animated</option>
                <option value="custom">Custom clip</option>
              </select>
            </label>
            {draft.style === 'custom' && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-slate-400">Clip</span>
                <select className={inp} value={draft.assetId ?? ''} onChange={(e) => set('assetId', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">Pick a filler clip…</option>
                  {fillerAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-slate-400">Audio (optional)</span>
              <select className={inp} value={draft.audioAssetId ?? ''} onChange={(e) => set('audioAssetId', e.target.value ? Number(e.target.value) : null)}>
                <option value="">None</option>
                {audioAssets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-slate-400">Length</span>
              <select className={inp} value={draft.durationMode} onChange={(e) => set('durationMode', e.target.value as FillerInput['durationMode'])}>
                <option value="fixed">Fixed</option>
                <option value="audio" disabled={draft.audioAssetId == null}>Match audio</option>
              </select>
            </label>
            {draft.durationMode === 'fixed' && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="text-slate-400">Seconds</span>
                <input type="number" min={5} max={600} className={inp} value={draft.durationSec} onChange={(e) => set('durationSec', Number(e.target.value))} />
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => { setOpen(false); setEditId(null) }} className="rounded-lg border border-slate-700 hover:border-slate-500 px-3 py-1 text-sm">Cancel</button>
            <button onClick={save} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-4 py-1 text-sm font-medium">{editId ? 'Save' : 'Add'}</button>
          </div>
          <p className="text-[11px] text-slate-500">Uploaded clips &amp; music live on the Media page. Fillers stretch to fill each gap; the chosen audio is baked into generated clips, and “Match audio” makes the loop equal the track length.</p>
        </div>
      )}

      {fillers.length === 0 && !open && <p className="text-xs text-slate-600">No fillers — uses the global default during gaps.</p>}
    </div>
  )
}
