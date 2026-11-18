import { beforeEach, expect, test } from 'vitest'
import { COVERS, coverOf, HIGHLIGHTS, highlightOf } from '../lib/bookStyle'
import type { Book } from '../types'
import {
  ConflictError,
  createBook,
  createChapter,
  deleteBook,
  deleteChapter,
  getBook,
  getChapter,
  listBooks,
  changeChapterTags,
  nextCover,
  savePlace,
  setBookStyle,
  setChapterDate,
  listChapters,
  moveChapter,
  resetDatabaseForTests,
  updateBook,
  updateChapter,
} from './db'

const tick = () => new Promise((r) => setTimeout(r, 3))

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('createBook trims the title and falls back to Unbenannt', async () => {
  const book = await createBook('  ')
  expect(book.title).toBe('Unbenannt')
  expect(book.font).toBe('literata')
  expect(book.chapterOrder).toEqual([])
  expect((await createBook('  Sturmlied ')).title).toBe('Sturmlied')
})

test('chapters come back in chapterOrder and follow a reorder', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, 'A')
  const b = await createChapter(book.id, 'B')
  expect((await listChapters(book.id)).map((c) => c.id)).toEqual([a.id, b.id])
  await updateBook(book.id, { chapterOrder: [b.id, a.id] })
  expect((await listChapters(book.id)).map((c) => c.id)).toEqual([b.id, a.id])
})

test('chapter titles fall back to Unbenannt', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, '   ')
  expect(a.title).toBe('Unbenannt')
  expect((await updateChapter(a.id, { title: '' })).title).toBe('Unbenannt')
})

test('deleteChapter removes the id from chapterOrder', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, 'A')
  const b = await createChapter(book.id, 'B')
  await deleteChapter(a.id)
  expect((await getBook(book.id))!.chapterOrder).toEqual([b.id])
  expect(await getChapter(a.id)).toBeUndefined()
})

test('deleteBook leaves no orphaned chapters', async () => {
  const book = await createBook('B')
  const other = await createBook('Other')
  const a = await createChapter(book.id, 'A')
  const keep = await createChapter(other.id, 'Keep')
  await deleteBook(book.id)
  expect(await getBook(book.id)).toBeUndefined()
  expect(await getChapter(a.id)).toBeUndefined()
  expect(await getChapter(keep.id)).toBeDefined()
})

test('updateChapter bumps updatedAt on chapter and book', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, 'A')
  const bookBefore = (await getBook(book.id))!.updatedAt
  await tick()
  const updated = await updateChapter(a.id, { content: 'neu' })
  expect(updated.content).toBe('neu')
  expect(updated.updatedAt).toBeGreaterThan(a.updatedAt)
  expect((await getBook(book.id))!.updatedAt).toBeGreaterThan(bookBefore)
})

test('listBooks returns the most recently updated book first', async () => {
  const first = await createBook('First')
  await tick()
  const second = await createBook('Second')
  expect((await listBooks()).map((b) => b.id)).toEqual([second.id, first.id])
  await tick()
  await updateBook(first.id, { title: 'First!' })
  expect((await listBooks()).map((b) => b.id)).toEqual([first.id, second.id])
})

test('updating a missing record rejects', async () => {
  await expect(updateBook('nope', { title: 'x' })).rejects.toThrow()
  await expect(updateChapter('nope', { title: 'x' })).rejects.toThrow()
})

test('updateChapter refuses to overwrite content that changed elsewhere', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, 'A', 'Anfang')
  expect(a.content).toBe('Anfang')
  await updateChapter(a.id, { content: 'aus Tab B' })
  await expect(
    updateChapter(a.id, { content: 'aus Tab A' }, { expectedContent: 'Anfang' }),
  ).rejects.toBeInstanceOf(ConflictError)
  expect((await getChapter(a.id))!.content).toBe('aus Tab B')
  await updateChapter(a.id, { content: 'weiter' }, { expectedContent: 'aus Tab B' })
  expect((await getChapter(a.id))!.content).toBe('weiter')
})

test('outline notes live beside the text and never trigger a conflict', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, 'A')
  expect(a.outline).toBe('')
  await updateChapter(a.id, { outline: 'Regen' })
  expect((await getChapter(a.id))!.content).toBe('')
  await updateChapter(a.id, { content: 'x' }, { expectedContent: '' })
  expect((await getChapter(a.id))!).toMatchObject({ content: 'x', outline: 'Regen' })
  // An editor elsewhere still expects the old text; a note update must not care.
  await updateChapter(a.id, { outline: 'Sturm' }, { expectedContent: 'something else' })
  expect((await getChapter(a.id))!).toMatchObject({ content: 'x', outline: 'Sturm' })
})

test('a note changed elsewhere is not overwritten', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, 'A')
  await updateChapter(a.id, { outline: 'aus Tab B' })
  await expect(updateChapter(a.id, { outline: 'aus Tab A' }, { expectedOutline: '' })).rejects.toBeInstanceOf(
    ConflictError,
  )
  expect((await getChapter(a.id))!.outline).toBe('aus Tab B')
  await updateChapter(a.id, { outline: 'weiter' }, { expectedOutline: 'aus Tab B' })
  expect((await getChapter(a.id))!.outline).toBe('weiter')
})

test('moveChapter works on the stored order, so moves made from an outdated view both apply', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, 'A')
  const b = await createChapter(book.id, 'B')
  const c = await createChapter(book.id, 'C')
  // Both moves were decided while the screen still showed A, B, C.
  await moveChapter(book.id, a.id, { after: b.id })
  await moveChapter(book.id, c.id, { before: b.id })
  expect((await getBook(book.id))!.chapterOrder).toEqual([c.id, b.id, a.id])
  await moveChapter(book.id, a.id, { before: c.id })
  expect((await getBook(book.id))!.chapterOrder).toEqual([a.id, c.id, b.id])
})

test('moveChapter repairs an order with missing or deleted chapters', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, 'A')
  const b = await createChapter(book.id, 'B')
  const c = await createChapter(book.id, 'C')
  await updateBook(book.id, { chapterOrder: [a.id, 'deleted-long-ago', b.id] })
  await moveChapter(book.id, b.id, { before: a.id })
  expect((await getBook(book.id))!.chapterOrder).toEqual([b.id, a.id, c.id])
  await moveChapter(book.id, 'unknown', { before: a.id })
  expect((await getBook(book.id))!.chapterOrder).toEqual([b.id, a.id, c.id])
})

test('chapter tags are cleaned when stored', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, 'A')
  expect(a.tags).toBeUndefined()
  const updated = await updateChapter(a.id, { tags: [' PoV: Pascal ', '', 'Rückblick', 'PoV: Pascal'] })
  expect(updated.tags).toEqual(['PoV: Pascal', 'Rückblick'])
  expect((await getChapter(a.id))!.tags).toEqual(['PoV: Pascal', 'Rückblick'])
})

test('tag changes work on the stored tags, so quick changes never undo each other', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, 'A')
  await Promise.all([changeChapterTags(a.id, { add: 'Nacht' }), changeChapterTags(a.id, { add: 'Rückblick' })])
  expect((await getChapter(a.id))!.tags!.sort()).toEqual(['Nacht', 'Rückblick'])
  await changeChapterTags(a.id, { remove: 'Rückblick' })
  await changeChapterTags(a.id, { add: '  ' })
  await changeChapterTags(a.id, { add: 'Nacht' })
  expect((await getChapter(a.id))!.tags).toEqual(['Nacht'])
  await changeChapterTags(a.id, { remove: 'Nacht' })
  expect((await getChapter(a.id))!.tags).toBeUndefined()
})

test('chapter dates are trimmed, limited to 40 characters and cleared when empty', async () => {
  const book = await createBook('B')
  const c = await createChapter(book.id, 'A')
  await setChapterDate(c.id, '  März 1204  ')
  expect((await getChapter(c.id))!.date).toBe('März 1204')
  await setChapterDate(c.id, 'x'.repeat(50))
  expect((await getChapter(c.id))!.date).toBe('x'.repeat(40))
  await setChapterDate(c.id, '   ')
  expect((await getChapter(c.id))!.date).toBeUndefined()
})

test('the last place keeps the newest and leaves the book date alone', async () => {
  const book = await createBook('B')
  const c = await createChapter(book.id, 'A')
  const before = (await getBook(book.id))!.updatedAt
  await savePlace(book.id, { chapterId: c.id, offset: 5, at: 200 })
  await savePlace(book.id, { chapterId: c.id, offset: 1, at: 100 })
  const stored = (await getBook(book.id))!
  expect(stored.place).toEqual({ chapterId: c.id, offset: 5, at: 200 })
  expect(stored.updatedAt).toBe(before)
})

test('new books get the cover colours in turn; style can be changed; junk is ignored', async () => {
  const a = await createBook('A', { cover: await nextCover() })
  const b = await createBook('B', { cover: await nextCover() })
  expect(a.cover).toBe(COVERS[0].color)
  expect(b.cover).toBe(COVERS[1].color)
  await setBookStyle(a.id, { highlight: HIGHLIGHTS[2].color })
  await setBookStyle(a.id, { cover: 'url(x)' })
  const stored = (await getBook(a.id))!
  expect(stored.highlight).toBe(HIGHLIGHTS[2].color)
  expect(stored.cover).toBe(COVERS[0].color)
})

test('books without stored colours still get a fixed cover and the copper highlight', () => {
  const plain: Book = { id: 'abc', title: 'T', font: 'literata', chapterOrder: [], createdAt: 0, updatedAt: 0 }
  expect(COVERS.map((c) => c.color)).toContain(coverOf(plain))
  expect(coverOf(plain)).toBe(coverOf({ ...plain }))
  expect(coverOf({ ...plain, cover: '#123456' })).toBe('#123456')
  expect(highlightOf(plain)).toBe('rgba(213, 141, 98, 0.30)')
})

test('a chapter status is set and cleared', async () => {
  const { setChapterStatus } = await import('./db')
  const book = await createBook('B')
  const chapter = await createChapter(book.id, 'A')
  expect((await setChapterStatus(chapter.id, 'draft')).status).toBe('draft')
  expect((await getChapter(chapter.id))!.status).toBe('draft')
  expect((await setChapterStatus(chapter.id, null)).status).toBeUndefined()
})
