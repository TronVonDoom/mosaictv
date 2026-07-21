import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  api,
  parseComingUp,
  DEFAULT_COMINGUP,
  type ComingUpConfig,
  type EncodingProfile,
} from '../../lib/api'
import ComingUpFields from '../ComingUpFields'
import LogoPicker from '../LogoPicker'
import { Button, Card, Field, InfoHint, Input, Section, Select } from '../ui'
import type { ChannelTabProps } from './types'

// Channel-level coming-up state is always a full config; "off" is enabled=false,
// which we persist as null (see save()).
const offComingUp = (): ComingUpConfig => ({ ...DEFAULT_COMINGUP, enabled: false })

/** Identity and output: number, name, group, logo, encoding profile, and the
 *  channel-wide "coming up next" caption. */
export default function GeneralTab({ channelId, ch, guard }: ChannelTabProps) {
  const [profiles, setProfiles] = useState<EncodingProfile[]>([])
  const [form, setForm] = useState({
    number: ch.number != null ? String(ch.number) : '',
    name: ch.name,
    group: ch.group ?? '',
    logoUrl: ch.logoUrl ?? '',
    logoId: ch.logoId ?? null as number | null,
    profileId: ch.profileId ?? null as number | null,
  })
  const [cu, setCu] = useState<ComingUpConfig>(parseComingUp(ch.comingUp) ?? offComingUp())

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
          comingUp: cu.enabled ? cu : null,
        }),
      'Channel saved',
    )
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
        </div>

        <div className="flex flex-wrap gap-3 items-end">
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
            className="flex-1 min-w-56"
          >
            <LogoPicker value={form.logoId} onChange={(id) => setForm({ ...form, logoId: id })} />
          </Field>
          <Button type="submit" size="lg">
            Save
          </Button>
        </div>

        <Section title="Coming up next" className="mt-5">
          <p className="text-ink-muted text-sm mb-3">
            Burns a caption naming the next programme over the current one, across this channel's
            rotation and blocks alike.{' '}
            <InfoHint>
              A time block can override this on the Schedule tab. The caption never shows over filler.
              Saved with the Save button above.
            </InfoHint>
          </p>
          <ComingUpFields cfg={cu} onChange={setCu} />
        </Section>
      </form>
    </Card>
  )
}
