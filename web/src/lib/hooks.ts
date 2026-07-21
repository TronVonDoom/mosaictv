import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * A tab selection mirrored into the URL hash, so a tab is linkable, survives a
 * reload, and responds to the back button. Pages that group several tools under
 * one route (Library, Studio, Settings) all need this, and each was previously
 * poking at `window.location.hash` by hand — which reads the hash once on mount
 * and then quietly disagrees with the URL when the user navigates.
 *
 * `aliases` keeps old anchors working after a tab is renamed or merged, so
 * links out in the wild (and in other pages' copy) still land somewhere sane.
 */
export function useHashTab<T extends string>(
  tabs: readonly T[],
  fallback: T,
  aliases: Partial<Record<string, T>> = {},
): [T, (tab: T) => void] {
  const { hash } = useLocation()
  const navigate = useNavigate()

  const resolve = (raw: string): T => {
    const id = raw.replace(/^#/, '')
    if ((tabs as readonly string[]).includes(id)) return id as T
    return aliases[id] ?? fallback
  }

  const active = resolve(hash)
  // `replace` so tab-flipping doesn't stack up history entries between the page
  // the user arrived from and wherever they go next.
  const setTab = useCallback((tab: T) => navigate(`#${tab}`, { replace: true }), [navigate])

  return [active, setTab]
}

/**
 * A cache of in-progress form values, keyed by form. Owned by whichever
 * component should bound the drafts' lifetime — create one with
 * `useRef(new Map()).current` and pass it down.
 */
export type DraftCache = Map<string, unknown>

/**
 * Form state that survives its component unmounting.
 *
 * Splitting the channel editor into per-tab components made each tab unmount
 * when you leave it, which silently discarded a half-filled form on the way to
 * check something on another tab. Lifting the state back into the page would
 * undo the split, so the draft lives in a cache the page owns instead: the tab
 * keeps its own state, and the cache just outlives the component.
 *
 * Because the page owns the cache, drafts die when you leave the channel —
 * surviving a tab switch is the point, being ambushed by yesterday's half-edit
 * is not. Call `clear` after a successful save so the next mount re-seeds from
 * the server rather than replaying what you already committed.
 */
export function useDraft<T>(
  cache: DraftCache,
  key: string,
  makeInitial: () => T,
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const [state, setState] = useState<T>(() =>
    cache.has(key) ? (cache.get(key) as T) : makeInitial(),
  )

  const set = useCallback(
    (value: T | ((prev: T) => T)) => {
      setState((prev) => {
        const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value
        cache.set(key, next)
        return next
      })
    },
    [cache, key],
  )

  const clear = useCallback(() => cache.delete(key), [cache, key])

  return [state, set, clear]
}

/**
 * Run `fn` every `intervalMs` while `enabled`. Pure interval semantics — it
 * does NOT fire immediately, so callers keep whatever initial load they
 * already do (which is usually driven by different dependencies than the
 * refresh cadence).
 *
 * `fn` is held in a ref, so a handler redefined on every render doesn't
 * restart the timer.
 */
export function usePolling(fn: () => void, intervalMs: number, enabled = true): void {
  const saved = useRef(fn)
  saved.current = fn

  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => saved.current(), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs, enabled])
}

/**
 * Track a long-running server job (a library scan, a TMDB metadata fetch):
 * read its status once on mount, then poll once a second for as long as it
 * reports `running`, and call `onFinish` when it stops.
 *
 * Returns the latest status plus `start()`, which the caller invokes right
 * after kicking the job off so polling begins without waiting for the next
 * mount.
 */
export function useJobStatus<T extends { running: boolean }>(
  fetchStatus: () => Promise<T>,
  onFinish?: () => void,
): { status: T | null; start: () => void } {
  const [status, setStatus] = useState<T | null>(null)
  const timer = useRef<number | null>(null)
  const fetchRef = useRef(fetchStatus)
  const finishRef = useRef(onFinish)
  fetchRef.current = fetchStatus
  finishRef.current = onFinish

  const stop = useCallback(() => {
    if (timer.current != null) {
      window.clearInterval(timer.current)
      timer.current = null
    }
  }, [])

  const start = useCallback(() => {
    if (timer.current != null) return // already polling
    timer.current = window.setInterval(async () => {
      const s = await fetchRef.current().catch(() => null)
      if (!s) return
      setStatus(s)
      if (!s.running) {
        stop()
        finishRef.current?.()
      }
    }, 1000)
  }, [stop])

  useEffect(() => {
    // A job may already be running from a previous visit to this page.
    fetchRef
      .current()
      .then((s) => {
        setStatus(s)
        if (s.running) start()
      })
      .catch(() => {})
    return stop
  }, [start, stop])

  return { status, start }
}
