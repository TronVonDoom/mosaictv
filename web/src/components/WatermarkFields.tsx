import type { WatermarkConfig } from '../lib/api'
import { Field, Input, Section } from './ui'


const MODES: { value: WatermarkConfig['mode']; label: string; hint: string }[] = [
  { value: 'permanent', label: 'Permanent', hint: 'The logo stays on screen for the whole program.' },
  { value: 'intermittent', label: 'Intermittent', hint: 'The logo appears briefly on a repeating cycle, like a broadcast bug.' },
  { value: 'none', label: 'None', hint: 'No logo is drawn over this channel.' },
]

const CORNERS: WatermarkConfig['position'][] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']

// Shared editor for a WatermarkConfig — used for the global default (Settings)
// and per-logo overrides (Logos).
export default function WatermarkFields({
  wm,
  onChange,
}: {
  wm: WatermarkConfig
  onChange: (wm: WatermarkConfig) => void
}) {
  const set = <K extends keyof WatermarkConfig>(k: K, v: WatermarkConfig[K]) => onChange({ ...wm, [k]: v })
  const activeMode = MODES.find((m) => m.value === wm.mode) ?? MODES[0]
  // A fade can't take up more than half the visible window (in and then out).
  const fadeMax = Math.max(0, Math.floor(wm.durationSeconds / 2))

  return (
    <div className="space-y-3">
      <div>
        <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => set('mode', m.value)}
              className={`px-3.5 py-1.5 text-sm transition-colors ${
                wm.mode === m.value ? 'bg-indigo-500 text-white' : 'bg-slate-900 text-slate-400 hover:text-slate-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-1.5">{activeMode.hint}</p>
      </div>

      {wm.mode !== 'none' && (
        <>
          <Section title="Placement">
            <div className="flex flex-wrap gap-4">
              <div>
                <div className="text-sm text-slate-400 mb-1">Corner</div>
                {/* Mini frame — click a corner to place the logo there. */}
                <div className="grid grid-cols-2 gap-1 w-24 h-[54px] rounded border border-slate-700 bg-slate-950 p-1">
                  {CORNERS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={c.replace('-', ' ')}
                      onClick={() => set('position', c)}
                      className={`rounded-sm transition-colors ${
                        wm.position === c ? 'bg-indigo-500' : 'bg-slate-800 hover:bg-slate-700'
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 flex-1 min-w-48">
                <Field label="H margin %">
                  <Input type="number" min={0} max={45} className="w-full" value={wm.horizontalMarginPercent} onChange={(e) => set('horizontalMarginPercent', Number(e.target.value))} />
                </Field>
                <Field label="V margin %">
                  <Input type="number" min={0} max={45} className="w-full" value={wm.verticalMarginPercent} onChange={(e) => set('verticalMarginPercent', Number(e.target.value))} />
                </Field>
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm mt-3 select-none">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={wm.constrainToMedia}
                onChange={(e) => set('constrainToMedia', e.target.checked)}
              />
              <span className="text-slate-300">
                Keep the logo on the picture
                <span className="block text-xs text-slate-500">
                  Size and place it against the visible image rather than the full frame, so it never drifts onto the
                  black bars of 4:3 or letterboxed content.
                </span>
              </span>
            </label>
          </Section>

          <Section title="Appearance">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Width %" hint="Share of the picture's width.">
                <Input type="number" min={1} max={50} className="w-full" value={wm.widthPercent} onChange={(e) => set('widthPercent', Number(e.target.value))} />
              </Field>
              <Field label="Opacity %">
                <Input type="number" min={0} max={100} className="w-full" value={wm.opacityPercent} onChange={(e) => set('opacityPercent', Number(e.target.value))} />
              </Field>
              <Field label="Fade (sec)" hint="0 = pop in and out.">
                <Input type="number" min={0} step={0.5} className="w-full" value={wm.fadeSeconds} onChange={(e) => set('fadeSeconds', Number(e.target.value))} />
              </Field>
            </div>
            <label className="flex items-start gap-2 text-sm mt-3 select-none">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={wm.showOnFiller}
                onChange={(e) => set('showOnFiller', e.target.checked)}
              />
              <span className="text-slate-300">
                Show on filler
                <span className="block text-xs text-slate-500">
                  Filler is usually built from this logo already, so the corner bug is a second copy of it. Left off,
                  the logo fades out as a program hands over to filler and fades back in afterwards.
                </span>
              </span>
            </label>
          </Section>

          {wm.mode === 'intermittent' && (
            <Section title="Timing">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Every (min)">
                  <Input type="number" min={1} className="w-full" value={wm.frequencyMinutes} onChange={(e) => set('frequencyMinutes', Number(e.target.value))} />
                </Field>
                <Field label="Duration (sec)">
                  <Input type="number" min={1} className="w-full" value={wm.durationSeconds} onChange={(e) => set('durationSeconds', Number(e.target.value))} />
                </Field>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Shows for {wm.durationSeconds}s every {wm.frequencyMinutes} min
                {wm.fadeSeconds > 0
                  ? `, fading over ${Math.min(wm.fadeSeconds, fadeMax)}s${wm.fadeSeconds > fadeMax ? ` (capped at half the window)` : ''}.`
                  : ', cutting straight in and out.'}
              </p>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
