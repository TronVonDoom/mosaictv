import { useState, type ReactNode } from 'react'
import Icon, { type IconName } from './Icon'
import { copyText } from '../lib/clipboard'
import { Modal, ModalHeader, Segmented, cx } from './ui'

/** The three addresses a player needs, derived from wherever the UI is served. */
export function endpoints(origin = window.location.origin) {
  return {
    m3u: `${origin}/iptv/channels.m3u`,
    xmltv: `${origin}/iptv/xmltv.xml`,
    // Plex/Emby's HDHomeRun setup wants host:port, not a URL.
    tuner: origin.replace(/^https?:\/\//, ''),
  }
}

/** A read-only address with a copy button that confirms in place. If the
 *  browser blocks the clipboard (plain http on a LAN IP often does), the text
 *  is selected instead so the user can copy it by hand. */
export function CopyField({ value, label, icon }: { value: string; label?: string; icon?: IconName }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    const ok = await copyText(value)
    setState(ok ? 'copied' : 'failed')
    setTimeout(() => setState('idle'), 2000)
  }
  return (
    <div className="flex items-stretch rounded-lg border border-edge-strong bg-sunken overflow-hidden focus-within:border-indigo-500">
      {icon && (
        <span className="grid place-items-center px-2.5 border-r border-edge text-ink-faint">
          <Icon name={icon} size={15} />
        </span>
      )}
      <input
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 min-w-0 bg-transparent px-3 py-2 font-mono text-[12.5px] text-ink-soft outline-none"
      />
      <button
        onClick={copy}
        className={cx(
          'shrink-0 inline-flex items-center gap-1.5 px-3 text-[12.5px] font-medium border-l border-edge transition-colors',
          state === 'copied'
            ? 'text-emerald-300 bg-emerald-500/10'
            : state === 'failed'
              ? 'text-amber-300 bg-amber-500/10'
              : 'text-ink-muted hover:text-ink hover:bg-white/[0.04]',
        )}
      >
        <Icon name={state === 'copied' ? 'check' : 'copy'} size={14} />
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select & copy' : 'Copy'}
      </button>
    </div>
  )
}

type Player = 'jellyfin' | 'plex' | 'emby' | 'other'

function Steps({ children }: { children: ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {children.map((c, i) => (
        <li key={i} className="flex gap-3 text-[13px] text-ink-soft leading-relaxed">
          <span className="shrink-0 grid place-items-center w-5 h-5 mt-px rounded-full bg-indigo-500/15 text-indigo-200 text-[11px] font-semibold tabular-nums">
            {i + 1}
          </span>
          <span className="min-w-0">{c}</span>
        </li>
      ))}
    </ol>
  )
}

const B = ({ children }: { children: ReactNode }) => <span className="font-medium text-ink">{children}</span>

/**
 * "How do I watch this?" — the three addresses a player needs, and short
 * per-player setup, in one place reachable from anywhere in the app. The M3U
 * and XMLTV used to be two bare links in the sidebar with no hint of where
 * they go.
 */
export default function ConnectPlayers({ onClose }: { onClose: () => void }) {
  const e = endpoints()
  const [player, setPlayer] = useState<Player>('jellyfin')

  return (
    <Modal onClose={onClose} panelClassName="w-full max-w-2xl">
      <ModalHeader
        icon="cast"
        title="Connect a player"
        subtitle="Point Jellyfin, Plex, Emby or any IPTV app at these addresses."
        onClose={onClose}
      />

      <div className="p-5 space-y-4">
        <div className="grid gap-3">
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[12.5px] font-medium text-ink-soft">M3U playlist</span>
              <span className="text-[11.5px] text-ink-faint">Your channels and their streams</span>
            </div>
            <CopyField value={e.m3u} label="M3U playlist URL" icon="m3u" />
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[12.5px] font-medium text-ink-soft">XMLTV guide</span>
              <span className="text-[11.5px] text-ink-faint">Listings with artwork, 1–7 days ahead</span>
            </div>
            <CopyField value={e.xmltv} label="XMLTV guide URL" icon="xmltv" />
          </div>
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[12.5px] font-medium text-ink-soft">HDHomeRun tuner address</span>
              <span className="text-[11.5px] text-ink-faint">For Plex and Emby's tuner setup</span>
            </div>
            <CopyField value={e.tuner} label="HDHomeRun tuner address" icon="server" />
          </div>
        </div>

        <div className="rounded-xl border border-edge bg-sunken/60 p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <span className="text-[13px] font-semibold text-ink">Setup</span>
            <Segmented<Player>
              size="sm"
              value={player}
              onChange={setPlayer}
              options={[
                { value: 'jellyfin', label: 'Jellyfin' },
                { value: 'plex', label: 'Plex' },
                { value: 'emby', label: 'Emby' },
                { value: 'other', label: 'VLC & apps' },
              ]}
            />
          </div>

          {player === 'jellyfin' && (
            <Steps>
              {[
                <>
                  <B>Dashboard → Live TV → Tuner Devices → +</B>, type <B>M3U Tuner</B>, and paste the M3U playlist.
                </>,
                <>
                  <B>Guide Data Providers → +</B>, type <B>XMLTV</B>, and paste the XMLTV guide.
                </>,
                <>Refresh the guide. Streams cut off when a second person tunes in? Set the tuner's simultaneous stream limit to 0.</>,
              ]}
            </Steps>
          )}
          {player === 'plex' && (
            <Steps>
              {[
                <>
                  <B>Settings → Live TV & DVR → Set Up Plex DVR</B>. MosaicTV doesn't answer broadcast scans, so choose{' '}
                  <B>Enter its network address manually</B>.
                </>,
                <>Give it the HDHomeRun tuner address — Plex reads the channel lineup from it.</>,
                <>When asked for a guide, choose the XMLTV option and paste the XMLTV guide.</>,
              ]}
            </Steps>
          )}
          {player === 'emby' && (
            <Steps>
              {[
                <>
                  <B>Live TV → Add TV source</B>: either an <B>M3U</B> tuner with the playlist, or an <B>HDHomeRun</B> tuner with
                  the tuner address.
                </>,
                <>
                  <B>Add TV guide data provider</B>, type <B>XMLTV</B>, and paste the XMLTV guide.
                </>,
                <>Refresh guide data — listings and artwork fill in.</>,
              ]}
            </Steps>
          )}
          {player === 'other' && (
            <Steps>
              {[
                <>
                  <B>VLC</B>: Media → Open Network Stream, and paste the M3U playlist. You get every channel, with logos.
                </>,
                <>
                  <B>TiviMate, IPTV Smarters</B> and similar: add a playlist by URL (the M3U) and an EPG by URL (the XMLTV).
                </>,
              ]}
            </Steps>
          )}
        </div>

        <p className="text-xs text-ink-faint">
          Draft channels — those without a number — stay out of the playlist and guide.{' '}
          <a
            href="https://github.com/TronVonDoom/mosaictv/blob/main/docs/clients.md"
            target="_blank"
            rel="noreferrer"
            className="text-indigo-300 hover:text-indigo-200 inline-flex items-center gap-1"
          >
            Full player guide <Icon name="external" size={12} />
          </a>
        </p>
      </div>
    </Modal>
  )
}
