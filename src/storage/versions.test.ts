import { beforeEach, expect, test } from 'vitest'
import { createBook, createChapter, deleteBook, deleteChapter, resetDatabaseForTests } from './db'
import { autoVersion, deleteVersion, listVersions, renameVersion, saveVersion, AUTO_GAP, MAX_AUTO } from './versions'

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('named versions are saved, renamed and deleted, newest first', async () => {
  const book = await createBook('B')
  const chapter = await createChapter(book.id, 'A', 'eins')
  const first = await saveVersion(chapter, 'eins', '  Erste Fassung ')
  const second = await saveVersion(chapter, 'zwei', '')
  expect(first).toMatchObject({ label: 'Erste Fassung', auto: false, content: 'eins' })
  expect(second.label).toBeUndefined()
  expect((await listVersions(chapter.id)).map((v) => v.content)).toEqual(['zwei', 'eins'])
  await renameVersion(second.id, 'Neu')
  expect((await listVersions(chapter.id))[0].label).toBe('Neu')
  await deleteVersion(first.id)
  expect((await listVersions(chapter.id)).map((v) => v.id)).toEqual([second.id])
})

test('automatic versions: not for empty or unchanged text, not too often, only the newest few kept', async () => {
  const book = await createBook('B')
  const chapter = await createChapter(book.id, 'A')
  let now = Date.now()
  expect(await autoVersion(chapter, '  ', { now })).toBeNull()
  expect(await autoVersion(chapter, 'eins', { now })).not.toBeNull()
  expect(await autoVersion(chapter, 'zwei', { now: now + 1000 })).toBeNull()
  expect(await autoVersion(chapter, 'eins', { now: (now += AUTO_GAP * 2) })).toBeNull()
  expect(await autoVersion(chapter, 'zwei', { now: now + 1000, label: 'Vor dem Ersetzen', always: true })).toMatchObject({ label: 'Vor dem Ersetzen' })
  await saveVersion(chapter, "benannt", "Behalten")
  for (let i = 0; i < MAX_AUTO + 3; i++) await autoVersion(chapter, `text ${i}`, { now: (now += AUTO_GAP * 2) })
  const versions = await listVersions(chapter.id)
  expect(versions.filter((v) => v.auto)).toHaveLength(MAX_AUTO)
  expect(versions.some((v) => v.label === 'Behalten')).toBe(true)
})

test('versions go with their chapter and their book', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, 'A')
  const b = await createChapter(book.id, 'B')
  await saveVersion(a, 'a', 'x')
  await saveVersion(b, 'b', 'y')
  await deleteChapter(a.id)
  expect(await listVersions(a.id)).toEqual([])
  expect(await listVersions(b.id)).toHaveLength(1)
  await deleteBook(book.id)
  expect(await listVersions(b.id)).toEqual([])
})
