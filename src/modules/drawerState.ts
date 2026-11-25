import { useCallback, useEffect, useState } from 'react'

function read<T extends string | number>(key: string, initial: T): T {
  try {
    const stored = localStorage.getItem(key)
    if (stored === null) return initial
    if (typeof initial === 'number') {
      const value = Number(stored)
      return (Number.isFinite(value) ? value : initial) as T
    }
    return stored as T
  } catch {
    return initial
  }
}

/** A value remembered on this device (not synchronised). Follows the key when it changes, e.g. another book. */
export function useStored<T extends string | number>(key: string, initial: T): [T, (value: T) => void] {
  const [state, setState] = useState<{ key: string; value: T }>(() => ({ key, value: read(key, initial) }))
  useEffect(() => {
    if (state.key !== key) setState({ key, value: read(key, initial) })
  }, [key, initial, state.key])
  const set = useCallback(
    (value: T) => {
      setState({ key, value })
      try {
        localStorage.setItem(key, String(value))
      } catch {
        // Not stored; the value still applies until the page is closed.
      }
    },
    [key],
  )
  return [state.key === key ? state.value : read(key, initial), set]
}

export const MIN_DRAWER = 140
export const MAX_DRAWER = 600
const DEFAULT_DRAWER = 260

const clamp = (value: number, max = MAX_DRAWER) => Math.min(max, Math.max(MIN_DRAWER, Math.round(value)))

/** At most about 60 % of the window, so a small window keeps room for the text (never below the minimum). */
const windowMax = () => Math.max(MIN_DRAWER, Math.min(MAX_DRAWER, Math.round(window.innerHeight * 0.6)))

/** The height of the module drawer, remembered on this device; it shrinks with a small window and grows back. */
export function useDrawerHeight(): [number, (height: number) => void] {
  const [height, setHeight] = useStored<number>('mw:drawer-height', DEFAULT_DRAWER)
  const [max, setMax] = useState(windowMax)
  useEffect(() => {
    const onResize = () => setMax(windowMax())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  // Dragging starts from the height shown, so the limit of the window is also the limit of the drag.
  // Pulling up against that limit keeps a larger chosen height for when the window is large again.
  const change = useCallback((next: number) => setHeight(next >= max ? Math.max(clamp(height), max) : clamp(next, max)), [setHeight, max, height])
  return [clamp(height, max), change]
}
