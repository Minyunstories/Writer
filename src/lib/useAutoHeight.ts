import { useLayoutEffect, type RefObject } from 'react'

/** Lets a text area grow and shrink with its text, so long values show in full. */
/** `shown` changes when the field appears again, e.g. after switching from links to editing. */
export function useAutoHeight(ref: RefObject<HTMLTextAreaElement | null>, value: string, shown: unknown = true): void {
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = 'auto'
    // Hidden or not laid out (e.g. in tests): leave the height to CSS.
    if (element.scrollHeight > 0) element.style.height = `${element.scrollHeight}px`
    else element.style.height = ''
  }, [ref, value, shown])
}
