import { useEffect, useState } from 'react'
import { api, type EncodingProfile, type ProfileFields, type ProfileInput } from '../lib/api'
import { toast } from '../lib/toast'
import { errorMessage } from '../lib/errors'
import { Badge, Banner, Button, Card, Field, Input, Menu, Section, Select, cx } from './ui'
import Icon from './Icon'
import { confirmDialog } from '../lib/confirm'

const RES = [
  { label: '480p', width: 854, height: 480 },
  { label: '720p', width: 1280, height: 720 },
  { label: '1080p', width: 1920, height: 1080 },
]
const resLabel = (w: number, h: number) => RES.find((r) => r.width === w && r.height === h)?.label ?? `${w}×${h}`
const HW: Record<string, string> = {
  auto: 'Auto',
  nvidia: 'NVIDIA',
  qsv: 'QSV',
  vaapi: 'VAAPI',
  amf: 'AMF',
  videotoolbox: 'VideoToolbox',
  cpu: 'CPU',
}

const X264_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower']
const NVENC_PRESETS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']
const QSV_PRESETS = ['veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']
const AMF_PRESETS = ['speed', 'balanced', 'quality']

const SCALING: { value: EncodingProfile['scalingMode']; label: string; hint: string }[] = [
  { value: 'pad', label: 'Scale and pad', hint: 'Keep the shape, add black bars. Nothing is lost.' },
  { value: 'crop', label: 'Scale and crop', hint: 'Fill the frame by cutting off the edges.' },
  { value: 'stretch', label: 'Stretch', hint: 'Fill the frame by distorting the picture.' },
]

const blank = (d: ProfileFields): ProfileInput => ({ name: '', ...d })

/** "1080p · 30fps · medium · NVIDIA · stereo 192k" — a profile at a glance. */
const summary = (p: ProfileFields) =>
  `${resLabel(p.width, p.height)} · ${p.fps}fps · ${p.videoBitrateK > 0 ? `${p.videoBitrateK}k` : p.quality} · ${HW[p.hwaccel]} · ${
    p.audioChannels === 6 ? '5.1' : 'stereo'
  } ${p.audioBitrate}k`

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex items-start gap-2 text-sm select-none">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-ink-soft">
        {label}
        <span className="block text-xs text-ink-faint">{hint}</span>
      </span>
    </label>
  )
}

export default function EncodingProfilesCard() {
  const [profiles, setProfiles] = useState<EncodingProfile[]>([])
  const [defaults, setDefaults] = useState<ProfileFields | null>(null)
  const [form, setForm] = useState<ProfileInput | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () =>
    api.profiles().then((r) => {
      setProfiles(r.profiles)
      setDefaults(r.default)
      setForm((f) => f ?? blank(r.default))
    }).catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  function set<K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f))
  }

  function startNew() {
    setEditingId(null)
    if (defaults) setForm(blank(defaults))
  }
  function startEdit(p: EncodingProfile) {
    const { id: _id, ...fields } = p
    setEditingId(p.id)
    setForm(fields)
  }
  async function save() {
    if (!form || !form.name.trim()) {
      setError('A profile name is required.')
      return
    }
    setError(null)
    try {
      if (editingId) await api.updateProfile(editingId, form)
      else await api.addProfile(form)
      setEditingId(null)
      if (defaults) setForm(blank(defaults))
      refresh()
      toast.success('Profile saved')
    } catch (e) {
      setError(errorMessage(e, 'Save failed'))
    }
  }
  async function del(id: number) {
    if (
      !(await confirmDialog({
        title: 'Delete this profile?',
        message: 'Channels using it fall back to the built-in default.',
        confirmLabel: 'Delete profile',
        danger: true,
      }))
    )
      return
    await api.deleteProfile(id).catch(() => {})
    if (editingId === id) startNew()
    refresh()
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[340px_minmax(0,1fr)] items-start">
      {/* The list */}
      <Card className="p-3 xl:sticky xl:top-20">
        <div className="flex items-center justify-between px-2 pt-1 pb-3">
          <div>
            <h3 className="font-semibold text-[15px] tracking-tight">Profiles</h3>
            <p className="text-[12px] text-ink-faint">Assign one per channel on its General tab</p>
          </div>
          <Button size="sm" icon="plus" variant={editingId == null ? 'secondary' : 'primary'} onClick={startNew}>
            New
          </Button>
        </div>
        <ul className="space-y-0.5">
          {defaults && (
            <li className="flex items-center gap-3 rounded-xl px-2 py-2">
              <span className="grid place-items-center w-9 h-9 shrink-0 rounded-lg border border-edge bg-sunken text-ink-faint">
                <Icon name="cpu" size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[13.5px] font-medium text-ink-soft">
                  Built-in default <Badge>read-only</Badge>
                </span>
                <span className="block text-[11.5px] text-ink-faint truncate">{summary(defaults)}</span>
              </span>
            </li>
          )}
          {profiles.map((p) => {
            const on = p.id === editingId
            return (
              <li key={p.id}>
                <div
                  className={cx(
                    'flex items-center gap-3 rounded-xl px-2 py-2 transition-colors',
                    on ? 'bg-white/[0.07] shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]' : 'hover:bg-white/[0.035]',
                  )}
                >
                  <button onClick={() => startEdit(p)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                    <span
                      className={cx(
                        'grid place-items-center w-9 h-9 shrink-0 rounded-lg border',
                        on ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200' : 'border-edge bg-sunken text-ink-muted',
                      )}
                    >
                      <Icon name="sliders" size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cx('block text-[13.5px] font-medium truncate', on ? 'text-ink' : 'text-ink-soft')}>{p.name}</span>
                      <span className="block text-[11.5px] text-ink-faint truncate">
                        {summary(p)}
                        {p.deinterlace && ' · deint'}
                        {p.normalizeLoudness && ' · loudnorm'}
                        {p.burnSubtitles && ' · subs'}
                      </span>
                    </span>
                  </button>
                  <Menu items={[{ label: 'Delete profile', icon: 'trash', danger: true, onSelect: () => del(p.id) }]} />
                </div>
              </li>
            )
          })}
        </ul>
        {profiles.length === 0 && (
          <p className="px-2 pt-2 pb-1 text-[12.5px] text-ink-faint">
            No profiles yet — channels use the default. Make one to give a channel its own resolution, bitrate or GPU.
          </p>
        )}
      </Card>

      {/* The editor */}
      <Card className="p-6 min-w-0">
      {error && <Banner className="mb-4">{error}</Banner>}
      {form && (
        <div>
          <div className="mb-4">
            <h3 className="font-semibold text-[15px] tracking-tight">
              {editingId ? `Edit “${profiles.find((p) => p.id === editingId)?.name ?? 'profile'}”` : 'New profile'}
            </h3>
            <p className="text-[12.5px] text-ink-muted mt-0.5">
              {editingId ? 'Changes apply from each channel’s next program.' : 'Starts from the built-in default — change what you need.'}
            </p>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <Field label="Name" className="col-span-2 md:col-span-1">
                <Input className="w-full" placeholder="1080p HD" value={form.name} onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="Resolution">
                <Select
                  className="w-full"
                  value={resLabel(form.width, form.height)}
                  onChange={(e) => {
                    const r = RES.find((x) => x.label === e.target.value)
                    if (r) setForm((f) => (f ? { ...f, width: r.width, height: r.height } : f))
                  }}
                >
                  {RES.map((r) => <option key={r.label} value={r.label}>{r.label}</option>)}
                </Select>
              </Field>
              <Field label="Frame rate">
                <Select className="w-full" value={form.fps} onChange={(e) => set('fps', Number(e.target.value))}>
                  {[24, 30, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}
                </Select>
              </Field>
            </div>

            <Section title="Video">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Hardware acceleration" hint="Auto picks the best that works on your host; others fall back to CPU if unavailable.">
                  <Select className="w-full" value={form.hwaccel} onChange={(e) => set('hwaccel', e.target.value as ProfileFields['hwaccel'])}>
                    <option value="auto">Auto (detect)</option>
                    <option value="nvidia">NVIDIA (nvenc)</option>
                    <option value="qsv">Intel QuickSync (qsv)</option>
                    <option value="vaapi">VAAPI (Intel/AMD, Linux)</option>
                    <option value="amf">AMD (amf)</option>
                    <option value="videotoolbox">Apple (videotoolbox)</option>
                    <option value="cpu">CPU (libx264)</option>
                  </Select>
                </Field>
                <Field label="Quality" hint={form.videoBitrateK > 0 ? 'Overridden by the bitrate below.' : undefined}>
                  <Select className="w-full" value={form.quality} onChange={(e) => set('quality', e.target.value as ProfileFields['quality'])}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </Select>
                </Field>
                <Field label="Preset" hint="Speed vs. compression.">
                  <Select className="w-full" value={form.preset} onChange={(e) => set('preset', e.target.value)}>
                    <option value="auto">Auto</option>
                    {(form.hwaccel === 'auto' || form.hwaccel === 'nvidia') && (
                      <optgroup label="NVIDIA (p1 fastest → p7 best)">
                        {NVENC_PRESETS.map((x) => <option key={x} value={x}>{x}</option>)}
                      </optgroup>
                    )}
                    {(form.hwaccel === 'auto' || form.hwaccel === 'qsv') && (
                      <optgroup label="QSV (veryfast → veryslow)">
                        {QSV_PRESETS.map((x) => <option key={`qsv-${x}`} value={x}>{x}</option>)}
                      </optgroup>
                    )}
                    {(form.hwaccel === 'auto' || form.hwaccel === 'amf') && (
                      <optgroup label="AMF">
                        {AMF_PRESETS.map((x) => <option key={x} value={x}>{x}</option>)}
                      </optgroup>
                    )}
                    {(form.hwaccel === 'auto' || form.hwaccel === 'cpu') && (
                      <optgroup label="CPU (x264)">
                        {X264_PRESETS.map((x) => <option key={x} value={x}>{x}</option>)}
                      </optgroup>
                    )}
                  </Select>
                </Field>
                <Field label="Bitrate (kbps)" hint="0 = follow Quality.">
                  <Input type="number" min={0} step={500} className="w-full" value={form.videoBitrateK} onChange={(e) => set('videoBitrateK', Number(e.target.value))} />
                </Field>
                <Field label="Buffer (kbps)" hint="0 = twice the bitrate.">
                  <Input type="number" min={0} step={500} className="w-full" value={form.videoBufferK} onChange={(e) => set('videoBufferK', Number(e.target.value))} />
                </Field>
                <Field label="Scaling" hint={SCALING.find((s) => s.value === form.scalingMode)?.hint}>
                  <Select className="w-full" value={form.scalingMode} onChange={(e) => set('scalingMode', e.target.value as ProfileFields['scalingMode'])}>
                    {SCALING.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </Select>
                </Field>
              </div>
              <div className="mt-3">
                <Check
                  checked={form.deinterlace}
                  onChange={(v) => set('deinterlace', v)}
                  label="Auto deinterlace"
                  hint="Only touches frames flagged as interlaced, so progressive content passes through untouched. Worth leaving on for DVD and broadcast rips."
                />
              </div>
            </Section>

            <Section title="Audio">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Bitrate">
                  <Select className="w-full" value={form.audioBitrate} onChange={(e) => set('audioBitrate', Number(e.target.value))}>
                    {[128, 192, 256, 384].map((b) => <option key={b} value={b}>{b} kbps</option>)}
                  </Select>
                </Field>
                <Field label="Channels">
                  <Select className="w-full" value={form.audioChannels} onChange={(e) => set('audioChannels', Number(e.target.value))}>
                    <option value={2}>Stereo</option>
                    <option value={6}>5.1 surround</option>
                  </Select>
                </Field>
                <Field label="Threads" hint="0 = let ffmpeg decide.">
                  <Input type="number" min={0} max={64} className="w-full" value={form.threads} onChange={(e) => set('threads', Number(e.target.value))} />
                </Field>
              </div>
              <div className="mt-3 space-y-2">
                <Check
                  checked={form.normalizeLoudness}
                  onChange={(v) => set('normalizeLoudness', v)}
                  label="Normalize loudness"
                  hint="Evens out the volume jump between old and modern shows. Costs some CPU, and is measured on the fly so it can't be perfect."
                />
                <Check
                  checked={form.burnSubtitles}
                  onChange={(v) => set('burnSubtitles', v)}
                  label="Burn in subtitles"
                  hint="Renders the first embedded subtitle track into the picture for programs that have one. Off by default; costs a little CPU."
                />
              </div>
            </Section>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            {editingId && (
              <Button variant="secondary" onClick={startNew}>
                Cancel
              </Button>
            )}
            <Button onClick={save}>{editingId ? 'Save profile' : 'Create profile'}</Button>
          </div>
        </div>
      )}
      </Card>
    </div>
  )
}
