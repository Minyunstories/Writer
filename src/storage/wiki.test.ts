import { openDB } from 'idb'
import { beforeEach, expect, test } from 'vitest'
import { createBook, deleteBook, getChapter, listBooks, resetDatabaseForTests } from './db'
import {
  addImage,
  createEntry,
  createFolder,
  deleteEntry,
  deleteFolder,
  getEntry,
  getImage,
  listEntries,
  listFolders,
  removeImage,
  renameFolder,
  updateEntry,
} from './wiki'

const pixel = () => ({ type: 'image/webp', data: new Uint8Array([1, 2, 3]).buffer, width: 2, height: 1 })

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('folders: create, rename, list by name, fallback name', async () => {
  const book = await createBook('B')
  const orte = await createFolder(book.id, 'Orte')
  await createFolder(book.id, '  ')
  const sub = await createFolder(book.id, 'Städte', orte.id)
  expect(sub.parentId).toBe(orte.id)
  await renameFolder(orte.id, ' Länder ')
  expect((await listFolders(book.id)).map((f) => f.name)).toEqual(['Länder', 'Städte', 'Unbenannt'])
})

test('entries: defaults, update, alias clean-up, name fallback', async () => {
  const book = await createBook('B')
  const entry = await createEntry(book.id, 'Prince')
  expect(entry).toMatchObject({ name: 'Prince', aliases: [], properties: [], imageIds: [], body: '', autoLink: true, folderId: null })
  const updated = await updateEntry(entry.id, {
    name: '  ',
    aliases: [' Nys ', '', 'Nys', 'the Heir'],
    properties: [{ id: 'p1', key: 'Augenfarbe', value: 'grün' }],
    body: 'Text',
    autoLink: false,
  })
  expect(updated.name).toBe('Unbenannt')
  expect(updated.aliases).toEqual(['Nys', 'the Heir'])
  expect((await getEntry(entry.id))!.properties).toEqual([{ id: 'p1', key: 'Augenfarbe', value: 'grün' }])
  expect((await getEntry(entry.id))!.autoLink).toBe(false)
  await createEntry(book.id, 'Anna')
  expect((await listEntries(book.id)).map((e) => e.name)).toEqual(['Anna', 'Unbenannt'])
})

test('deleteFolder moves entries and subfolders to the parent', async () => {
  const book = await createBook('B')
  const top = await createFolder(book.id, 'Welt')
  const mid = await createFolder(book.id, 'Orte', top.id)
  const low = await createFolder(book.id, 'Städte', mid.id)
  const entry = await createEntry(book.id, 'Hafen', mid.id)
  await deleteFolder(mid.id)
  expect((await getEntry(entry.id))!.folderId).toBe(top.id)
  expect((await listFolders(book.id)).find((f) => f.id === low.id)!.parentId).toBe(top.id)
  await deleteFolder(top.id)
  expect((await getEntry(entry.id))!.folderId).toBeNull()
  expect((await listFolders(book.id)).map((f) => f.id)).toEqual([low.id])
})

test('images: add, read, remove; deleteEntry removes its images', async () => {
  const book = await createBook('B')
  const entry = await createEntry(book.id, 'Prince')
  const a = await addImage(entry.id, pixel())
  const b = await addImage(entry.id, pixel())
  expect((await getEntry(entry.id))!.imageIds).toEqual([a.id, b.id])
  expect(new Uint8Array((await getImage(a.id))!.data)).toEqual(new Uint8Array([1, 2, 3]))
  await removeImage(a.id)
  expect((await getEntry(entry.id))!.imageIds).toEqual([b.id])
  expect(await getImage(a.id)).toBeUndefined()
  await deleteEntry(entry.id)
  expect(await getEntry(entry.id)).toBeUndefined()
  expect(await getImage(b.id)).toBeUndefined()
})

test('deleteBook leaves no wiki records', async () => {
  const book = await createBook('B')
  const other = await createBook('Other')
  const folder = await createFolder(book.id, 'Orte')
  const entry = await createEntry(book.id, 'Hafen', folder.id)
  const image = await addImage(entry.id, pixel())
  const keep = await createEntry(other.id, 'Bleibt')
  await deleteBook(book.id)
  expect(await listFolders(book.id)).toEqual([])
  expect(await listEntries(book.id)).toEqual([])
  expect(await getImage(image.id)).toBeUndefined()
  expect(await getEntry(keep.id)).toBeDefined()
})

test('a version 1 database keeps its books and chapters after the upgrade', async () => {
  const old = await openDB('minyunwriter', 1, {
    upgrade(database) {
      database.createObjectStore('books', { keyPath: 'id' })
      database.createObjectStore('chapters', { keyPath: 'id' }).createIndex('bookId', 'bookId')
    },
  })
  await old.put('books', { id: 'b1', title: 'Alt', font: 'literata', chapterOrder: ['c1'], createdAt: 1, updatedAt: 1 })
  await old.put('chapters', { id: 'c1', bookId: 'b1', title: 'Eins', content: 'bleibt', updatedAt: 1 })
  old.close()

  expect(await listEntries('b1')).toEqual([])
  expect((await listBooks()).map((b) => b.title)).toEqual(['Alt'])
  expect((await getChapter('c1'))!.content).toBe('bleibt')
  expect((await createEntry('b1', 'Neu')).name).toBe('Neu')
})
