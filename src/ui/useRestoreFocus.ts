import { useEffect, useState, type RefObject } from 'react'

/**
 * Gives the focus back to where it was (usually the chapter text) when a window closes, so the
 * writer can type on. The element is taken while rendering, before `autoFocus` moves the focus.
 *
 * Only a real close counts: React's StrictMode runs every effect, its cleanup and the effect again
 * right after mounting; the window is still on the page then, and the focus stays in it.
 */
export function useRestoreFocus(windowRef: RefObject<HTMLElement | null>): void {
  const [before] = useState(() => document.activeElement)
  useEffect(() => {
    const node = windowRef.current
    return () => {
      if (node?.isConnected) return
      if (before instanceof HTMLElement && before.isConnected) before.focus()
    }
  }, [before, windowRef])
}
