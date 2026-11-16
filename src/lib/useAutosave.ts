import { useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  /** Pause after the last change before saving, in ms. */
  delay?: number
  /** Wait before a failed save is tried again, in ms. */
  retryDelay?: number
  /** Called when a save fails after the component is gone, so the failure is still shown somewhere. */
  onFailedAfterClose?: () => void
}

/**
 * Collects changes and saves them after a short pause.
 * Saves run strictly one after another; a failed save is kept and retried, and
 * changes made in the meantime win over it. Pending changes are saved when the
 * component unmounts or the page is hidden.
 */
export function useAutosave<T extends object>(
  save: (patch: Partial<T>) => Promise<void>,
  { delay = 400, retryDelay = 2000, onFailedAfterClose }: Options = {},
): { change(patch: Partial<T>): void; flush(): Promise<void>; failed: boolean } {
  const [failed, setFailed] = useState(false)
  const pending = useRef<Partial<T>>({})
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const running = useRef<Promise<void> | null>(null)
  const mounted = useRef(true)
  const saveRef = useRef(save)
  saveRef.current = save
  const onFailedRef = useRef(onFailedAfterClose)
  onFailedRef.current = onFailedAfterClose

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current)
    while (running.current) await running.current
    const patch = pending.current
    if (Object.keys(patch).length === 0) return
    pending.current = {}
    const run = (async () => {
      try {
        await saveRef.current(patch)
        if (mounted.current) setFailed(false)
      } catch {
        // Nothing was stored. Keep it, but let newer changes win.
        pending.current = { ...patch, ...pending.current }
        if (mounted.current) setFailed(true)
        else onFailedRef.current?.()
        timer.current = setTimeout(() => void flush(), retryDelay)
      }
    })()
    running.current = run
    await run
    if (running.current === run) running.current = null
  }, [retryDelay])

  const change = useCallback(
    (patch: Partial<T>) => {
      pending.current = { ...pending.current, ...patch }
      clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), delay)
    },
    [delay, flush],
  )

  useEffect(() => {
    mounted.current = true
    const onHide = () => void flush()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      mounted.current = false
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      void flush()
    }
  }, [flush])

  return { change, flush, failed }
}
