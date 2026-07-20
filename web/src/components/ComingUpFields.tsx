import type { ComingUpConfig } from '../lib/api'
import { Field, Input, Section, Select } from './ui'


const TIMINGS: { value: ComingUpConfig['timing']; label: string; hint: string }[] = [
  { value: 'beforeEnd', label: 'Before it ends', hint: 'Appears a set time before the current program ends.' },
  { value: 'middle', label: 'Middle', hint: 'Appears once, around the midpoint of the current program.' },
  { value: 'both', label: 'Both', hint: 'Appears at the midpoint and again near the end.' },
]

// The %tokens% a template can use, with a short description each.
const TOKENS: [string, string][] = [
  ['%showtitle%', 'series name'],
  ['%episodetitle%', 'episode title'],
  ['%movietitle%', 'movie title'],
  ['%se%', 'S01E02'],
  ['%season%', 'season number'],
  ['%episode%', 'episode number'],
  ['%year%', 'release year'],
]

// Editor for the "coming up next" caption shown over programs. Mirrors
// WatermarkFields' look. Shown only over programs — never filler.
export default function ComingUpFields({
  cfg,
  onChange,
}: {
  cfg: ComingUpConfig
  onChange: (c: ComingUpConfig) => void
}) {
  const set = <K extends keyof ComingUpConfig>(k: K, v: ComingUpConfig[K]) => onChange({ ...cfg, [k]: v })

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm select-none">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => set('enabled', e.target.checked)} />
        <span className="text-slate-200 font-medium">Show a “coming up next” caption over programs</span>
      </label>

      {cfg.enabled && (
        <>
          <Section title="Text">
            <Field label="Template" hint="Empty tokens (and the dashes around them) are dropped automatically.">
              <Input className="w-full font-mono" value={cfg.template} onChange={(e) => set('template', e.target.value)} />
            </Field>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
              {TOKENS.map(([tok, desc]) => (
                <span key={tok}>
                  <code className="text-slate-400">{tok}</code> {desc}
                </span>
              ))}
            </div>
          </Section>

          <Section title="Timing">
            <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden">
              {TIMINGS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => set('timing', t.value)}
                  className={`px-3.5 py-1.5 text-sm transition-colors ${
                    cfg.timing === t.value ? 'bg-indigo-500 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-1.5">{TIMINGS.find((t) => t.value === cfg.timing)?.hint}</p>
            <div className="grid grid-cols-3 gap-3 mt-3">
              {cfg.timing !== 'middle' && (
                <Field label="Before end (sec)" hint="300 = 5 min.">
                  <Input type="number" min={5} max={3600} className="w-full" value={cfg.leadSeconds} onChange={(e) => set('leadSeconds', Number(e.target.value))} />
                </Field>
              )}
              <Field label="On screen (sec)">
                <Input type="number" min={2} max={120} className="w-full" value={cfg.holdSeconds} onChange={(e) => set('holdSeconds', Number(e.target.value))} />
              </Field>
              <Field label="Fade (sec)" hint="0 = pop.">
                <Input type="number" min={0} step={0.5} className="w-full" value={cfg.fadeSeconds} onChange={(e) => set('fadeSeconds', Number(e.target.value))} />
              </Field>
            </div>
          </Section>

          <Section title="Appearance">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Position">
                <Select className="w-full" value={cfg.position} onChange={(e) => set('position', e.target.value as ComingUpConfig['position'])}>
                  <option value="bottom">Bottom</option>
                  <option value="top">Top</option>
                </Select>
              </Field>
              <Field label="Text size %" hint="Share of frame height.">
                <Input type="number" min={1.5} max={15} step={0.5} className="w-full" value={cfg.fontSizePercent} onChange={(e) => set('fontSizePercent', Number(e.target.value))} />
              </Field>
              <Field label="Opacity %">
                <Input type="number" min={0} max={100} className="w-full" value={cfg.opacityPercent} onChange={(e) => set('opacityPercent', Number(e.target.value))} />
              </Field>
            </div>
          </Section>
        </>
      )}
    </div>
  )
}
