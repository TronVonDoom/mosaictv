// Playback orders, shared by the collection editor (which sets a collection's
// default) and the rotation/block forms (which can defer to that default).
export const PLAYBACK_ORDERS = [
  { value: 'chronological', label: 'in order' },
  { value: 'custom', label: 'hand-picked order' },
  { value: 'rotate', label: 'rotate shows' },
  { value: 'shuffle', label: 'shuffle' },
  { value: 'shuffleShows', label: 'shuffle shows' },
]

export const INHERIT = { value: 'inherit', label: 'collection default' }

export function orderLabel(value: string): string {
  if (value === INHERIT.value) return INHERIT.label
  return PLAYBACK_ORDERS.find((o) => o.value === value)?.label ?? value
}
