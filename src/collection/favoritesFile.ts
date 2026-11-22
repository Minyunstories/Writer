import { extraOf, isObject, json, readJson, str, withExtra } from '../lib/fileFields'
import type { FileData } from '../sync/hash'
import type { FavoriteMark, Favorites } from '../types'

export { FAVORITES_PATH } from '../sync/files'

const KNOWN_TOP = ['marks']
const KNOWN_MARK = ['category', 'text', 'on', 'updatedAt']

/** One word in one category; the text ignores case and outer spaces, so a re-imported word keeps its star. */
export const favoriteKey = (category: string, text: string) => `${category.trim()}\u0000${text.trim().toLowerCase()}`
const keyOf = (mark: FavoriteMark) => favoriteKey(mark.category, mark.text)

/** The keys of the words that are favourites now. */
export const favoriteKeys = (favorites: Favorites) => new Set(favorites.marks.filter((mark) => mark.on).map(keyOf))

/** collection/favorites.json, sorted, unknown fields kept. Undefined when nothing was ever marked. */
export function favoritesFile(favorites: Favorites): string | undefined {
  if (favorites.marks.length === 0) return undefined
  const marks = [...favorites.marks]
    .sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0))
    .map((mark) => withExtra({ category: mark.category, text: mark.text, on: mark.on, updatedAt: mark.updatedAt }, mark.extra))
  return json(withExtra({ marks }, favorites.extra))
}

/** The favourites of a favorites.json; null when the file is not an object. */
export function parseFavorites(data: FileData | undefined): Favorites | null {
  const raw = readJson(data)
  if (!isObject(raw)) return null
  const marks = new Map<string, FavoriteMark>()
  for (const value of Array.isArray(raw.marks) ? raw.marks : []) {
    if (!isObject(value) || !str(value.category) || !str(value.text)) continue
    const mark: FavoriteMark = { category: value.category, text: value.text, on: value.on === true, updatedAt: Number(value.updatedAt) || 0 }
    const extra = extraOf(value, KNOWN_MARK)
    if (extra) mark.extra = extra
    // A word listed twice keeps its newest mark.
    const other = marks.get(keyOf(mark))
    if (!other || mark.updatedAt > other.updatedAt) marks.set(keyOf(mark), mark)
  }
  const favorites: Favorites = { marks: [...marks.values()] }
  const extra = extraOf(raw, KNOWN_TOP)
  if (extra) favorites.extra = extra
  return favorites
}

/** Both sides changed the favourites: per word the newer mark wins (on a tie, this device's). */
export function mergeFavorites(mine: Favorites, theirs: Favorites): Favorites {
  const marks = new Map<string, FavoriteMark>()
  for (const mark of theirs.marks) marks.set(keyOf(mark), mark)
  for (const mark of mine.marks) {
    const other = marks.get(keyOf(mark))
    if (!other || mark.updatedAt >= other.updatedAt) marks.set(keyOf(mark), mark)
  }
  const sorted = [...marks.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, mark]) => mark)
  return { marks: sorted, ...(mine.extra ?? theirs.extra ? { extra: mine.extra ?? theirs.extra } : {}) }
}
