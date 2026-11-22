import { favoriteKey } from './favoritesFile'

const KEY = 'mw:collection-recent'
const MAX = 300

/** Words of the collection used on this device (key → when), newest first. Only this device. */
export function recentUses(): Map<string, number> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(raw)) return new Map()
    return new Map(raw.filter((entry): entry is [string, number] => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number'))
  } catch {
    return new Map()
  }
}

/** Remembers that a word was put into the text just now. */
export function recordUse(category: string, text: string): void {
  const key = favoriteKey(category, text)
  const uses = [...recentUses()].filter(([other]) => other !== key)
  const last = uses[0]?.[1] ?? 0
  // Always later than the last use, so newest first holds even within one millisecond.
  const entries = [[key, Math.max(Date.now(), last + 1)] as const, ...uses].slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(entries))
  } catch {
    // Only a convenience.
  }
}
