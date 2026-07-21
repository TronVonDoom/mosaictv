import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { formatDays, minutesToTime } from '../../lib/format'
import FillerAssignmentPicker from '../FillerAssignmentPicker'
import { Banner, Card, InfoHint, Select } from '../ui'
import type { ChannelTabProps } from './types'

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
}: ChannelTabProps & { onGoToSchedule: () => void }) {
  const makesFillerSlots = ch.timeBlocks.some(
    (b) => (b.fillerMode || 'none') !== 'none' || b.startMode === 'hard',
  )

  // Filler mode saves on its own — patching just this field avoids clobbering
  // an edit in progress on the Schedule tab.
  const setBlockFillerMode = (blockId: number, fillerMode: string) =>
    guard(() => api.updateBlock(channelId, blockId, { fillerMode }), 'Filler mode saved')

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
        <h2 className="font-semibold mb-1">Channel default</h2>
        <p className="text-ink-muted text-sm mb-3">
          Plays in any filler slot where the active block has none of its own. Build and generate
          fillers under{' '}
          <Link to="/studio#fillers" className="text-indigo-300 hover:text-indigo-200">
            Studio → Fillers
          </Link>
          .
        </p>
        <FillerAssignmentPicker owner={{ channelId }} hint="channel default" />
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
                className="w-auto"
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

            <FillerAssignmentPicker owner={{ timeBlockId: b.id }} hint={`during ${b.collection.name}`} />
          </Card>
        )
      })}

      {ch.timeBlocks.length === 0 && (
        <p className="text-sm text-ink-faint">
          No time blocks yet — add some on the Schedule tab to give each its own filler.
        </p>
      )}
    </div>
  )
}
