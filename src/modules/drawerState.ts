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

const clamp = (value: number) => Math.min(MAX_DRAWER, Math.max(MIN_DRAWER, Math.round(value)))

/** The height of the module drawer, remembered on this device. */
export function useDrawerHeight(): [number, (height: number) => void] {
  const [height, setHeight] = useStored<number>('mw:drawer-height', DEFAULT_DRAWER)
  const change = useCallback((next: number) => setHeight(clamp(next)), [setHeight])
  return [clamp(height), change]
}
