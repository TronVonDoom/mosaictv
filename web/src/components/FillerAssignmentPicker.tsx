import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Filler, type FillerOwner } from '../lib/api'

const styleLabel: Record<string, string> = {
  frosted: 'Frosted glass',
  custom: 'Custom clip',
  animated: 'Animated',
  logowall: 'Logo wall',
  pulse: 'Logo pulse',
  retro: 'Retro bars',
  vintage: 'Vintage',
}

// Assign fillers from the global library (managed under Media) to a channel
// (its default gap filler) or a time block. Checking a box assigns it.
export default function FillerAssignmentPicker({ owner, hint }: { owner: FillerOwner; hint?: string }) {
  const [fillers, setFillers] = useState<Filler[]>([])
  const [assigned, setAssigned] = useState<Set<number>>(new Set())
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

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">
          Assigned fillers {hint && <span className="text-xs text-slate-500 font-normal">({hint})</span>}
        </span>
        <Link to="/media" className="text-xs text-indigo-300 hover:text-indigo-200">Manage library →</Link>
      </div>
      {fillers.length === 0 ? (
        <p className="text-xs text-slate-600">
          No fillers in the library yet — create some under{' '}
          <Link to="/media" className="text-indigo-300">Media → Fillers</Link>. Gaps use the default
          frosted-glass ident until then.
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
                <span className="flex-1 min-w-0 truncate">{f.name || styleLabel[f.style] || f.style}</span>
                <span className="text-[11px] text-slate-500 shrink-0">
                  {styleLabel[f.style] ?? f.style} · {f.durationMode === 'audio' ? 'match audio' : `${f.durationSec}s`}
                </span>
              </label>
            )
          })}
          {assigned.size === 0 && (
            <p className="text-[11px] text-slate-600 mt-1">Nothing assigned — gaps use the default frosted-glass ident.</p>
          )}
        </div>
      )}
    </div>
  )
}
