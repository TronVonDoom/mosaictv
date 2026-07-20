import { useEffect, useState } from 'react'
import { api, type EncodingProfile, type ProfileFields, type ProfileInput } from '../lib/api'
import { toast } from '../lib/toast'
import { errorMessage } from '../lib/errors'
import { Banner, Card, Field, Input, Section, Select } from './ui'

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

function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex items-start gap-2 text-sm select-none">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-slate-300">
        {label}
        <span className="block text-xs text-slate-500">{hint}</span>
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
    if (!confirm('Delete this profile? Channels using it fall back to the built-in default.')) return
    await api.deleteProfile(id).catch(() => {})
    if (editingId === id) startNew()
    refresh()
  }

  return (
    <Card className="p-5 mt-6">
      <h2 className="font-semibold mb-1">Encoding profiles</h2>
      <p className="text-slate-400 text-sm mb-4">
        Reusable output settings you can assign per channel. Channels with no profile use the built-in
        default{defaults ? ` (${resLabel(defaults.width, defaults.height)}, ${defaults.fps}fps, ${defaults.quality}, ${HW[defaults.hwaccel]})` : ''}.
      </p>

      {error && <Banner className="mb-4">{error}</Banner>}

      {profiles.length > 0 && (
        <div className="space-y-2 mb-4">
          {profiles.map((p) => (
            <div key={p.id} className="flex items-center gap-3 text-sm rounded-lg bg-slate-950/50 border border-slate-800 px-3 py-2">
              <span className="font-medium flex-1 min-w-0 truncate">{p.name}</span>
              <span className="text-xs text-slate-500 shrink-0">
                {resLabel(p.width, p.height)} · {p.fps}fps · {p.videoBitrateK > 0 ? `${p.videoBitrateK}k` : p.quality} ·{' '}
                {HW[p.hwaccel]} · {p.audioChannels === 6 ? '5.1' : 'stereo'} {p.audioBitrate}k
                {p.deinterlace && ' · deint'}
                {p.normalizeLoudness && ' · loudnorm'}
                {p.burnSubtitles && ' · subs'}
              </span>
              <button onClick={() => startEdit(p)} className="text-xs text-slate-400 hover:text-indigo-300">Edit</button>
              <button onClick={() => del(p.id)} className="text-slate-600 hover:text-rose-400" aria-label="Delete">×</button>
            </div>
          ))}
        </div>
      )}

      {form && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
          <div className="text-sm font-medium mb-3">{editingId ? 'Edit profile' : 'New profile'}</div>
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
          <div className="flex justify-end gap-2 mt-3">
            {editingId && <button onClick={startNew} className="rounded-lg border border-slate-700 hover:border-slate-500 px-3 py-1.5 text-sm">New instead</button>}
            <button onClick={save} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-5 py-1.5 text-sm font-medium">{editingId ? 'Save' : 'Create profile'}</button>
          </div>
        </div>
      )}
    </Card>
  )
}
