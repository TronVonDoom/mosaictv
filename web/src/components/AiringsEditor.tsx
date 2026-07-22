import { useEffect, useMemo, useState } from 'react'
import { api, type Airing, type MediaItem } from '../lib/api'
import { episodeCode, formatDuration } from '../lib/format'
import { toast } from '../lib/toast'
import { Badge, Button, cx, Input } from './ui'

const TARGET_PRESETS = [
  { label: '11 min', sec: 11 * 60 },
  { label: '22 min', sec: 22 * 60 },
  { label: '30 min', sec: 30 * 60 },
]

type Props = {
  libraryId: number
  show: string
  season: number | null
  /** This season's episodes, already in episode order. */
  episodes: MediaItem[]
  /** Called after a successful save, so the parent can refresh its markers. */
  onSaved?: () => void
  /** Reports whether there are unsaved groupings, to guard leaving the editor. */
  onDirtyChange?: (dirty: boolean) => void
}

/**
 * Groups a show's episode files into "broadcast episodes" — the multi-segment
 * blocks that aired together (Dexter's three shorts, etc.). Editing is local
 * until Save; a block of one is just a normal episode and isn't stored. Grouping
 * is metadata only: the underlying files keep their real S/E numbering.
 */
export default function AiringsEditor({
  libraryId,
  show,
  season,
  episodes,
  onSaved,
  onDirtyChange,
}: Props) {
  const epById = useMemo(() => new Map(episodes.map((e) => [e.id, e])), [episodes])
  const orderIndex = useMemo(() => new Map(episodes.map((e, i) => [e.id, i])), [episodes])

  const [blocks, setBlocks] = useState<number[][]>([])
  const [savedGroups, setSavedGroups] = useState<number[][]>([])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [targetSec, setTargetSec] = useState(22 * 60)
  // Custom target in minutes as typed; '' means "use a preset".
  const [customMin, setCustomMin] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const minIdx = (b: number[]) => Math.min(...b.map((id) => orderIndex.get(id) ?? 1e9))
  const sortBlocks = (bs: number[][]) => [...bs].sort((a, b) => minIdx(a) - minIdx(b))

  // Compose the running order from saved airings; every episode not held by a
  // 2+ airing stands alone.
  const compose = (airings: Airing[]): number[][] => {
    const idToBlock = new Map<number, number[]>()
    for (const a of airings) {
      const ids = a.segmentIds.filter((id) => epById.has(id))
      if (ids.length >= 2) ids.forEach((id) => idToBlock.set(id, ids))
    }
    const emitted = new Set<number[]>()
    const out: number[][] = []
    for (const e of episodes) {
      const b = idToBlock.get(e.id)
      if (b) {
        if (!emitted.has(b)) {
          emitted.add(b)
          out.push(b)
        }
      } else out.push([e.id])
    }
    return out
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .airings(libraryId, show)
      .then(({ airings }) => {
        if (!alive) return
        const scoped = airings.filter((a) => (a.season ?? null) === (season ?? null))
        const composed = compose(scoped)
        setBlocks(composed)
        setSavedGroups(composed.filter((b) => b.length >= 2))
        setSelected(new Set())
      })
      .catch(() => alive && toast.error('Could not load broadcast episodes'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId, show, season, episodes])

  const dirty = useMemo(() => {
    const cur = blocks
      .filter((b) => b.length >= 2)
      .map((b) => b.join(','))
      .sort()
    const sav = savedGroups.map((b) => b.join(',')).sort()
    return JSON.stringify(cur) !== JSON.stringify(sav)
  }, [blocks, savedGroups])

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange])

  const toggleSel = (id: number) =>
    setSelected((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const groupSelected = () => {
    if (selected.size < 2) return
    const sel = [...selected].sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0))
    const stripped: number[][] = []
    for (const b of blocks) {
      const remaining = b.filter((id) => !selected.has(id))
      if (remaining.length === 0) continue
      // A group that loses members down to one becomes a plain episode again.
      if (remaining.length === 1) stripped.push([remaining[0]])
      else stripped.push(remaining)
    }
    stripped.push(sel)
    setBlocks(sortBlocks(stripped))
    setSelected(new Set())
  }

  const ungroup = (block: number[]) => {
    const rest = blocks.filter((b) => b !== block)
    for (const id of block) rest.push([id])
    setBlocks(sortBlocks(rest))
  }

  const suggest = () => {
    api
      .suggestAirings(libraryId, show, season, targetSec)
      .then(({ blocks: proposed }) =>
        setBlocks(
          sortBlocks(
            proposed.map((g) => g.filter((id) => epById.has(id))).filter((g) => g.length > 0),
          ),
        ),
      )
      .catch(() => toast.error('Could not suggest groupings'))
    setSelected(new Set())
  }

  const clearAll = () => {
    setBlocks(sortBlocks(episodes.map((e) => [e.id])))
    setSelected(new Set())
  }

  const save = () => {
    setSaving(true)
    const groups = blocks.filter((b) => b.length >= 2)
    api
      .saveAirings({ libraryId, showTitle: show, season, groups })
      .then(() => {
        toast.success('Broadcast episodes saved')
        setSavedGroups(groups)
        onSaved?.()
      })
      .catch(() => toast.error('Could not save'))
      .finally(() => setSaving(false))
  }

  if (loading) return <div className="text-ink-faint text-sm">Loading…</div>
  if (episodes.length === 0)
    return <div className="text-ink-faint text-sm">No episodes in this season.</div>

  const groupCount = blocks.filter((b) => b.length >= 2).length

  return (
    <div>
      <p className="text-sm text-ink-soft mb-3 max-w-2xl">
        Group the segments that aired together into one broadcast episode — they'll play
        back-to-back as a single program and show as one guide entry. Your files aren't
        touched. <span className="text-ink-faint">Changes apply the next time a channel
        builds its schedule.</span>
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span className="text-sm text-ink-muted">Target length</span>
        {TARGET_PRESETS.map((p) => (
          <Button
            key={p.sec}
            size="sm"
            variant={customMin === '' && targetSec === p.sec ? 'primary' : 'secondary'}
            onClick={() => {
              setCustomMin('')
              setTargetSec(p.sec)
            }}
          >
            {p.label}
          </Button>
        ))}
        <span className="text-sm text-ink-muted ml-1">Custom</span>
        <Input
          type="number"
          min={1}
          placeholder="min"
          value={customMin}
          onChange={(e) => {
            const v = e.target.value
            setCustomMin(v)
            const n = Number(v)
            if (n > 0) setTargetSec(Math.round(n * 60))
          }}
          className={cx('w-20', customMin !== '' && 'border-indigo-500')}
        />
        <Button size="sm" variant="secondary" onClick={suggest}>
          Suggest groupings
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-ink-faint">
          {blocks.length} program{blocks.length === 1 ? '' : 's'} · {groupCount} broadcast episode
          {groupCount === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        {dirty && <Badge tone="warn">Unsaved changes</Badge>}
        <Button size="sm" variant="secondary" disabled={selected.size < 2} onClick={groupSelected}>
          Group selected{selected.size > 0 ? ` (${selected.size})` : ''}
        </Button>
        <Button size="sm" variant="subtle" onClick={clearAll}>
          Clear all
        </Button>
        <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <div className="space-y-2">
        {blocks.map((b) => {
          if (b.length === 1) {
            const ep = epById.get(b[0])
            if (!ep) return null
            return (
              <div key={'blk' + b[0]} className="rounded-lg border border-edge">
                <Row id={b[0]} epById={epById} selected={selected} onToggle={toggleSel} />
              </div>
            )
          }
          const total = b.reduce((a, id) => a + (epById.get(id)?.durationSec ?? 0), 0)
          return (
            <div key={'blk' + b[0]} className="rounded-lg border border-indigo-500/40 bg-indigo-500/5">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-xs font-medium text-indigo-300">
                  Broadcast episode · {b.length} segments · {formatDuration(total)}
                </span>
                <button
                  onClick={() => ungroup(b)}
                  className="text-xs text-ink-faint hover:text-rose-400 transition-colors"
                >
                  Ungroup
                </button>
              </div>
              <div className="divide-y divide-edge/40 border-t border-edge/40">
                {b.map((id) => (
                  <Row key={id} id={id} epById={epById} selected={selected} onToggle={toggleSel} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Row({
  id,
  epById,
  selected,
  onToggle,
}: {
  id: number
  epById: Map<number, MediaItem>
  selected: Set<number>
  onToggle: (id: number) => void
}) {
  const ep = epById.get(id)
  if (!ep) return null
  const code = episodeCode(ep) || (ep.episode != null ? `E${ep.episode}` : '—')
  return (
    <label className="flex items-center gap-3 px-3 py-2 hover:bg-surface/60 cursor-pointer">
      <input
        type="checkbox"
        className="accent-indigo-500"
        checked={selected.has(id)}
        onChange={() => onToggle(id)}
      />
      <span className="w-14 font-mono text-xs text-ink-faint shrink-0">{code}</span>
      <span className="flex-1 truncate text-sm text-ink">{ep.title}</span>
      <span className="text-xs text-ink-muted shrink-0">{formatDuration(ep.durationSec)}</span>
    </label>
  )
}
