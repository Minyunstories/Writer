import type { Book, BookNote } from '../types'
import { announceChange, db, newId } from './connection'
import { updateChapter } from './db'
import { updateEntry } from './wiki'

/** Changes the book record inside one transaction. */
async function changeBook(bookId: string, change: (book: Book) => Book | null): Promise<Book | null> {
  const tx = (await db()).transaction('books', 'readwrite')
  const current = await tx.store.get(bookId)
  const next = current ? change(current) : null
  if (next) await tx.store.put(next)
  await tx.done
  if (next) announceChange()
  return next
}

const withNotes = (book: Book, notes: BookNote[]): Book => {
  const next: Book = { ...book }
  if (notes.length > 0) next.notes = notes
  else delete next.notes
  return next
}

/** A new idea at the top of the notepad; null when the text is empty. */
export async function addNote(bookId: string, text: string, origin?: { chapterId: string; from?: number }): Promise<BookNote | null> {
  const cleaned = text.trim()
  if (!cleaned) return null
  const now = Date.now()
  const note: BookNote = { id: newId(), text: cleaned, done: false, createdAt: now, updatedAt: now }
  if (origin?.chapterId) {
    note.chapterId = origin.chapterId
    if (origin.from !== undefined) note.from = origin.from
  }
  await changeBook(bookId, (book) => withNotes(book, [note, ...(book.notes ?? [])]))
  return note
}

export async function updateNote(bookId: string, id: string, patch: Partial<Pick<BookNote, 'text' | 'done'>>): Promise<void> {
  await changeBook(bookId, (book) =>
    withNotes(
      book,
      (book.notes ?? []).map((note) => (note.id === id ? { ...note, ...patch, updatedAt: Date.now() } : note)),
    ),
  )
}

export async function deleteNote(bookId: string, id: string): Promise<void> {
  await changeBook(bookId, (book) => withNotes(book, (book.notes ?? []).filter((note) => note.id !== id)))
}

const append = (existing: string, text: string) => (existing.trim() ? `${existing.replace(/\s+$/, '')}\n\n${text}` : text)

async function noteText(bookId: string, id: string): Promise<string | null> {
  const book = await (await db()).get('books', bookId)
  return book?.notes?.find((note) => note.id === id)?.text ?? null
}

/** Appends the idea to a chapter's outline note and marks it done. */
export async function moveNoteToChapter(bookId: string, id: string, chapterId: string): Promise<void> {
  const text = await noteText(bookId, id)
  if (text === null) return
  const chapter = await (await db()).get('chapters', chapterId)
  if (!chapter) return
  await updateChapter(chapterId, { outline: append(chapter.outline ?? '', text) })
  await updateNote(bookId, id, { done: true })
}

/** Appends the idea to a wiki entry's notes and marks it done. */
export async function moveNoteToEntry(bookId: string, id: string, entryId: string): Promise<void> {
  const text = await noteText(bookId, id)
  if (text === null) return
  const entry = await (await db()).get('wikiEntries', entryId)
  if (!entry) return
  await updateEntry(entryId, { body: append(entry.body, text) })
  await updateNote(bookId, id, { done: true })
}

/** Marks a wiki entry with a star, or removes the star. */
export async function setEntryStar(bookId: string, entryId: string, starred: boolean): Promise<void> {
  await changeBook(bookId, (book) => {
    const stars = (book.wikiStars ?? []).filter((id) => id !== entryId)
    if (starred) stars.push(entryId)
    const next: Book = { ...book }
    if (stars.length > 0) next.wikiStars = stars
    else delete next.wikiStars
    return next
  })
}
