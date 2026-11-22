import { favoriteKey } from '../collection/favoritesFile'
import type { Favorites } from '../types'
import { announceChange, db } from './connection'

export const FAVORITES_ID = 'favorites'

/** The favourites of the collection (all books, all devices). */
export async function getFavorites(): Promise<Favorites> {
  const stored = await (await db()).get('shared', FAVORITES_ID)
  if (!stored || !('marks' in stored)) return { marks: [] }
  const { id: _id, ...favorites } = stored
  return favorites
}

/** Marks a word as favourite or takes the mark away (kept as "off", so the sync knows it is newer). Nothing is written when it already is so. */
export async function setFavorite(category: string, text: string, on: boolean): Promise<void> {
  const tx = (await db()).transaction('shared', 'readwrite')
  const stored = await tx.store.get(FAVORITES_ID)
  const current: Favorites = stored && 'marks' in stored ? { marks: stored.marks, extra: stored.extra } : { marks: [] }
  const key = favoriteKey(category, text)
  const old = current.marks.find((mark) => favoriteKey(mark.category, mark.text) === key)
  if ((old?.on ?? false) === on) {
    await tx.done
    return
  }
  // Always later than the mark it replaces, even within the same millisecond.
  const updatedAt = Math.max(Date.now(), (old?.updatedAt ?? 0) + 1)
  const marks = old
    ? current.marks.map((mark) => (mark === old ? { ...mark, on, updatedAt } : mark))
    : [...current.marks, { category: category.trim(), text: text.trim(), on, updatedAt }]
  await tx.store.put({ ...(current.extra ? { extra: current.extra } : {}), marks, id: FAVORITES_ID })
  await tx.done
  announceChange()
}

/** Flips the mark of a word. */
export async function toggleFavorite(category: string, text: string): Promise<void> {
  const favorites = await getFavorites()
  const key = favoriteKey(category, text)
  await setFavorite(category, text, !favorites.marks.some((mark) => mark.on && favoriteKey(mark.category, mark.text) === key))
}
