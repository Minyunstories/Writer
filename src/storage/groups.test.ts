import { beforeEach, expect, test } from 'vitest'
import { createBook, createChapter, getBook, getChapter, resetDatabaseForTests } from './db'
import { createGroup, deleteGroup, renameGroup, setChapterGroup } from './groups'

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('groups are created, renamed and given chapters; deleting one frees its chapters', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, 'A')
  const group = await createGroup(book.id, '  Der Winterball ')
  expect(group.name).toBe('Der Winterball')
  await setChapterGroup(a.id, group.id)
  expect((await getChapter(a.id))!.group).toBe(group.id)
  await renameGroup(book.id, group.id, 'Der Frühlingsball')
  expect((await getBook(book.id))!.chapterGroups).toEqual([{ id: group.id, name: 'Der Frühlingsball' }])
  await deleteGroup(book.id, group.id)
  expect((await getBook(book.id))!.chapterGroups).toBeUndefined()
  expect((await getChapter(a.id))!.group).toBeUndefined()
  await setChapterGroup(a.id, null)
  expect((await getChapter(a.id))!.group).toBeUndefined()
})
