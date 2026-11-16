import { useState, type KeyboardEvent, type PointerEvent } from 'react'

const KEY = 'mw:sidebar-width'
export const MIN_WIDTH = 200
export const MAX_WIDTH = 480
const DEFAULT_WIDTH = 260
const STEP = 16

const clamp = (value: number) => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)))

/** The sidebar width, remembered on this device. */
export function useSidebarWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(KEY))
      return stored ? clamp(stored) : DEFAULT_WIDTH
    } catch {
      return DEFAULT_WIDTH
    }
  })
  const change = (next: number) => {
    const value = clamp(next)
    setWidth(value)
    try {
      localStorage.setItem(KEY, String(value))
    } catch {
      // Not stored; the width still applies until the page is closed.
    }
  }
  return [width, change]
}

/** The grip on the sidebar's right edge: drag it, or use the arrow keys. */
export function SidebarHandle({ width, onWidth }: { width: number; onWidth: (width: number) => void }) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const move = (moveEvent: globalThis.PointerEvent) => onWidth(startWidth + moveEvent.clientX - startX)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
    }
    document.body.classList.add('resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') onWidth(width - STEP)
    else if (event.key === 'ArrowRight') onWidth(width + STEP)
    else return
    event.preventDefault()
  }
  return (
    <div
      className="sidebar-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Breite der Seitenleiste"
      aria-valuenow={width}
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      tabIndex={0}
      style={{ left: `${width - 3}px` }}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )
}
