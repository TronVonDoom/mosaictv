import { useEffect, useMemo, useState } from 'react'
import { api, type Airing, type AiringSegmentInfo, type MediaItem } from '../lib/api'
import { episodeCode, formatDuration } from '../lib/format'
import { toast } from '../lib/toast'
import { Badge, Button, cx, Input, Modal } from './ui'

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
  onSaved?: () => void
  onDirtyChange?: (dirty: boolean) => void
}

function toSeg(e: MediaItem): AiringSegmentInfo {
  return {
    mediaItemId: e.id,
    showTitle: e.showTitle,
    season: e.season,
    episode: e.episode,
    title: e.title,
    durationSec: e.durationSec,
    missing: e.missing,
  }
}

/**
 * Groups a show's episodes into broadcast episodes. A group can also borrow a
 * segment from another show (2 Stupid Dogs pulling in a Secret Squirrel short),
 * with the order within a group under your control. Grouping is metadata only —
 * the files keep their real numbering — and nothing is stored until you Save.
 */
export default function AiringsEditor({
  libraryId,
  show,
  season,
  episodes,
  onSaved,
  onDirtyChange,
}: Props) {
  const orderIndex = useMemo(() => new Map(episodes.map((e, i) => [e.id, i])), [episodes])

  const [blocks, setBlocks] = useState<number[][]>([])
  const [savedGroups, setSavedGroups] = useState<number[][]>([])
  // Metadata for every id we might render — owned episodes plus borrowed ones.
  const [segMeta, setSegMeta] = useState<Map<number, AiringSegmentInfo>>(new Map())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [targetSec, setTargetSec] = useState(22 * 60)
  const [customMin, setCustomMin] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  // The id of a segment in the block we're adding another show's segment to.
  const [pickerFor, setPickerFor] = useState<number | null>(null)

  const isOwned = (id: number) => orderIndex.has(id)
  const minOwnedIdx = (b: number[]) => {
    const owned = b.filter(isOwned).map((id) => orderIndex.get(id) as number)
    return owned.length ? Math.min(...owned) : Number.MAX_SAFE_INTEGER
  }
  const sortBlocks = (bs: number[][]) => [...bs].sort((a, b) => minOwnedIdx(a) - minOwnedIdx(b))

  // Saved airings -> running order: each airing's full ordered segments as one
  // block (positioned by its first owned episode), each unclaimed owned episode
  // a block of one.
  const compose = (airings: Airing[]): number[][] => {
    const claimed = new Set<number>()
    const groups: number[][] = []
    for (const a of airings) {
      const ids = a.segments.map((s) => s.mediaItemId)
      if (ids.length < 2) continue
      ids.forEach((id) => claimed.add(id))
      groups.push(ids)
    }
    const singles = episodes.filter((e) => !claimed.has(e.id)).map((e) => [e.id])
    return sortBlocks([...groups, ...singles])
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .airings(libraryId, show)
      .then(({ airings }) => {
        if (!alive) return
        const scoped = airings.filter((a) => (a.season ?? null) === (season ?? null))
        const meta = new Map<number, AiringSegmentInfo>()
        episodes.forEach((e) => meta.set(e.id, toSeg(e)))
        scoped.forEach((a) => a.segments.forEach((s) => meta.set(s.mediaItemId, s)))
        setSegMeta(meta)
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
    const sel = [...selected]
      .filter(isOwned)
      .sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0))
    if (sel.length < 2) return
    setBlocks((bs) => {
      const stripped: number[][] = []
      for (const b of bs) {
        const remaining = b.filter((id) => !selected.has(id))
        if (remaining.length === 0) continue
        if (remaining.length === 1 && !isOwned(remaining[0])) continue // lone borrowed segment can't stand alone
        stripped.push(remaining)
      }
      stripped.push(sel)
      return sortBlocks(stripped)
    })
    setSelected(new Set())
  }

  // Ungroup: owned episodes return to standalone; borrowed segments are released.
  const ungroup = (target: number[]) =>
    setBlocks((bs) =>
      sortBlocks(bs.flatMap((b) => (b === target ? b.filter(isOwned).map((id) => [id]) : [b]))),
    )

  const replaceBlock = (target: number[], next: number[] | null) =>
    setBlocks((bs) =>
      sortBlocks(bs.flatMap((b) => (b === target ? (next && next.length ? [next] : []) : [b]))),
    )

  const move = (target: number[], id: number, dir: -1 | 1) => {
    const i = target.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= target.length) return
    const nb = [...target]
    ;[nb[i], nb[j]] = [nb[j], nb[i]]
    replaceBlock(target, nb)
  }

  const removeSeg = (target: number[], id: number) => {
    const remaining = target.filter((x) => x !== id)
    // A single borrowed segment can't stand on its own — drop it with the block.
    if (remaining.length === 1 && !isOwned(remaining[0])) return replaceBlock(target, null)
    replaceBlock(target, remaining)
  }

  const addSegment = (seg: AiringSegmentInfo) => {
    if (pickerFor == null) return
    if (blocks.some((b) => b.includes(seg.mediaItemId))) {
      toast.error('That episode is already in the running order')
      return
    }
    setSegMeta((m) => new Map(m).set(seg.mediaItemId, seg))
    setBlocks((bs) =>
      sortBlocks(bs.map((b) => (b.includes(pickerFor) ? [...b, seg.mediaItemId] : b))),
    )
  }

  const suggest = () => {
    api
      .suggestAirings(libraryId, show, season, targetSec)
      .then(({ blocks: proposed }) =>
        setBlocks(sortBlocks(proposed.map((g) => g.filter(isOwned)).filter((g) => g.length > 0))),
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
        back-to-back as a single program and show as one guide entry. Use{' '}
        <span className="text-ink">Add segment from another show</span> to interleave a short from
        a different series. Your files aren't touched.{' '}
        <span className="text-ink-faint">Changes apply the next time a channel builds its
        schedule.</span>
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
            const seg = segMeta.get(b[0])
            if (!seg) return null
            return (
              <div key={'blk' + b[0]} className="rounded-lg border border-edge flex items-stretch">
                <div className="flex-1 min-w-0">
                  <Row
                    seg={seg}
                    show={show}
                    selectable={isOwned(b[0])}
                    checked={selected.has(b[0])}
                    onToggle={() => toggleSel(b[0])}
                  />
                </div>
                <button
                  onClick={() => setPickerFor(b[0])}
                  className="px-3 text-xs text-ink-faint hover:text-indigo-300 border-l border-edge/60 transition-colors"
                  title="Start a broadcast episode by adding a segment from another show"
                >
                  + Add segment
                </button>
              </div>
            )
          }
          const total = b.reduce((a, id) => a + (segMeta.get(id)?.durationSec ?? 0), 0)
          return (
            <div key={'blk' + b[0]} className="rounded-lg border border-indigo-500/40 bg-indigo-500/5">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-xs font-medium text-indigo-300">
                  Broadcast episode · {b.length} segments · {formatDuration(total)}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setPickerFor(b[0])}
                    className="text-xs text-ink-faint hover:text-indigo-300 transition-colors"
                  >
                    + Add segment
                  </button>
                  <button
                    onClick={() => ungroup(b)}
                    className="text-xs text-ink-faint hover:text-rose-400 transition-colors"
                  >
                    Ungroup
                  </button>
                </div>
              </div>
              <div className="divide-y divide-edge/40 border-t border-edge/40">
                {b.map((id, idx) => {
                  const seg = segMeta.get(id)
                  if (!seg) return null
                  return (
                    <Row
                      key={id}
                      seg={seg}
                      show={show}
                      selectable={isOwned(id)}
                      checked={selected.has(id)}
                      onToggle={() => toggleSel(id)}
                      reorder={{
                        up: idx > 0 ? () => move(b, id, -1) : undefined,
                        down: idx < b.length - 1 ? () => move(b, id, 1) : undefined,
                        remove: () => removeSeg(b, id),
                      }}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {pickerFor != null && (
        <SegmentPicker
          libraryId={libraryId}
          show={show}
          onClose={() => setPickerFor(null)}
          onPick={addSegment}
        />
      )}
    </div>
  )
}

function Row({
  seg,
  show,
  selectable,
  checked,
  onToggle,
  reorder,
}: {
  seg: AiringSegmentInfo
  show: string
  selectable: boolean
  checked: boolean
  onToggle: () => void
  reorder?: { up?: () => void; down?: () => void; remove: () => void }
}) {
  const code = episodeCode(seg) || (seg.episode != null ? `E${seg.episode}` : '—')
  const foreign = seg.showTitle !== show
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      {selectable ? (
        <input
          type="checkbox"
          className="accent-indigo-500"
          checked={checked}
          onChange={onToggle}
          title="Select to group"
        />
      ) : (
        <span className="w-[13px]" />
      )}
      <span className="w-14 font-mono text-xs text-ink-faint shrink-0">{code}</span>
      <span className="flex-1 truncate text-sm text-ink flex items-center gap-2">
        <span className="truncate">{seg.title}</span>
        {foreign && (
          <Badge tone="accent" className="shrink-0">
            {seg.showTitle ?? 'Other show'}
          </Badge>
        )}
        {seg.missing && (
          <Badge tone="bad" className="shrink-0">
            missing
          </Badge>
        )}
      </span>
      <span className="text-xs text-ink-muted shrink-0">{formatDuration(seg.durationSec)}</span>
      {reorder && (
        <div className="flex items-center gap-1 shrink-0 text-ink-faint">
          <button
            disabled={!reorder.up}
            onClick={reorder.up}
            className="px-1 hover:text-indigo-300 disabled:opacity-30 disabled:hover:text-ink-faint"
            title="Move up"
          >
            ↑
          </button>
          <button
            disabled={!reorder.down}
            onClick={reorder.down}
            className="px-1 hover:text-indigo-300 disabled:opacity-30 disabled:hover:text-ink-faint"
            title="Move down"
          >
            ↓
          </button>
          <button
            onClick={reorder.remove}
            className="px-1 hover:text-rose-400"
            title="Remove from this broadcast episode"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

function SegmentPicker({
  libraryId,
  show,
  onClose,
  onPick,
}: {
  libraryId: number
  show: string
  onClose: () => void
  onPick: (seg: AiringSegmentInfo) => void
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<AiringSegmentInfo[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    const t = setTimeout(() => {
      api
        .searchAiringEpisodes(libraryId, q)
        .then((r) => alive && setResults(r.episodes))
        .catch(() => alive && setResults([]))
        .finally(() => alive && setLoading(false))
    }, 200)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [libraryId, q])

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-lg p-4 max-h-[80vh] flex flex-col">
      <h3 className="text-sm font-semibold mb-1">Add a segment from another show</h3>
      <p className="text-xs text-ink-faint mb-3">
        Pick the episode that aired inside this broadcast block. It'll be added to the end — reorder
        it with the ↑↓ controls.
      </p>
      <Input
        autoFocus
        placeholder="Search episodes across the library…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-3"
      />
      <div className="flex-1 overflow-y-auto rounded-lg border border-edge divide-y divide-edge/60">
        {loading && results.length === 0 ? (
          <div className="text-ink-faint text-sm px-3 py-4">Searching…</div>
        ) : results.length === 0 ? (
          <div className="text-ink-faint text-sm px-3 py-4">No episodes found.</div>
        ) : (
          results.map((seg) => {
            const code = episodeCode(seg)
            const self = seg.showTitle === show
            return (
              <button
                key={seg.mediaItemId}
                onClick={() => onPick(seg)}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface/60 text-left transition-colors"
              >
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-sm text-ink">
                    {seg.showTitle ?? '—'}
                    {code ? <span className="text-ink-faint font-mono"> {code}</span> : null}
                  </span>
                  <span className="block truncate text-xs text-ink-faint">
                    {seg.title}
                    {self ? ' · this show' : ''}
                  </span>
                </span>
                <span className="text-xs text-ink-muted shrink-0">
                  {formatDuration(seg.durationSec)}
                </span>
              </button>
            )
          })
        )}
      </div>
      <div className="flex justify-end mt-3">
        <Button size="sm" variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  )
}
