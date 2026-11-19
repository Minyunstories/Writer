import { diffChars } from 'diff'

export interface TextChange {
  from: number
  to: number
  insert: string
}

/** Above this many differing characters, one replacement of the changed middle is good enough. */
const MAX_EDIT = 2000

/**
 * The changes that turn `before` into `after`, touching only what differs. When stored text comes
 * into an open editor this way, the cursor and the comment marks outside the changed spots stay
 * where they are (a replacement of the whole document would push them all to the end).
 */
export function minimalChanges(before: string, after: string): TextChange[] {
  if (before === after) return []
  let start = 0
  const shorter = Math.min(before.length, after.length)
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore--
    endAfter--
  }
  const oldMiddle = before.slice(start, endBefore)
  const newMiddle = after.slice(start, endAfter)
  const whole: TextChange[] = [{ from: start, to: endBefore, insert: newMiddle }]
  if (!oldMiddle || !newMiddle) return whole

  const parts = diffChars(oldMiddle, newMiddle, { maxEditLength: MAX_EDIT })
  if (!parts) return whole
  const changes: TextChange[] = []
  let pos = start
  let open: TextChange | null = null
  for (const part of parts) {
    if (part.added) {
      open ??= { from: pos, to: pos, insert: '' }
      open.insert += part.value
    } else if (part.removed) {
      open ??= { from: pos, to: pos, insert: '' }
      open.to += part.value.length
      pos += part.value.length
    } else {
      if (open) changes.push(open)
      open = null
      pos += part.value.length
    }
  }
  if (open) changes.push(open)
  return changes
}
