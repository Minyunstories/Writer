import type { Book, BookSpelling, EnglishDialect } from '../types'
import { announceChange, db } from './connection'

export const DIALECTS: EnglishDialect[] = ['american', 'british', 'australian', 'canadian']

/** Only usable settings, without empty lists. */
export function cleanSpelling(value: unknown): BookSpelling | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const raw = value as Record<string, unknown>
  const strings = (list: unknown) =>
    Array.isArray(list) ? [...new Set(list.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()))] : []
  const spelling: BookSpelling = {}
  if (typeof raw.dialect === 'string' && (DIALECTS as string[]).includes(raw.dialect)) spelling.dialect = raw.dialect as EnglishDialect
  const words = strings(raw.words)
  if (words.length > 0) spelling.words = words
  const ignored = strings(raw.ignored)
  if (ignored.length > 0) spelling.ignored = ignored
  return Object.keys(spelling).length > 0 ? spelling : undefined
}

/** Changes a book's spelling settings inside one transaction. */
export async function updateSpelling(bookId: string, update: (current: BookSpelling) => BookSpelling): Promise<void> {
  const tx = (await db()).transaction('books', 'readwrite')
  const book = await tx.store.get(bookId)
  if (book) {
    const next: Book = { ...book }
    const spelling = cleanSpelling(update({ ...book.spelling }))
    if (spelling) next.spelling = spelling
    else delete next.spelling
    await tx.store.put(next)
  }
  await tx.done
  if (book) announceChange()
}
