import type { Book, Chapter, ChapterGroup } from '../types'
import { announceChange, cleanTitle, db, newId } from './connection'

const withGroups = (book: Book, groups: ChapterGroup[]): Book => {
  const next: Book = { ...book }
  if (groups.length) next.chapterGroups = groups
  else delete next.chapterGroups
  return next
}

export async function createGroup(bookId: string, name: string): Promise<ChapterGroup> {
  const group: ChapterGroup = { id: newId(), name: cleanTitle(name) }
  const tx = (await db()).transaction('books', 'readwrite')
  const book = await tx.store.get(bookId)
  if (book) await tx.store.put(withGroups(book, [...(book.chapterGroups ?? []), group]))
  await tx.done
  announceChange()
  return group
}

export async function renameGroup(bookId: string, id: string, name: string): Promise<void> {
  const tx = (await db()).transaction('books', 'readwrite')
  const book = await tx.store.get(bookId)
  if (book) await tx.store.put(withGroups(book, (book.chapterGroups ?? []).map((group) => (group.id === id ? { ...group, name: cleanTitle(name) } : group))))
  await tx.done
  announceChange()
}

/** Removes the group; its chapters stay, without a group. */
export async function deleteGroup(bookId: string, id: string): Promise<void> {
  const tx = (await db()).transaction(['books', 'chapters'], 'readwrite')
  const book = await tx.objectStore('books').get(bookId)
  if (book) await tx.objectStore('books').put(withGroups(book, (book.chapterGroups ?? []).filter((group) => group.id !== id)))
  const chapters = tx.objectStore('chapters')
  for (const chapter of await chapters.index('bookId').getAll(bookId)) {
    if (chapter.group !== id) continue
    const next: Chapter = { ...chapter }
    delete next.group
    await chapters.put(next)
  }
  await tx.done
  announceChange()
}

export async function setChapterGroup(chapterId: string, groupId: string | null): Promise<void> {
  const tx = (await db()).transaction('chapters', 'readwrite')
  const chapter = await tx.store.get(chapterId)
  if (chapter && (chapter.group ?? null) !== groupId) {
    const next: Chapter = { ...chapter }
    if (groupId) next.group = groupId
    else delete next.group
    await tx.store.put(next)
  }
  await tx.done
  announceChange()
}
