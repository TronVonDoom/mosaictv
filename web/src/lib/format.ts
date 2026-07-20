// Presentation helpers: turning raw values from the API into the strings and
// styles the UI shows. No knowledge of endpoints — resource URL builders live
// in api.ts alongside the client.

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "1,2,3,4,5" -> "Weekdays"; "0,6" -> "Weekends"; else "Mon, Wed". */
export function formatDays(csv: string): string {
  const days = csv.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)).sort()
  if (days.length === 7) return 'Every day'
  if (days.join(',') === '1,2,3,4,5') return 'Weekdays'
  if (days.join(',') === '0,6') return 'Weekends'
  return days.map((d) => DAY_NAMES[d]).join(', ')
}

/** Minutes past midnight -> "6:30 PM". */
export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ampm = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function formatSize(bytes: number | null): string {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

/** Deterministic dark gradient for placeholder "posters" (no artwork yet). */
export function posterGradient(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360
  const h2 = (h + 45) % 360
  return `linear-gradient(150deg, hsl(${h} 45% 32%), hsl(${h2} 50% 18%))`
}
