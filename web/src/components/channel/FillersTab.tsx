import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Filler, type FillerOwner } from '../../lib/api'
import { errorMessage } from '../../lib/errors'
import { formatDays, minutesToTime } from '../../lib/format'
import { toast } from '../../lib/toast'
import FillerAssignmentPicker from '../FillerAssignmentPicker'
import FillerEditor, { blockLabel, draftOf, fillerStyleLabel, fillerSummary, otherChannels } from '../FillerEditor'
import { Badge, Banner, Button, Card, InfoHint, Modal, ModalHeader, Select } from '../ui'
import type { ChannelTabProps } from './types'

const fillerName = (f: Filler) => f.name || fillerStyleLabel(f.style)

/**
 * What plays in the gaps. Filler only ever enters the schedule from a block
 * that fills its leftover time, or from the gap a "hard start" block leaves in
 * front of it — so this tab leads with a warning when the schedule opens no
 * filler slots at all, rather than letting assignments sit here doing nothing.
 */
export default function FillersTab({
  channelId,
  ch,
  guard,
  onGoToSchedule,
}: Omit<ChannelTabProps, 'drafts'> & { onGoToSchedule: () => void }) {
  const makesFillerSlots = ch.timeBlocks.some(
    (b) => (b.fillerMode || 'none') !== 'none' || b.startMode === 'hard',
  )

  // Filler mode saves on its own — patching just this field avoids clobbering
  // an edit in progress on the Schedule tab.
  const setBlockFillerMode = (blockId: number, fillerMode: string) =>
    guard(() => api.updateBlock(channelId, blockId, { fillerMode }), 'Filler mode saved')

  // The library, with where each filler airs — for the list of this channel's
  // fillers. `version` bumps after an edit here so the pickers below re-read.
  const [fillers, setFillers] = useState<Filler[] | null>(null)
  const [defaultId, setDefaultId] = useState<number | null>(null)
  const [version, setVersion] = useState(0)
  const [editing, setEditing] = useState<Filler | null>(null)
  const [copying, setCopying] = useState(false)
  const load = () => {
    api.fillers().then(setFillers).catch(() => setFillers((x) => x ?? []))
    api.settings().then((s) => setDefaultId(s.defaultFillerId)).catch(() => {})
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [channelId])
  const changed = () => {
    load()
    setVersion((v) => v + 1)
  }

  const usesHere = (f: Filler) => (f.usedOn ?? []).filter((u) => u.channelId === channelId)
  const onChannel = (fillers ?? []).filter((f) => usesHere(f).length > 0)
  // With no channel-level fillers, the channel's own slots fall back to the
  // default station ident — so it airs here too, and belongs in the list.
  const hasChannelDefault = onChannel.some((f) => usesHere(f).some((u) => !u.block))
  const defaultIdent = !hasChannelDefault ? (fillers ?? []).find((f) => f.id === defaultId) : undefined
  const listed = defaultIdent && !onChannel.includes(defaultIdent) ? [...onChannel, defaultIdent] : onChannel

  // Brand the editor's preview with where it airs here: the channel if it's
  // the channel default (or the default ident), else the first block it's in.
  const ownerHere = (f: Filler): FillerOwner => {
    const uses = usesHere(f)
    const block = uses.length > 0 && uses.every((u) => u.block) ? uses[0].block : null
    return block ? { timeBlockId: block.id } : { channelId }
  }
  const whereHere = (f: Filler): string => {
    const uses = usesHere(f)
    if (uses.length === 0) return 'the default station ident — airs here because this channel has no fillers of its own'
    const blocks = uses.filter((u) => u.block)
    return [
      uses.some((u) => !u.block) ? 'channel default' : '',
      blocks.length === 1 && blocks[0].block ? `the ${blockLabel(blocks[0].block)} block` : blocks.length > 1 ? `${blocks.length} blocks` : '',
    ]
      .filter(Boolean)
      .join(' + ')
  }

  async function copyForHere(f: Filler) {
    setCopying(true)
    try {
      const copy = await api.copyFillerForChannel(f.id, channelId)
      toast.success(`This channel now has its own copy, “${fillerName(copy)}” — the others keep “${fillerName(f)}”`)
      setEditing(copy)
      changed()
    } catch (e) {
      toast.error(errorMessage(e, 'Could not make a copy'))
    } finally {
      setCopying(false)
    }
  }

  return (
    <div className="space-y-6">
      {!makesFillerSlots && (
        <Banner tone="warn">
          <strong className="font-semibold">Nothing on this channel plays filler yet.</strong> A filler
          only airs in a slot the schedule opens for it: a time block with its filler turned on below, or
          the gap before a “hard start” block. Until then, anything assigned here sits unused.
          {ch.timeBlocks.length === 0 && (
            <>
              {' '}
              Add a time block on the{' '}
              <button
                type="button"
                onClick={onGoToSchedule}
                className="underline hover:text-amber-200"
              >
                Schedule tab
              </button>{' '}
              to get started.
            </>
          )}
        </Banner>
      )}

      <Card>
        <h2 className="font-semibold mb-1">Fillers on this channel</h2>
        <p className="text-ink-muted text-sm mb-3">
          Every filler that airs here, once each. Editing one here is the same as editing it in{' '}
          <Link to="/studio#fillers" className="text-indigo-300 hover:text-indigo-200">
            Studio → Fillers
          </Link>{' '}
          — it’s one filler, wherever it’s used.
        </p>
        {fillers == null ? null : listed.length === 0 ? (
          <p className="text-xs text-ink-faint">
            None yet — tick one below, or make one with <span className="text-ink-muted">New filler</span>. Until
            then, breaks use the frosted-glass ident built from this channel’s logo.
          </p>
        ) : (
          <div className="space-y-1.5">
            {listed.map((f) => {
              const others = otherChannels(f.usedOn, channelId)
              return (
                <div key={f.id} className="flex items-center gap-3 rounded-xl border border-edge bg-sunken/60 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">
                      {fillerName(f)} <span className="text-[11px] text-ink-faint">{fillerSummary(f)}</span>
                    </div>
                    <div className="text-[11.5px] text-ink-faint truncate">Here: {whereHere(f)}</div>
                  </div>
                  {others > 0 && (
                    <Badge tone="info" title="Editing it changes it there too">
                      Also on {others} other channel{others === 1 ? '' : 's'}
                    </Badge>
                  )}
                  {f.id === defaultId && usesHere(f).length === 0 && <Badge tone="accent">Default ident</Badge>}
                  <Button variant="secondary" size="sm" icon="edit" onClick={() => setEditing(f)}>
                    Edit
                  </Button>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-semibold mb-1">Channel default</h2>
        <p className="text-ink-muted text-sm mb-3">
          Plays in any filler slot where the active block has none of its own.
        </p>
        <FillerAssignmentPicker owner={{ channelId }} hint="channel default" reloadKey={version} onChange={load} />
      </Card>

      {ch.timeBlocks.map((b) => {
        const mode = b.fillerMode || 'none'
        return (
          <Card key={b.id}>
            <h2 className="font-semibold mb-1">
              {b.collection.name}{' '}
              <span className="text-xs text-ink-faint font-normal">
                {formatDays(b.days)} · {minutesToTime(b.startMinute)}–{minutesToTime(b.endMinute)}
              </span>
            </h2>
            <p className="text-ink-muted text-sm mb-3">
              Overrides the channel default while this block is on.{' '}
              <InfoHint>
                A frosted filler uses this block's logo if it has one, otherwise the channel's.
              </InfoHint>
            </p>

            <label className="flex flex-wrap items-center gap-2 text-sm mb-3">
              <span className="text-ink-soft">Fill leftover time</span>
              <Select
                value={mode}
                onChange={(e) => setBlockFillerMode(b.id, e.target.value)}
                className="w-auto max-w-full"
              >
                <option value="none">Off — no filler in this block</option>
                <option value="between">Between programmes — spread it out</option>
                <option value="end">At the end — one stretch before the block ends</option>
              </Select>
            </label>

            {mode === 'none' && (
              <p className="text-xs text-amber-400/90 mb-3">
                This block opens no filler slots, so the fillers below won't play while it's on air.
                {b.startMode === 'hard' &&
                  ' (Its hard start still fills the gap before it, using the channel default above.)'}
              </p>
            )}

            <FillerAssignmentPicker
              owner={{ timeBlockId: b.id }}
              hint={`during ${b.collection.name}`}
              reloadKey={version}
              onChange={load}
            />
          </Card>
        )
      })}

      {ch.timeBlocks.length === 0 && (
        <p className="text-sm text-ink-faint">
          No time blocks yet — add some on the Schedule tab to give each its own filler.
        </p>
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)} panelClassName="w-full max-w-2xl">
          <ModalHeader title={fillerName(editing)} subtitle="Edit filler" icon="clip" onClose={() => setEditing(null)} />
          <div className="p-5 space-y-3">
            {otherChannels(editing.usedOn, channelId) > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-muted">
                <span>Want it different on this channel only?</span>
                <Button variant="subtle" size="sm" icon="copy" loading={copying} onClick={() => copyForHere(editing)}>
                  Make a copy for this channel
                </Button>
              </div>
            )}
            <FillerEditor
              key={editing.id}
              editId={editing.id}
              initial={draftOf(editing)}
              previewOwner={ownerHere(editing)}
              usedOn={editing.usedOn}
              isDefault={editing.id === defaultId}
              hereChannelId={channelId}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                toast.success('Filler saved')
                setEditing(null)
                changed()
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}
