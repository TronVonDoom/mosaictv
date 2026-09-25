import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Filler, type FillerOwner } from '../lib/api'
import { toast } from '../lib/toast'
import FillerEditor, { fillerSummary, fillerStyleLabel } from './FillerEditor'
import { Button, Modal } from './ui'

// Assign fillers from the shared library to a channel (its default gap filler)
// or a time block. Checking a box assigns it; "+ New" creates one here and
// assigns it, so building a filler doesn't mean leaving the channel. Editing
// isn't done here — each filler would show up in every block's list — but
// once, from the channel's "Fillers on this channel" list (or the Studio).
// `reloadKey` changing re-reads the library (after an edit elsewhere on the
// page); `onChange` reports an assignment made or a filler created here.
export default function FillerAssignmentPicker({
  owner,
  hint,
  reloadKey = 0,
  onChange,
}: {
  owner: FillerOwner
  hint?: string
  reloadKey?: number
  onChange?: () => void
}) {
  const [fillers, setFillers] = useState<Filler[]>([])
  const [assigned, setAssigned] = useState<Set<number>>(new Set())
  const [creating, setCreating] = useState(false)
  const [defaultId, setDefaultId] = useState<number | null>(null)
  const ownerKey = owner.channelId ?? owner.timeBlockId

  const load = () => {
    api.fillers().then(setFillers).catch(() => {})
    api.fillerAssignments(owner).then((ids) => setAssigned(new Set(ids))).catch(() => {})
    api.settings().then((s) => setDefaultId(s.defaultFillerId)).catch(() => {})
  }
  // What fills this owner's gaps when nothing is assigned: a block falls back
  // to its channel's fillers; a channel to the default station ident, else the
  // frosted-glass ident built from its logo.
  const defaultFiller = fillers.find((f) => f.id === defaultId)
  const fallback = owner.timeBlockId != null
    ? "the channel's fillers"
    : defaultFiller
      ? `the default station ident, “${defaultFiller.name || fillerStyleLabel(defaultFiller.style)}”`
      : 'the frosted-glass ident built from its logo'
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [ownerKey, reloadKey])

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
      onChange?.()
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
    onChange?.()
  }

  return (
    <div className="rounded-xl border border-edge bg-sunken/60 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium">
          Assigned fillers {hint && <span className="text-xs text-ink-faint font-normal">({hint})</span>}
        </span>
        <div className="flex items-center gap-3 shrink-0">
          {!creating && (
            <Button variant="secondary" size="sm" icon="plus" onClick={() => setCreating(true)}>
              New filler
            </Button>
          )}
          <Link to="/studio#fillers" className="text-xs text-indigo-300 hover:text-indigo-200">Manage library →</Link>
        </div>
      </div>

      {fillers.length === 0 ? (
        <p className="text-xs text-ink-faint">
          No fillers in the library yet — make one with <span className="text-ink-muted">+ New filler</span>, or
          manage them all under <Link to="/studio#fillers" className="text-indigo-300">Studio → Fillers</Link>. Gaps
          use {fallback} until then.
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
                  (on ? 'bg-indigo-500/10 border-indigo-500/40' : 'bg-surface/60 border-edge hover:border-ink-ghost')
                }
              >
                <input type="checkbox" checked={on} onChange={(e) => toggle(f.id, e.target.checked)} />
                <span className="flex-1 min-w-0 truncate">{f.name || fillerStyleLabel(f.style)}</span>
                <span className="text-[11px] text-ink-faint shrink-0">{fillerSummary(f)}</span>
              </label>
            )
          })}
          {assigned.size === 0 && (
            <p className="text-[11px] text-ink-faint mt-1">Nothing assigned — gaps use {fallback}.</p>
          )}
          {assigned.size > 1 && (
            <p className="text-[11px] text-ink-faint mt-1">{assigned.size} assigned — breaks take turns through them, in the order they were added.</p>
          )}
        </div>
      )}

      {creating && (
        <Modal onClose={() => setCreating(false)} panelClassName="w-full max-w-2xl p-4">
          <h3 className="font-semibold mb-1">New filler</h3>
          <p className="text-xs text-ink-faint mb-3">
            Added to the shared library and assigned to this {owner.channelId != null ? 'channel' : 'block'}.
          </p>
          <FillerEditor previewOwner={owner} onCancel={() => setCreating(false)} onSaved={createdHere} />
        </Modal>
      )}
    </div>
  )
}
