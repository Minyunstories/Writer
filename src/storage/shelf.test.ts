import { beforeEach, expect, test, vi } from 'vitest'
import { CHANGED_EVENT } from './connection'
import { createBook, getBook, resetDatabaseForTests } from './db'
import { setPattern, setStarred } from './shelf'

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('a star is set and removed without changing the "last changed" date', async () => {
  const book = await createBook('B')
  await setStarred(book.id, true)
  let stored = (await getBook(book.id))!
  expect(stored.shelf).toEqual({ starred: true })
  expect(stored.updatedAt).toBe(book.updatedAt)

  await setStarred(book.id, false)
  stored = (await getBook(book.id))!
  expect(stored.shelf).toBeUndefined()
  expect(stored.updatedAt).toBe(book.updatedAt)
})

test('a pattern is set, changed and removed; the star stays', async () => {
  const book = await createBook('B')
  await setStarred(book.id, true)
  await setPattern(book.id, 'dots')
  expect((await getBook(book.id))!.shelf).toEqual({ starred: true, pattern: 'dots' })
  await setPattern(book.id, 'zigzag')
  expect((await getBook(book.id))!.shelf).toEqual({ starred: true, pattern: 'zigzag' })
  await setPattern(book.id, null)
  expect((await getBook(book.id))!.shelf).toEqual({ starred: true })
})

test('unknown patterns are not stored', async () => {
  const book = await createBook('B')
  await setPattern(book.id, 'tartan')
  expect((await getBook(book.id))!.shelf).toBeUndefined()
})

test('fields from a newer app version stay', async () => {
  const book = await createBook('B')
  const { db } = await import('./connection')
  await (await db()).put('books', { ...book, shelf: { pattern: 'tartan', extra: { ribbon: 'red' } } })
  await setStarred(book.id, true)
  expect((await getBook(book.id))!.shelf).toEqual({ starred: true, pattern: 'tartan', extra: { ribbon: 'red' } })
  await setStarred(book.id, false)
  expect((await getBook(book.id))!.shelf).toEqual({ pattern: 'tartan', extra: { ribbon: 'red' } })
})

test('saving what is already there changes nothing and starts no sync', async () => {
  const book = await createBook('B')
  await setStarred(book.id, true)
  await setPattern(book.id, 'stripes')
  const listener = vi.fn()
  window.addEventListener(CHANGED_EVENT, listener)
  try {
    await setStarred(book.id, true)
    await setPattern(book.id, 'stripes')
    await setPattern(book.id, 'tartan')
  } finally {
    window.removeEventListener(CHANGED_EVENT, listener)
  }
  expect(listener).not.toHaveBeenCalled()
  expect((await getBook(book.id))!.shelf).toEqual({ starred: true, pattern: 'stripes' })
})
