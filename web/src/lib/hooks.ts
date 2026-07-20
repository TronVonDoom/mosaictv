import { useCallback, useEffect, useRef, useState } from 'react'

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
