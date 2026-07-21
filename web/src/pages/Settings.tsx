import { useEffect, useState, type ReactNode } from 'react'
import { api, backupUrl, type StreamMode, type WatermarkConfig } from '../lib/api'
import { errorMessage } from '../lib/errors'
import WatermarkFields from '../components/WatermarkFields'
import EncodingProfilesCard from '../components/EncodingProfilesCard'
import { toast } from '../lib/toast'
import { useHashTab } from '../lib/hooks'
import {
  Badge,
  Banner,
  Button,
  Card,
  Field,
  InfoHint,
  Input,
  LinkButton,
  PageHeader,
  Skeleton,
  Tabs,
  cx,
} from '../components/ui'

const TABS = [
  { id: 'metadata', label: 'Metadata', icon: 'browse' },
  { id: 'streaming', label: 'Streaming', icon: 'channels' },
  { id: 'watermark', label: 'Watermark', icon: 'image' },
  { id: 'encoding', label: 'Encoding', icon: 'clip' },
  { id: 'maintenance', label: 'Maintenance', icon: 'settings' },
] as const

type SettingsTab = (typeof TABS)[number]['id']
const TAB_IDS = TABS.map((t) => t.id)

const DESCRIPTIONS: Record<SettingsTab, string> = {
  metadata: 'Where MosaicTV gets posters, overviews, genres and ratings for your library.',
  streaming: 'How channel streams are produced and handed to your player.',
  watermark: 'The fallback on-screen logo, for logos that carry no settings of their own.',
  encoding: 'Reusable ffmpeg profiles that channels pick from when they transcode.',
  maintenance: 'Back up your data, or wipe this instance back to a clean slate.',
}

const STREAM_MODES = [
  {
    id: 'hls',
    title: 'Shared HLS',
    badge: 'Recommended',
    desc: 'One transcode per channel, served to every viewer.',
    best: 'Best for multiple viewers, or a weaker CPU.',
  },
  {
    id: 'mpegts',
    title: 'MPEG-TS (per-client)',
    badge: null,
    desc: 'A separate transcode for each viewer.',
    best: 'Simplest; fine for a single viewer or a very fast box.',
  },
] as const

/** A titled block inside a settings tab — the heading, the one-line "what", and
 *  an optional badge for state that belongs next to the title. */
function SettingsCard({
  title,
  description,
  badge,
  children,
}: {
  title: string
  description?: ReactNode
  badge?: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <div className="flex items-center gap-3 mb-1">
        <h2 className="font-semibold">{title}</h2>
        {badge}
      </div>
      {description && <p className="text-ink-muted text-sm mb-4">{description}</p>}
      {children}
    </Card>
  )
}

export default function Settings() {
  const [tab, setTab] = useHashTab<SettingsTab>(TAB_IDS, 'metadata')
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [wm, setWm] = useState<WatermarkConfig | null>(null)
  const [streamMode, setStreamMode] = useState<StreamMode>('mpegts')
  const [tunerCount, setTunerCount] = useState(4)
  const [tunerDraft, setTunerDraft] = useState('4')
  const [deviceId, setDeviceId] = useState('')
  const [tunerName, setTunerName] = useState('MosaicTV')
  const [nameDraft, setNameDraft] = useState('MosaicTV')
  const [wipeAssets, setWipeAssets] = useState(true)
  const [resetBusy, setResetBusy] = useState(false)

  useEffect(() => {
    api
      .settings()
      .then((s) => {
        setConfigured(s.tmdbConfigured)
        setWm(s.watermark)
        setStreamMode(s.streamMode)
        setTunerCount(s.tunerCount)
        setTunerDraft(String(s.tunerCount))
        setDeviceId(s.hdhrDeviceId)
        setTunerName(s.hdhrFriendlyName)
        setNameDraft(s.hdhrFriendlyName)
      })
      .catch(() => {})
  }, [])

  async function saveMode(mode: StreamMode) {
    setStreamMode(mode)
    try {
      await api.saveStreamMode(mode)
      toast.success(`Streaming mode: ${mode === 'hls' ? 'Shared HLS' : 'MPEG-TS'}`)
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save streaming mode'))
    }
  }

  async function saveTuners(n: number) {
    if (n === tunerCount) return // blur with nothing changed — don't re-save
    const previous = tunerCount
    setTunerCount(n)
    setTunerDraft(String(n))
    try {
      await api.saveTunerCount(n)
      toast.success(`Tuner count: ${n}`)
    } catch (err) {
      setTunerCount(previous)
      setTunerDraft(String(previous))
      toast.error(errorMessage(err, 'Failed to save tuner count'))
    }
  }

  async function saveTunerName(name: string) {
    if (name === tunerName) return // blur with nothing changed — don't re-save
    const previous = tunerName
    setTunerName(name)
    setNameDraft(name)
    try {
      await api.saveTunerName(name)
      toast.success(`Tuner name: ${name}`)
    } catch (err) {
      setTunerName(previous)
      setNameDraft(previous)
      toast.error(errorMessage(err, 'Failed to save tuner name'))
    }
  }

  async function saveWm(e: React.FormEvent) {
    e.preventDefault()
    if (!wm) return
    try {
      const r = await api.saveWatermark(wm)
      setWm(r.watermark)
      toast.success('Watermark saved')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save watermark'))
    }
  }

  async function resetInstance() {
    if (
      !confirm(
        'Wipe ALL libraries, channels, collections, logos and settings back to a clean slate? This cannot be undone — back up first.',
      )
    )
      return
    setResetBusy(true)
    try {
      await api.resetInstance(wipeAssets)
      toast.info('Instance reset. Reloading…')
      setTimeout(() => window.location.reload(), 1200)
    } catch (err) {
      toast.error(errorMessage(err, 'Reset failed'))
      setResetBusy(false)
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await api.saveTmdbKey(key.trim())
      setConfigured(true)
      setKey('')
      toast.success('TMDB key saved and verified')
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to save key'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Settings"
        icon="settings"
        description={DESCRIPTIONS[tab]}
      >
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
      </PageHeader>

      {tab === 'metadata' && (
        <SettingsCard
          title="TMDB (The Movie Database)"
          badge={
            configured != null && (
              <Badge tone={configured ? 'good' : 'neutral'}>
                {configured ? 'configured' : 'not set'}
              </Badge>
            )
          }
          description={
            <>
              A free API key unlocks posters, overviews, genres and ratings. Grab one from your{' '}
              <a
                href="https://www.themoviedb.org/settings/api"
                target="_blank"
                rel="noreferrer"
                className="text-indigo-300 hover:text-indigo-200"
              >
                TMDB account → API
              </a>
              .{' '}
              <InfoHint>
                Use the <span className="text-ink">API Key (v3 auth)</span> value, not the read access
                token. MosaicTV verifies the key with TMDB before saving it, so a bad key fails here
                rather than silently during a scan.
              </InfoHint>
            </>
          }
        >
          <form onSubmit={save} className="flex gap-2">
            <Input
              type="password"
              className="flex-1 min-w-0 font-mono"
              placeholder={configured ? '•••••••• (enter a new key to replace)' : 'Paste your TMDB API key'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              required
            />
            <Button type="submit" disabled={saving || !key.trim()} className="shrink-0">
              {saving ? 'Verifying…' : 'Save & verify'}
            </Button>
          </form>
          {configured === false && (
            <p className="text-xs text-ink-faint mt-3">
              Without a key MosaicTV still scans and schedules everything — your channels just look
              plainer, with no artwork in the guide.
            </p>
          )}
        </SettingsCard>
      )}

      {tab === 'streaming' && (
        <div className="space-y-4">
          <SettingsCard
            title="Streaming mode"
            description={
              <>
                How the M3U hands out channel streams. Takes effect the next time a player reloads
                the playlist.{' '}
                <InfoHint>
                  Both endpoints stay live regardless of this setting — a channel is always reachable
                  at <code className="text-ink">/iptv/channel/N.ts</code> and{' '}
                  <code className="text-ink">/iptv/channel/N/index.m3u8</code>. This only changes
                  which one the playlist points at.
                </InfoHint>
              </>
            }
          >
            <div className="space-y-2">
              {STREAM_MODES.map((o) => {
                const active = streamMode === o.id
                return (
                  <label
                    key={o.id}
                    className={cx(
                      'flex gap-3 rounded-lg border p-3 cursor-pointer transition-colors',
                      active ? 'border-indigo-500/60 bg-indigo-500/5' : 'border-edge hover:border-edge-strong',
                    )}
                  >
                    <input
                      type="radio"
                      name="streamMode"
                      className="mt-1 shrink-0"
                      checked={active}
                      onChange={() => saveMode(o.id)}
                    />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{o.title}</span>
                        {o.badge && <Badge tone="accent">{o.badge}</Badge>}
                      </div>
                      <div className="text-xs text-ink-muted mt-0.5">{o.desc}</div>
                      <div className="text-xs text-ink-faint mt-0.5">{o.best}</div>
                    </div>
                  </label>
                )
              })}
            </div>
          </SettingsCard>

          <SettingsCard
            title="HDHomeRun tuner (Plex / Emby)"
            description={
              <>
                MosaicTV emulates an HDHomeRun network tuner, so Plex's Live TV &amp; DVR setup (or
                Emby's HDHomeRun tuner type) can add it directly — no Threadfin/xTeVe needed. Add it
                by IP; there's no broadcast discovery, so it won't appear on its own.{' '}
                <InfoHint>
                  The tuner always serves MPEG-TS, whatever the mode above says — a tuner URL is a
                  raw transport stream by contract, and Plex fails to tune on anything else. So Plex
                  costs one transcode per viewer even in shared-HLS mode.
                  <br />
                  <br />
                  One tuner slot = one concurrent Live TV stream Plex/Emby will pull from MosaicTV.
                  MosaicTV itself has no hard limit, so raise this if playback gets cut off when a
                  second person tunes in.
                </InfoHint>
              </>
            }
          >
            <div className="space-y-4">
              <Field
                label="Device ID"
                hint="Generated once for this instance. Plex identifies the tuner by this, so it isn't editable — a new ID would register as a second, unrelated tuner."
              >
                <Input
                  readOnly
                  value={deviceId || '—'}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-40 font-mono text-ink-muted cursor-default"
                />
              </Field>

              <Field
                label="Tuner name"
                hint="What Plex lists the device as. Safe to change any time, though Plex may keep showing the old name until the DVR entry is re-added."
              >
                <Input
                  maxLength={60}
                  className="w-64"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => {
                    const name = nameDraft.trim()
                    if (name) saveTunerName(name)
                    else setNameDraft(tunerName) // empty isn't a name — put back the saved one
                  }}
                />
              </Field>

              <Field
                label="Tuner count"
                hint="How many streams Plex/Emby will pull at once before refusing to tune."
              >
                <Input
                  type="number"
                  min={1}
                  max={32}
                  className="w-20"
                  // Held as a string while editing so clearing the box doesn't
                  // collapse to 0; blur commits a valid number or restores the
                  // last saved one, so the field never disagrees with the server.
                  value={tunerDraft}
                  onChange={(e) => setTunerDraft(e.target.value)}
                  onBlur={() => {
                    const n = Math.round(Number(tunerDraft))
                    if (tunerDraft.trim() && Number.isFinite(n) && n >= 1 && n <= 32) saveTuners(n)
                    else setTunerDraft(String(tunerCount))
                  }}
                />
              </Field>
            </div>
          </SettingsCard>
        </div>
      )}

      {tab === 'watermark' &&
        (wm ? (
          <SettingsCard
            title="Default watermark"
            description={
              <>
                The fallback on-screen logo, used by logos that have no settings of their own.{' '}
                <InfoHint>
                  Set per-logo overrides under Studio → Logos; those always win over this default.
                  Intermittent mode shows the logo for the set duration every so many minutes, aligned
                  to wall-clock time — so every channel flashes its logo together.
                </InfoHint>
              </>
            }
          >
            <form onSubmit={saveWm}>
              <WatermarkFields wm={wm} onChange={setWm} />
              <div className="flex justify-end mt-3">
                <Button type="submit" size="lg">
                  Save default
                </Button>
              </div>
            </form>
          </SettingsCard>
        ) : (
          <Skeleton className="h-64 rounded-xl" />
        ))}

      {tab === 'encoding' && <EncodingProfilesCard />}

      {tab === 'maintenance' && (
        <div className="space-y-4">
          <SettingsCard
            title="Backup"
            description="Everything that makes this instance yours — the database, your logos, and your filler clips — in one archive."
          >
            <LinkButton href={backupUrl}>Download backup (.tar.gz)</LinkButton>
          </SettingsCard>

          <SettingsCard
            title="Reset"
            description="Wipe this instance back to a clean slate: every library, channel, collection, logo and setting."
          >
            <Banner tone="warn" className="mb-4">
              This cannot be undone. Download a backup first if there's any chance you'll want this
              instance back.
            </Banner>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-ink-muted select-none">
                <input
                  type="checkbox"
                  checked={wipeAssets}
                  onChange={(e) => setWipeAssets(e.target.checked)}
                />
                Also delete uploaded logos &amp; filler
              </label>
              <Button variant="danger" onClick={resetInstance} disabled={resetBusy} className="ml-auto">
                {resetBusy ? 'Resetting…' : 'Reset to clean slate'}
              </Button>
            </div>
          </SettingsCard>
        </div>
      )}
    </div>
  )
}
