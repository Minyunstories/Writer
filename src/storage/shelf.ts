import { isCoverPattern } from '../shelf/shelf'
import type { Book, BookShelf } from '../types'
import { announceChange, db } from './connection'

/**
 * Changes how a book stands on the shelf. Like the cover colour, this keeps the book's
 * "last changed" date. When nothing actually changes, nothing is written.
 */
async function updateShelf(bookId: string, change: (shelf: BookShelf) => BookShelf): Promise<void> {
  const tx = (await db()).transaction('books', 'readwrite')
  const current = await tx.store.get(bookId)
  if (!current) throw new Error(`Book not found: ${bookId}`)
  const before = current.shelf ?? {}
  const after = change({ ...before })
  if (after.starred === before.starred && after.pattern === before.pattern) {
    await tx.done
    return
  }
  const next: Book = { ...current, shelf: after }
  if (!after.starred && !after.pattern && !after.extra) delete next.shelf
  await tx.store.put(next)
  await tx.done
  announceChange()
}

export async function setStarred(bookId: string, starred: boolean): Promise<void> {
  await updateShelf(bookId, (shelf) => {
    if (starred) shelf.starred = true
    else delete shelf.starred
    return shelf
  })
}

/** Sets the cover pattern; null removes it. Patterns this version does not offer are ignored. */
export async function setPattern(bookId: string, pattern: string | null): Promise<void> {
  if (pattern !== null && !isCoverPattern(pattern)) return
  await updateShelf(bookId, (shelf) => {
    if (pattern) shelf.pattern = pattern
    else delete shelf.pattern
    return shelf
  })
}
