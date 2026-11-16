import { beforeEach, expect, test } from 'vitest'
import { createBook, createChapter, getBook, getChapter, resetDatabaseForTests } from './db'
import { addNote, deleteNote, moveNoteToChapter, moveNoteToEntry, setEntryStar, updateNote } from './notes'
import { createEntry, getEntry, updateEntry } from './wiki'

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('notes are added newest first, can be done, reopened and deleted', async () => {
  const book = await createBook('B')
  const chapter = await createChapter(book.id, 'A')
  const first = await addNote(book.id, '  Idee eins  ', { chapterId: chapter.id, from: 4 })
  const second = await addNote(book.id, 'Idee zwei')
  expect(await addNote(book.id, '   ')).toBeNull()
  let notes = (await getBook(book.id))!.notes!
  expect(notes.map((n) => n.text)).toEqual(['Idee zwei', 'Idee eins'])
  expect(notes[1]).toMatchObject({ chapterId: chapter.id, from: 4, done: false })
  await updateNote(book.id, first!.id, { done: true })
  notes = (await getBook(book.id))!.notes!
  expect(notes.find((n) => n.id === first!.id)!.done).toBe(true)
  await deleteNote(book.id, second!.id)
  expect((await getBook(book.id))!.notes!.map((n) => n.id)).toEqual([first!.id])
})

test('a note moves to a chapter outline or a wiki entry and is then done', async () => {
  const book = await createBook('B')
  const chapter = await createChapter(book.id, 'A')
  const entry = await createEntry(book.id, 'Mira')
  await updateEntry(entry.id, { body: 'Alt.' })
  const a = await addNote(book.id, 'Sturm im dritten Kapitel')
  const b = await addNote(book.id, 'Hat Angst vor Wasser')
  await moveNoteToChapter(book.id, a!.id, chapter.id)
  expect((await getChapter(chapter.id))!.outline).toBe('Sturm im dritten Kapitel')
  await moveNoteToEntry(book.id, b!.id, entry.id)
  expect((await getEntry(entry.id))!.body).toBe('Alt.\n\nHat Angst vor Wasser')
  expect((await getBook(book.id))!.notes!.every((n) => n.done)).toBe(true)
})

test('entries can be starred and unstarred', async () => {
  const book = await createBook('B')
  const entry = await createEntry(book.id, 'Mira')
  await setEntryStar(book.id, entry.id, true)
  await setEntryStar(book.id, entry.id, true)
  expect((await getBook(book.id))!.wikiStars).toEqual([entry.id])
  await setEntryStar(book.id, entry.id, false)
  expect((await getBook(book.id))!.wikiStars).toBeUndefined()
})
