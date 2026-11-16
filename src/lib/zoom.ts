import { useCallback, useEffect, useState } from 'react'
import type { ZoomArea } from '../types'

export const ZOOM_MIN = 50
export const ZOOM_MAX = 200
export const ZOOM_STEP = 10
const DEFAULT_ZOOM = 100
const EVENT = 'mw:zoom'

const memory = new Map<ZoomArea, number>()

function key(area: ZoomArea): string {
  return `mw.zoom.${area}`
}

function normalize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped))
}

export function getZoom(area: ZoomArea): number {
  try {
    const raw = localStorage.getItem(key(area))
    if (raw !== null) {
      const parsed = Number(raw)
      return Number.isFinite(parsed) ? normalize(parsed) : DEFAULT_ZOOM
    }
  } catch {
    // Storage unavailable: fall through to the in-memory value.
  }
  return memory.get(area) ?? DEFAULT_ZOOM
}

export function setZoom(area: ZoomArea, value: number): number {
  const next = normalize(value)
  memory.set(area, next)
  try {
    localStorage.setItem(key(area), String(next))
  } catch {
    // Keep the in-memory value.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: area }))
  return next
}

export function useZoom(area: ZoomArea): [number, (value: number) => void] {
  const [zoom, setState] = useState(() => getZoom(area))

  useEffect(() => {
    setState(getZoom(area))
    const onChange = (event: Event) => {
      if ((event as CustomEvent<ZoomArea>).detail === area) setState(getZoom(area))
    }
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [area])

  const update = useCallback((value: number) => void setZoom(area, value), [area])
  return [zoom, update]
}
