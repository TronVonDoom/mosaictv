import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  api,
  AUDIO_LANGUAGES,
  parseComingUp,
  DEFAULT_COMINGUP,
  type ComingUpConfig,
  type EncodingProfile,
} from '../../lib/api'
import { useDraft } from '../../lib/hooks'
import ComingUpFields from '../ComingUpFields'
import LogoPicker from '../LogoPicker'
import { Badge, Button, Card, Field, InfoHint, Input, Section, Select } from '../ui'
import type { ChannelTabProps } from './types'

// Channel-level coming-up state is always a full config; "off" is enabled=false,
// which we persist as null (see save()).
const offComingUp = (): ComingUpConfig => ({ ...DEFAULT_COMINGUP, enabled: false })

/** Identity and output: number, name, group, logo, encoding profile, and the
 *  channel-wide "coming up next" card. */
export default function GeneralTab({ channelId, ch, guard, drafts }: ChannelTabProps) {
  const [profiles, setProfiles] = useState<EncodingProfile[]>([])
  const savedForm = () => ({
    number: ch.number != null ? String(ch.number) : '',
    name: ch.name,
    group: ch.group ?? '',
    logoUrl: ch.logoUrl ?? '',
    logoId: ch.logoId ?? (null as number | null),
    profileId: ch.profileId ?? (null as number | null),
    audioLanguage: ch.audioLanguage ?? '',
  })
  const savedCu = () => parseComingUp(ch.comingUp) ?? offComingUp()
  const [form, setForm, clearFormDraft] = useDraft(drafts, 'general.form', savedForm)
  const [cu, setCu, clearCuDraft] = useDraft<ComingUpConfig>(drafts, 'general.comingUp', savedCu)
  // A card that's switched off saves as nothing, so its hidden fields don't
  // count as a change.
  const cuValue = (c: ComingUpConfig) => (c.enabled ? JSON.stringify(c) : null)
  const dirty =
    JSON.stringify(form) !== JSON.stringify(savedForm()) || cuValue(cu) !== cuValue(savedCu())

  useEffect(() => {
    api.profiles().then((r) => setProfiles(r.profiles)).catch(() => {})
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    await guard(
      () =>
        api.updateChannel(channelId, {
          number: form.number.trim() ? Number(form.number) : null,
          name: form.name,
          group: form.group || null,
          logoUrl: form.logoUrl || null,
          logoId: form.logoId,
          profileId: form.profileId,
          audioLanguage: form.audioLanguage || null,
          comingUp: cu.enabled ? cu : null,
        }),
      'Channel saved',
    )
    // Committed — drop the draft so the next visit reflects the server, not a
    // replay of what we just sent.
    clearFormDraft()
    clearCuDraft()
  }

  return (
    <Card>
      <form onSubmit={save}>
        <h2 className="font-semibold mb-1">Channel settings</h2>
        <p className="text-ink-muted text-sm mb-4">
          Identity and output. Leave the number blank to keep this a draft — hidden from the guide and
          the stream until you give it one.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          <Field label="Number">
            <Input
              type="number"
              placeholder="draft"
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
            />
          </Field>
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                Group
                <InfoHint>
                  Players that support categories use this to sort your channels — "Entertainment",
                  "Kids", "Movies". Leave it blank and the channel is simply ungrouped.
                </InfoHint>
              </span>
            }
          >
            <Input
              placeholder="Entertainment"
              value={form.group}
              onChange={(e) => setForm({ ...form, group: e.target.value })}
            />
          </Field>
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                Encoding profile
                <InfoHint>
                  How this channel is transcoded for playback. The built-in default suits most setups;
                  create your own under{' '}
                  <Link to="/settings#encoding" className="text-indigo-300">
                    Settings → Encoding
                  </Link>
                  .
                </InfoHint>
              </span>
            }
          >
            <Select
              value={form.profileId ?? ''}
              onChange={(e) =>
                setForm({ ...form, profileId: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">Default (built-in)</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                Audio language
                <InfoHint>
                  Which track this channel airs when a file has more than one. Inherit follows{' '}
                  <Link to="/settings#streaming" className="text-indigo-300">
                    Settings → Streaming
                  </Link>
                  ; set it here for a channel that should differ — subtitled anime on an otherwise
                  dubbed instance, say. A file with no track in the language plays its first.
                </InfoHint>
              </span>
            }
          >
            <Select
              value={form.audioLanguage}
              onChange={(e) => setForm({ ...form, audioLanguage: e.target.value })}
            >
              <option value="">Inherit global setting</option>
              {AUDIO_LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label={
            <span className="inline-flex items-center gap-1.5">
              Logo
              <InfoHint>
                Shown in the guide, and used as the default on-screen watermark. A collection or time
                block can override it.
              </InfoHint>
            </span>
          }
        >
          <LogoPicker value={form.logoId} onChange={(id) => setForm({ ...form, logoId: id })} />
        </Field>

        <Section title="Coming up next" className="mt-5">
          <p className="text-ink-muted text-sm mb-3">
            A card naming the next program slides in over the current one — its poster, title,
            episode and start time — across this channel's rotation and blocks alike.{' '}
            <InfoHint>
              A time block can override this on the Schedule tab. The card never shows over filler; it
              names the program after the break instead, and a broadcast episode gets one card near its
              end. Saving applies it to what's on air right away.
            </InfoHint>
          </p>
          <ComingUpFields cfg={cu} onChange={setCu} channelId={channelId} />
        </Section>

        {/* Below everything it saves: the card fields grow the form well past
            the fold, and a Save above them read as "already applied". */}
        <div className="mt-5 flex items-center justify-end gap-3">
          {dirty && <Badge tone="warn">Unsaved changes</Badge>}
          <Button type="submit" size="lg">
            Save
          </Button>
        </div>
      </form>
    </Card>
  )
}
