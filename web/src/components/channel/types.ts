import type { ChannelDetail } from '../../lib/api'
import type { DraftCache } from '../../lib/hooks'

/**
 * What every channel-editor tab needs from the page that hosts it: the channel
 * it's editing, the wrapper that runs a mutation, refreshes the channel, and
 * routes any failure to the page's single error banner, and the draft cache
 * that lets a tab's half-filled form survive being unmounted.
 *
 * Keeping `guard` on the page rather than in each tab is what stops five tabs
 * from growing five slightly different error-handling styles.
 */
export type ChannelTabProps = {
  channelId: number
  ch: ChannelDetail
  guard: <T>(fn: () => Promise<T>, successMsg?: string) => Promise<void>
  drafts: DraftCache
}
