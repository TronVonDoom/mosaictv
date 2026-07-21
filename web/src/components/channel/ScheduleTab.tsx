import { useState } from 'react'
import {
  api,
  parseComingUp,
  DEFAULT_COMINGUP,
  type ChannelDetail,
  type Collection,
  type ComingUpConfig,
} from '../../lib/api'
import { formatDays, minutesToTime } from '../../lib/format'
import ComingUpFields from '../ComingUpFields'
import LogoPicker from '../LogoPicker'
import WeeklyBlockGrid from '../WeeklyBlockGrid'
import { Badge, Button, Card, EmptyState, InfoHint, Input, Section, Select, cx } from '../ui'
import type { ChannelTabProps } from './types'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const PLAYBACK_ORDERS = [
  { value: 'chronological', label: 'in order' },
  { value: 'rotate', label: 'rotate shows' },
  { value: 'shuffle', label: 'shuffle' },
]

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}
function minToTimeStr(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

type BlockForm = {
  collectionId: string
  days: number[]
  start: string
  end: string
  playbackOrder: string
  logoUrl: string
  logoId: number | null
  startMode: string
  comingUp: ComingUpConfig | null
}

const emptyBlock = (): BlockForm => ({
  collectionId: '',
  days: [1, 2, 3, 4, 5],
  start: '18:00',
  end: '21:00',
  playbackOrder: 'chronological',
  logoUrl: '',
  logoId: null,
  startMode: 'soft',
  comingUp: null,
})

/**
 * What plays when: the always-on rotation, plus time blocks that override it
 * during specific day/time windows.
 *
 * A block's fillerMode is deliberately absent from this form — it's edited on
 * the Fillers tab, next to the fillers it governs, and patched on its own.
 */
export default function ScheduleTab({
  channelId,
  ch,
  guard,
  cols,
  onError,
}: ChannelTabProps & { cols: Collection[]; onError: (msg: string) => void }) {
  const [rot, setRot] = useState({
    collectionId: '',
    mode: 'one',
    count: '1',
    playbackOrder: 'chronological',
  })
  const [blk, setBlk] = useState<BlockForm>(emptyBlock())
  const [editingBlock, setEditingBlock] = useState<number | null>(null)

  async function addRotation(e: React.FormEvent) {
    e.preventDefault()
    if (!rot.collectionId) return
    await guard(() =>
      api.addRotation(channelId, {
        collectionId: Number(rot.collectionId),
        mode: rot.mode,
        count: Number(rot.count) || 1,
        playbackOrder: rot.playbackOrder,
      }),
    )
    setRot({ collectionId: '', mode: 'one', count: '1', playbackOrder: 'chronological' })
  }

  function resetBlockForm() {
    setEditingBlock(null)
    setBlk(emptyBlock())
  }

  // Grid click on an empty slot → start a new block prefilled with that day/time.
  function addBlockAt(day: number, startMin: number) {
    setEditingBlock(null)
    setBlk((b) => ({
      ...b,
      collectionId: '',
      days: [day],
      start: minToTimeStr(startMin),
      end: minToTimeStr(Math.min(1439, startMin + 120)),
    }))
  }

  function editBlock(b: ChannelDetail['timeBlocks'][number]) {
    setEditingBlock(b.id)
    setBlk({
      collectionId: String(b.collectionId),
      days: b.days.split(',').map(Number).filter((n) => !Number.isNaN(n)),
      start: minToTimeStr(b.startMinute),
      end: minToTimeStr(b.endMinute),
      playbackOrder: b.playbackOrder,
      logoUrl: b.logoUrl ?? '',
      logoId: b.logoId ?? null,
      startMode: b.startMode ?? 'soft',
      comingUp: parseComingUp(b.comingUp),
    })
  }

  async function submitBlock(e: React.FormEvent) {
    e.preventDefault()
    if (!blk.collectionId || blk.days.length === 0) {
      onError('Pick a collection and at least one day.')
      return
    }
    const payload = {
      collectionId: Number(blk.collectionId),
      days: [...blk.days].sort().join(','),
      startMinute: timeToMin(blk.start),
      endMinute: timeToMin(blk.end),
      playbackOrder: blk.playbackOrder,
      logoUrl: blk.logoUrl || null,
      logoId: blk.logoId,
      startMode: blk.startMode,
      comingUp: blk.comingUp,
    }
    await guard(
      () =>
        editingBlock
          ? api.updateBlock(channelId, editingBlock, payload)
          : api.addBlock(channelId, payload),
      editingBlock ? 'Block updated' : 'Block added',
    )
    resetBlockForm()
  }

  if (cols.length === 0) {
    return (
      <EmptyState
        icon="browse"
        title="Nothing to schedule yet"
        description="A schedule is built from collections — groups of shows or movies you assemble on the Collections tab. Make one first, then come back."
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* ---- Rotation ---- */}
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="font-semibold">Rotation</h2>
          <Badge>optional</Badge>
        </div>
        <p className="text-ink-muted text-sm mb-4">
          The 24/7 default — loops forever, and fills any time a block doesn't claim.{' '}
          <InfoHint>
            Leave this empty for a blocks-only channel; it will simply be off air outside its blocks.
          </InfoHint>
        </p>

        <div className="space-y-2 mb-4">
          {ch.rotationItems.length === 0 && (
            <div className="text-ink-faint text-sm">No rotation items yet.</div>
          )}
          {ch.rotationItems.map((r, i) => (
            <div
              key={r.id}
              className="flex items-center gap-3 text-sm rounded-lg bg-sunken/60 border border-edge px-3 py-2"
            >
              <span className="text-ink-ghost w-5 tabular-nums">{i + 1}</span>
              <span className="flex-1 min-w-0 truncate">{r.collection.name}</span>
              <span className="text-xs text-ink-faint">
                {r.mode === 'multiple' ? `${r.count}×` : '1'} · {r.playbackOrder}
              </span>
              <button
                onClick={() => guard(() => api.deleteRotation(channelId, r.id))}
                className="text-ink-ghost hover:text-rose-400"
                aria-label={`Remove ${r.collection.name} from rotation`}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={addRotation} className="flex flex-wrap gap-2 items-end border-t border-edge pt-4">
          <Select
            className="flex-1 min-w-32"
            value={rot.collectionId}
            onChange={(e) => setRot({ ...rot, collectionId: e.target.value })}
            required
          >
            <option value="">Collection…</option>
            {cols.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select value={rot.mode} onChange={(e) => setRot({ ...rot, mode: e.target.value })}>
            <option value="one">1 at a time</option>
            <option value="multiple">multiple</option>
          </Select>
          {rot.mode === 'multiple' && (
            <Input
              className="w-16"
              type="number"
              min="1"
              value={rot.count}
              onChange={(e) => setRot({ ...rot, count: e.target.value })}
            />
          )}
          <Select
            value={rot.playbackOrder}
            onChange={(e) => setRot({ ...rot, playbackOrder: e.target.value })}
          >
            {PLAYBACK_ORDERS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Button type="submit" size="sm">
            Add
          </Button>
        </form>
      </Card>

      {/* ---- Time blocks ---- */}
      <Card>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="font-semibold">Time blocks</h2>
          <Badge>optional</Badge>
        </div>
        <p className="text-ink-muted text-sm mb-4">
          Scheduled slots for specific days and times, which override the rotation while they're on.{' '}
          <InfoHint>
            Click an empty cell in the grid to start a block at that day and time, or click an existing
            block to edit it. Each block's filler is set on the Fillers tab.
          </InfoHint>
        </p>

        <div className="mb-5">
          <WeeklyBlockGrid blocks={ch.timeBlocks} onEditBlock={editBlock} onAddAt={addBlockAt} />
        </div>

        <div className="space-y-2 mb-4">
          {ch.timeBlocks.map((b) => (
            <div
              key={b.id}
              className={cx(
                'flex items-center gap-3 text-sm rounded-lg border px-3 py-2 transition-colors',
                editingBlock === b.id
                  ? 'border-indigo-500/60 bg-indigo-500/5'
                  : 'bg-sunken/60 border-edge',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="truncate">{b.collection.name}</div>
                <div className="text-xs text-ink-faint">
                  {formatDays(b.days)} · {minutesToTime(b.startMinute)}–{minutesToTime(b.endMinute)} ·{' '}
                  {b.playbackOrder}
                  {b.startMode === 'hard' && ' · hard start'}
                  {(b.logoId || b.logoUrl) && ' · logo'}
                  {b.fillerMode && b.fillerMode !== 'none' && ` · filler: ${b.fillerMode}`}
                  {b.comingUp && ' · up-next'}
                </div>
              </div>
              <button
                onClick={() => editBlock(b)}
                className="text-xs text-ink-faint hover:text-indigo-300"
              >
                Edit
              </button>
              <button
                onClick={() => guard(() => api.deleteBlock(channelId, b.id))}
                className="text-ink-ghost hover:text-rose-400"
                aria-label={`Remove the ${b.collection.name} block`}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <form onSubmit={submitBlock} className="space-y-2 border-t border-edge pt-4">
          {editingBlock && (
            <div className="text-xs text-indigo-300">Editing a block — change values and Save.</div>
          )}

          <div className="flex gap-1">
            {DAY_NAMES.map((d, i) => {
              const on = blk.days.includes(i)
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setBlk({
                      ...blk,
                      days: on ? blk.days.filter((x) => x !== i) : [...blk.days, i],
                    })
                  }
                  className={cx(
                    'flex-1 rounded-md text-xs py-1.5 border transition-colors',
                    on
                      ? 'bg-indigo-500/20 border-indigo-500 text-indigo-200'
                      : 'border-edge-strong text-ink-faint hover:border-ink-faint',
                  )}
                >
                  {d}
                </button>
              )
            })}
          </div>

          <LogoPicker
            value={blk.logoId}
            onChange={(id) => setBlk({ ...blk, logoId: id })}
            noneLabel="On-screen logo: use collection/channel logo"
          />

          <Section title="Coming up next">
            <label className="flex items-center gap-2 text-sm select-none">
              <input
                type="checkbox"
                checked={blk.comingUp != null}
                onChange={(e) =>
                  setBlk({
                    ...blk,
                    comingUp: e.target.checked ? blk.comingUp ?? { ...DEFAULT_COMINGUP } : null,
                  })
                }
              />
              <span className="text-ink-soft">Override “coming up next” for this block</span>
            </label>
            {blk.comingUp ? (
              <div className="mt-3">
                <ComingUpFields cfg={blk.comingUp} onChange={(c) => setBlk({ ...blk, comingUp: c })} />
              </div>
            ) : (
              <p className="text-xs text-ink-faint mt-1">
                Uses the channel's setting from the General tab. Check this to give the block its own —
                including turning the caption off for this block only.
              </p>
            )}
          </Section>

          <div className="flex flex-wrap gap-2 items-end">
            <Select
              className="flex-1 min-w-32"
              value={blk.collectionId}
              onChange={(e) => setBlk({ ...blk, collectionId: e.target.value })}
              required
            >
              <option value="">Collection…</option>
              {cols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Input
              type="time"
              aria-label="Block start time"
              value={blk.start}
              onChange={(e) => setBlk({ ...blk, start: e.target.value })}
            />
            <Input
              type="time"
              aria-label="Block end time"
              value={blk.end}
              onChange={(e) => setBlk({ ...blk, end: e.target.value })}
            />
            <Select
              value={blk.playbackOrder}
              onChange={(e) => setBlk({ ...blk, playbackOrder: e.target.value })}
            >
              {PLAYBACK_ORDERS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select
              value={blk.startMode}
              onChange={(e) => setBlk({ ...blk, startMode: e.target.value })}
              title="Soft: starts at the next programme boundary. Hard: starts exactly on time, filling the gap before it."
            >
              <option value="soft">soft start</option>
              <option value="hard">hard start</option>
            </Select>
            <Button type="submit" size="sm">
              {editingBlock ? 'Save' : 'Add'}
            </Button>
            {editingBlock && (
              <Button type="button" variant="secondary" size="sm" onClick={resetBlockForm}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>
    </div>
  )
}
