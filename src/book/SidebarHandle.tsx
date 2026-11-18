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
export function SidebarHandle({ width, onWidth, onCollapse }: { width: number; onWidth: (width: number) => void; onCollapse?: () => void }) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const move = (moveEvent: globalThis.PointerEvent) => {
      const next = startWidth + moveEvent.clientX - startX
      // Pulled well past the narrowest width: the sidebar folds away.
      if (onCollapse && next < MIN_WIDTH - 60) {
        up()
        onCollapse()
        return
      }
      onWidth(next)
    }
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

const PANEL_KEY = 'mw:panel-width'
export const PANEL_MIN = 300
export const PANEL_MAX = 900
const PANEL_DEFAULT = 380
const clampPanel = (value: number) => Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(value)))

/** The width of the panel on the right (notepad, wiki entry, search), remembered on this device. */
export function usePanelWidth(): [number, (width: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const stored = Number(localStorage.getItem(PANEL_KEY))
      return stored ? clampPanel(stored) : PANEL_DEFAULT
    } catch {
      return PANEL_DEFAULT
    }
  })
  const change = (next: number) => {
    // Never wider than leaves room for the text.
    const value = clampPanel(Math.min(next, window.innerWidth - 360))
    setWidth(value)
    try {
      localStorage.setItem(PANEL_KEY, String(value))
    } catch {
      // Not stored; the width still applies until the page is closed.
    }
  }
  return [width, change]
}

/** The grip on the panel's left edge: drag it, or use the arrow keys. */
export function PanelHandle({ width, onWidth }: { width: number; onWidth: (width: number) => void }) {
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    const move = (moveEvent: globalThis.PointerEvent) => onWidth(startWidth - (moveEvent.clientX - startX))
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
    if (event.key === 'ArrowLeft') onWidth(width + STEP)
    else if (event.key === 'ArrowRight') onWidth(width - STEP)
    else return
    event.preventDefault()
  }
  return (
    <div
      className="panel-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Breite der rechten Leiste"
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onWidth(PANEL_DEFAULT)}
    />
  )
}
