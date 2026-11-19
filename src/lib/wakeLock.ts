import { useEffect } from 'react'

/** After this long without a key, touch, click or scroll, the screen may go dark again. */
export const IDLE_AFTER_MS = 10 * 60 * 1000

interface Sentinel {
  readonly released: boolean
  release(): Promise<void>
}

interface WakeLockApi {
  request(type: 'screen'): Promise<Sentinel>
}

const ACTIVITY = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const

/**
 * Keeps the screen on while `active` and the app is in front, until ten minutes pass without
 * anything being done. The next key, touch, click or scroll asks for it again. Browsers without
 * the Screen Wake Lock API, or that refuse it (battery saver), simply leave the screen alone.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock
    if (!api) return

    let sentinel: Sentinel | null = null
    let pending = false
    let stopped = false
    let idle: ReturnType<typeof setTimeout> | undefined

    const release = () => {
      const held = sentinel
      sentinel = null
      if (held && !held.released) held.release().catch(() => {})
    }

    const acquire = () => {
      if (pending || stopped || document.visibilityState !== 'visible') return
      if (sentinel && !sentinel.released) return
      pending = true
      api.request('screen').then(
        (got) => {
          pending = false
          if (stopped) got.release().catch(() => {})
          else sentinel = got
        },
        () => {
          pending = false
        },
      )
    }

    const wake = () => {
      clearTimeout(idle)
      idle = setTimeout(release, IDLE_AFTER_MS)
      acquire()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') wake()
    }

    for (const type of ACTIVITY) document.addEventListener(type, wake, { passive: true })
    // Scroll events do not bubble; the editor scrolls inside its own element.
    document.addEventListener('scroll', wake, { capture: true, passive: true })
    document.addEventListener('visibilitychange', onVisibility)
    wake()

    return () => {
      stopped = true
      clearTimeout(idle)
      for (const type of ACTIVITY) document.removeEventListener(type, wake)
      document.removeEventListener('scroll', wake, { capture: true })
      document.removeEventListener('visibilitychange', onVisibility)
      release()
    }
  }, [active])
}
