import { beforeEach, expect, test } from 'vitest'
import { db, resetDatabaseForTests } from './connection'
import { addComment } from './comments'
import { changeChapterTags, createBook, createChapter, deleteBook, getBook, getChapter, listChapters, setChapterDate, setChapterStatus, updateChapter } from './db'
import { createGroup, deleteGroup, setChapterGroup } from './groups'
import { autoVersion, listVersions, saveVersion } from './versions'
import { addImage, createEntry, createFolder, deleteFolder, getEntry, getImage } from './wiki'
import { TRASH_DAYS, daysLeft, deleteTrash, listTrash, purgeTrash, restoreTrash, trashChapter, trashEntry } from './trash'

const DAY = 24 * 60 * 60 * 1000

beforeEach(async () => {
  await resetDatabaseForTests()
})

async function threeChapters() {
  const book = await createBook('Sturmlied')
  const one = await createChapter(book.id, 'Eins', 'eins')
  const two = await createChapter(book.id, 'Zwei', 'Mira stood.')
  const three = await createChapter(book.id, 'Drei', 'drei')
  return { book, one, two, three }
}

test('a trashed chapter leaves the book and comes back where it was', async () => {
  const { book, two } = await threeChapters()
  await updateChapter(two.id, { outline: 'Regen', tags: [] })
  await changeChapterTags(two.id, { add: 'Mira' })
  await setChapterDate(two.id, 'März')
  await setChapterStatus(two.id, 'draft')
  const group = await createGroup(book.id, 'Teil 1')
  await setChapterGroup(two.id, group.id)
  await addComment(two.id, { from: 0, to: 4, quote: 'Mira', text: 'Name prüfen' })
  await autoVersion(two, 'alt', { always: true })
  await saveVersion(two, 'benannt', 'Vor dem Umbau')
  const before = await getChapter(two.id)

  const item = await trashChapter(two.id)
  expect(item).toMatchObject({ bookId: book.id, kind: 'chapter', title: 'Zwei' })
  expect((await listChapters(book.id)).map((c) => c.title)).toEqual(['Eins', 'Drei'])
  expect(await listVersions(two.id)).toEqual([])
  expect(await listTrash(book.id)).toHaveLength(1)

  expect(await restoreTrash(item!.id)).toEqual({ kind: 'chapter', targetId: two.id })
  expect((await listChapters(book.id)).map((c) => c.title)).toEqual(['Eins', 'Zwei', 'Drei'])
  const back = await getChapter(two.id)
  expect(back).toMatchObject({
    content: before!.content,
    outline: 'Regen',
    tags: ['Mira'],
    date: 'März',
    status: 'draft',
    group: group.id,
    comments: before!.comments,
  })
  expect((await listVersions(two.id)).map((v) => [v.content, v.auto, v.label])).toEqual([
    ['benannt', false, 'Vor dem Umbau'],
    ['alt', true, undefined],
  ])
  expect(await listTrash(book.id)).toEqual([])
})

test('a group that no longer exists is dropped on restore', async () => {
  const { book, two } = await threeChapters()
  const group = await createGroup(book.id, 'Teil 1')
  await setChapterGroup(two.id, group.id)
  const item = await trashChapter(two.id)
  await deleteGroup(book.id, group.id)
  await restoreTrash(item!.id)
  expect((await getChapter(two.id))!.group).toBeUndefined()
})

test('a chapter restored after the order shrank goes to the end', async () => {
  const { book, one, two, three } = await threeChapters()
  const item = await trashChapter(three.id)
  await trashChapter(two.id)
  await trashChapter(one.id)
  await createChapter(book.id, 'Neu', '')
  await restoreTrash(item!.id)
  expect((await listChapters(book.id)).map((c) => c.title)).toEqual(['Neu', 'Drei'])
})

test('a trashed entry comes back with its images', async () => {
  const book = await createBook('Sturmlied')
  const entry = await createEntry(book.id, 'Pascal')
  const bytes = new Uint8Array([1, 2, 3, 250])
  const image = await addImage(entry.id, { type: 'image/webp', data: bytes.buffer, width: 4, height: 1 })

  const item = await trashEntry(entry.id)
  expect(item).toMatchObject({ kind: 'entry', title: 'Pascal' })
  expect(await getEntry(entry.id)).toBeUndefined()
  expect(await getImage(image.id)).toBeUndefined()

  expect(await restoreTrash(item!.id)).toEqual({ kind: 'entry', targetId: entry.id })
  expect((await getEntry(entry.id))!.imageIds).toEqual([image.id])
  const back = await getImage(image.id)
  expect(back).toMatchObject({ entryId: entry.id, type: 'image/webp', width: 4, height: 1 })
  expect([...new Uint8Array(back!.data)]).toEqual([1, 2, 3, 250])
})

test('an entry whose folder is gone comes back at the root', async () => {
  const book = await createBook('Sturmlied')
  const folder = await createFolder(book.id, 'Figuren')
  const entry = await createEntry(book.id, 'Pascal', folder.id)
  const item = await trashEntry(entry.id)
  await deleteFolder(folder.id)
  await restoreTrash(item!.id)
  expect((await getEntry(entry.id))!.folderId).toBeNull()
})

test('restoring something that exists again keeps it and only empties the trash', async () => {
  const { book, two } = await threeChapters()
  const item = await trashChapter(two.id)
  // The other device edited it meanwhile, and the sync brought it back.
  const database = await db()
  await database.put('chapters', { ...JSON.parse(item!.file).chapter, content: 'Newer text.' })
  expect(await restoreTrash(item!.id)).toEqual({ kind: 'chapter', targetId: two.id })
  expect((await getChapter(two.id))!.content).toBe('Newer text.')
  expect(await listTrash(book.id)).toEqual([])
})

test('an unknown kind is listed but not restored', async () => {
  const book = await createBook('Sturmlied')
  await (await db()).put('trash', { id: 'x', bookId: book.id, kind: 'folder', title: 'Orte', deletedAt: Date.now(), file: '{}\n' })
  expect(await listTrash(book.id)).toHaveLength(1)
  expect(await restoreTrash('x')).toBeNull()
  expect(await listTrash(book.id)).toHaveLength(1)
})

test('a broken file is not restored', async () => {
  const book = await createBook('Sturmlied')
  await (await db()).put('trash', { id: 'y', bookId: book.id, kind: 'chapter', title: 'Kaputt', deletedAt: Date.now(), file: 'not json' })
  expect(await restoreTrash('y')).toBeNull()
})

test('deleteTrash removes for good', async () => {
  const { book, two } = await threeChapters()
  const item = await trashChapter(two.id)
  await deleteTrash(item!.id)
  expect(await listTrash(book.id)).toEqual([])
  expect(await getChapter(two.id)).toBeUndefined()
})

test('purgeTrash keeps 29 days and removes after 30', async () => {
  const { book, two } = await threeChapters()
  const item = await trashChapter(two.id)
  expect(await purgeTrash(book.id, item!.deletedAt + 29 * DAY)).toBe(0)
  expect(await listTrash(book.id)).toHaveLength(1)
  expect(await purgeTrash(book.id, item!.deletedAt + TRASH_DAYS * DAY)).toBe(1)
  expect(await listTrash(book.id)).toEqual([])
})

test('listTrash is newest first and only for its book', async () => {
  const { book, one, two } = await threeChapters()
  const other = await createBook('Anderes')
  const elsewhere = await createChapter(other.id, 'Fremd', '')
  const first = await trashChapter(one.id)
  const second = await trashChapter(two.id)
  await trashChapter(elsewhere.id)
  // Same millisecond is possible: make the order unambiguous.
  await (await db()).put('trash', { ...second!, deletedAt: first!.deletedAt + 1 })
  expect((await listTrash(book.id)).map((item) => item.title)).toEqual(['Zwei', 'Eins'])
})

test("deleteBook empties the book's trash", async () => {
  const { book, two } = await threeChapters()
  await trashChapter(two.id)
  await deleteBook(book.id)
  expect(await getBook(book.id)).toBeUndefined()
  expect(await (await db()).getAll('trash')).toEqual([])
})

test('daysLeft counts down to 0', () => {
  const deletedAt = 1_000_000
  expect(daysLeft({ deletedAt }, deletedAt)).toBe(30)
  expect(daysLeft({ deletedAt }, deletedAt + DAY + 1)).toBe(29)
  expect(daysLeft({ deletedAt }, deletedAt + 29.5 * DAY)).toBe(1)
  expect(daysLeft({ deletedAt }, deletedAt + 40 * DAY)).toBe(0)
})

test('the file text is JSON with id, kind, title and deletedAt', async () => {
  const { two } = await threeChapters()
  const item = await trashChapter(two.id)
  const parsed = JSON.parse(item!.file)
  expect(parsed).toMatchObject({ id: item!.id, kind: 'chapter', title: 'Zwei', deletedAt: item!.deletedAt, index: 1 })
  expect(item!.file.endsWith('\n')).toBe(true)
})

test('trashing something that does not exist does nothing', async () => {
  expect(await trashChapter('nope')).toBeNull()
  expect(await trashEntry('nope')).toBeNull()
})

test('a trash file in an unexpected shape is not restored and changes nothing', async () => {
  const book = await createBook('Sturmlied')
  const put = (id: string, kind: string, body: object) =>
    db().then((database) => database.put('trash', { id, bookId: book.id, kind, title: 'X', deletedAt: Date.now(), file: JSON.stringify({ id, kind, ...body }) }))
  await put('a', 'chapter', { chapter: { id: 'c1', title: 'X' }, index: 0, versions: [] }) // no content
  await put('b', 'chapter', { chapter: { id: 'c2', title: 'X', content: 'x' }, index: 0, versions: { not: 'a list' } })
  await put('c', 'entry', { entry: { id: 'e1', folderId: null }, images: [] }) // no name
  await put('d', 'entry', { entry: { id: 'e2', name: 'Lea', folderId: null, aliases: [], properties: [], imageIds: [], body: '', autoLink: true, createdAt: 1, updatedAt: 1 }, images: 'nope' })
  for (const id of ['a', 'b', 'c', 'd']) expect(await restoreTrash(id)).toBeNull()
  expect(await listChapters(book.id)).toEqual([])
  expect(await getEntry('e1')).toBeUndefined()
  expect(await getEntry('e2')).toBeUndefined()
  expect(await listTrash(book.id)).toHaveLength(4)
})
