import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Filler, type FillerOwner } from '../lib/api'
import { toast } from '../lib/toast'
import FillerEditor, { fillerSummary, fillerStyleLabel } from './FillerEditor'
import { Modal } from './ui'

// Assign fillers from the global library (managed under Media) to a channel
// (its default gap filler) or a time block. Checking a box assigns it; "+ New"
// creates one here and assigns it, so building a filler doesn't mean leaving
// the channel for the Media page and navigating back.
export default function FillerAssignmentPicker({ owner, hint }: { owner: FillerOwner; hint?: string }) {
  const [fillers, setFillers] = useState<Filler[]>([])
  const [assigned, setAssigned] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const ownerKey = owner.channelId ?? owner.timeBlockId

  const load = () => {
    api.fillers().then(setFillers).catch(() => {})
    api.fillerAssignments(owner).then((ids) => setAssigned(new Set(ids))).catch(() => {})
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [ownerKey])

  async function toggle(id: number, on: boolean) {
    setAssigned((prev) => {
      const n = new Set(prev)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
    try {
      if (on) await api.assignFiller(owner, id)
      else await api.unassignFiller(owner, id)
    } catch {
      load() // revert to the server's truth on failure
    }
  }

  // A filler made from here is meant for this owner, so assign it immediately.
  async function createdHere(f: Filler) {
    setCreating(false)
    try {
      await api.assignFiller(owner, f.id)
      toast.success('Filler created and assigned')
    } catch {
      toast.success('Filler created — assign it below')
    }
    load()
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium">
          Assigned fillers {hint && <span className="text-xs text-slate-500 font-normal">({hint})</span>}
        </span>
        <div className="flex items-center gap-3 shrink-0">
          {!creating && (
            <button
              onClick={() => setCreating(true)}
              className="text-xs rounded border border-slate-700 hover:border-indigo-500 hover:text-indigo-300 px-2 py-0.5"
            >
              + New filler
            </button>
          )}
          <Link to="/media#fillers" className="text-xs text-indigo-300 hover:text-indigo-200">Manage library →</Link>
        </div>
      </div>

      {fillers.length === 0 ? (
        <p className="text-xs text-slate-600">
          No fillers in the library yet — make one with <span className="text-slate-400">+ New filler</span>, or
          manage them all under <Link to="/media#fillers" className="text-indigo-300">Media → Fillers</Link>. Gaps
          use the default frosted-glass ident until then.
        </p>
      ) : (
        <div className="space-y-1">
          {fillers.map((f) => {
            const on = assigned.has(f.id)
            return (
              <label
                key={f.id}
                className={
                  'flex items-center gap-2 text-sm rounded px-2.5 py-1.5 border cursor-pointer ' +
                  (on ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-slate-900/60 border-slate-800 hover:border-slate-600')
                }
              >
                <input type="checkbox" checked={on} onChange={(e) => toggle(f.id, e.target.checked)} />
                <span className="flex-1 min-w-0 truncate">{f.name || fillerStyleLabel(f.style)}</span>
                <span className="text-[11px] text-slate-500 shrink-0">{fillerSummary(f)}</span>
              </label>
            )
          })}
          {assigned.size === 0 && (
            <p className="text-[11px] text-slate-600 mt-1">Nothing assigned — gaps use the default frosted-glass ident.</p>
          )}
          {assigned.size > 1 && (
            <p className="text-[11px] text-slate-600 mt-1">{assigned.size} assigned — each gap plays one of them, rotating by start time.</p>
          )}
        </div>
      )}

      {creating && (
        <Modal onClose={() => setCreating(false)} panelClassName="w-full max-w-2xl p-4">
          <h3 className="font-semibold mb-1">New filler</h3>
          <p className="text-xs text-slate-500 mb-3">
            Added to the shared library and assigned to this {owner.channelId != null ? 'channel' : 'block'}.
          </p>
          <FillerEditor onCancel={() => setCreating(false)} onSaved={createdHere} />
        </Modal>
      )}
    </div>
  )
}
