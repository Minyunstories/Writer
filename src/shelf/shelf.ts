import type { Book } from '../types'

/** Cover patterns offered on the shelf, drawn as bands at the top and bottom of the cover. */
export const COVER_PATTERNS = [
  { id: 'stripes', name: 'Streifen' },
  { id: 'diamonds', name: 'Rauten' },
  { id: 'dots', name: 'Punkte' },
  { id: 'zigzag', name: 'Zickzack' },
  { id: 'scales', name: 'Schuppen' },
] as const

export type CoverPattern = (typeof COVER_PATTERNS)[number]['id']

export function isCoverPattern(value: unknown): value is CoverPattern {
  return COVER_PATTERNS.some((pattern) => pattern.id === value)
}

export function isStarred(book: Pick<Book, 'shelf'>): boolean {
  return book.shelf?.starred === true
}

/** The pattern to draw; undefined for none or one this version does not know. */
export function patternOf(book: Pick<Book, 'shelf'>): CoverPattern | undefined {
  const pattern = book.shelf?.pattern
  return isCoverPattern(pattern) ? pattern : undefined
}

/** The order on the shelf: starred books first, then the rest; in each, the last changed first. */
export function shelfOrder<T extends Pick<Book, 'shelf' | 'updatedAt'>>(books: T[]): T[] {
  return [...books].sort((a, b) => Number(isStarred(b)) - Number(isStarred(a)) || b.updatedAt - a.updatedAt)
}
