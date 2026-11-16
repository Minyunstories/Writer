import { beforeEach, expect, test } from 'vitest'
import {
  ConflictError,
  createBook,
  createChapter,
  deleteBook,
  deleteChapter,
  getBook,
  getChapter,
  listBooks,
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
