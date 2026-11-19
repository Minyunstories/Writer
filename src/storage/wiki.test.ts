import { openDB } from 'idb'
import { beforeEach, expect, test } from 'vitest'
import { orderedChildren } from '../wiki/order'
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
  changeTemplate,
  setFolderColor,
  moveTemplateField,
  moveWikiItem,
  stepWikiItem,
  renameFolder,
  setFolderTemplate,
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
  const entry = await createEntry(book.id, 'Pascal')
  expect(entry).toMatchObject({ name: 'Pascal', aliases: [], properties: [], imageIds: [], body: '', autoLink: true, folderId: null })
  const updated = await updateEntry(entry.id, {
    name: '  ',
    aliases: [' Cal ', '', 'Cal', 'the Captain'],
    properties: [{ id: 'p1', key: 'Augenfarbe', value: 'grün' }],
    body: 'Text',
    autoLink: false,
  })
  expect(updated.name).toBe('Unbenannt')
  expect(updated.aliases).toEqual(['Cal', 'the Captain'])
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
  const entry = await createEntry(book.id, 'Pascal')
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

test('folder templates are cleaned when stored', async () => {
  const book = await createBook('B')
  const folder = await createFolder(book.id, 'Characters')
  const updated = await setFolderTemplate(folder.id, [' Augenfarbe ', 'Alter', '', 'Alter'])
  expect(updated.template).toEqual(['Augenfarbe', 'Alter'])
  expect((await listFolders(book.id))[0].template).toEqual(['Augenfarbe', 'Alter'])
})

test('template changes work on the stored template', async () => {
  const book = await createBook('B')
  const folder = await createFolder(book.id, 'Characters')
  await Promise.all([changeTemplate(folder.id, { add: 'Alter' }), changeTemplate(folder.id, { add: 'Größe' })])
  expect((await listFolders(book.id))[0].template!.sort()).toEqual(['Alter', 'Größe'])
  await changeTemplate(folder.id, { remove: 'Alter' })
  await changeTemplate(folder.id, { remove: 'Größe' })
  expect((await listFolders(book.id))[0].template).toBeUndefined()
})

async function tree(bookId: string, parentId: string | null = null) {
  const { getBook } = await import('./db')
  const kids = orderedChildren(parentId, await listFolders(bookId), await listEntries(bookId), (await getBook(bookId))!.wikiOrder)
  return { folders: kids.folders.map((x) => x.name), entries: kids.entries.map((x) => x.name) }
}

test('new folders and entries go to the end of their folder', async () => {
  const book = await createBook('B')
  await createEntry(book.id, 'Zora')
  await createEntry(book.id, 'Anna')
  await createFolder(book.id, 'Orte')
  await createFolder(book.id, 'Leute')
  expect(await tree(book.id)).toEqual({ folders: ['Orte', 'Leute'], entries: ['Zora', 'Anna'] })
})

test('moving: before a sibling, into a folder; cycles and too deep folders are refused', async () => {
  const book = await createBook('B')
  const orte = await createFolder(book.id, 'Orte')
  const leute = await createFolder(book.id, 'Leute')
  const anna = await createEntry(book.id, 'Anna')
  const ben = await createEntry(book.id, 'Ben')
  expect(await moveWikiItem(book.id, { kind: 'entry', id: ben.id }, { parentId: null, beforeId: anna.id })).toBe(true)
  expect((await tree(book.id)).entries).toEqual(['Ben', 'Anna'])
  expect(await moveWikiItem(book.id, { kind: 'entry', id: anna.id }, { parentId: leute.id, beforeId: null })).toBe(true)
  expect((await getEntry(anna.id))!.folderId).toBe(leute.id)
  expect((await tree(book.id, leute.id)).entries).toEqual(['Anna'])
  expect((await tree(book.id)).entries).toEqual(['Ben'])

  expect(await moveWikiItem(book.id, { kind: 'folder', id: leute.id }, { parentId: orte.id, beforeId: null })).toBe(true)
  expect((await listFolders(book.id)).find((x) => x.id === leute.id)!.parentId).toBe(orte.id)
  expect(await moveWikiItem(book.id, { kind: 'folder', id: orte.id }, { parentId: leute.id, beforeId: null })).toBe(false)
  expect(await moveWikiItem(book.id, { kind: 'folder', id: orte.id }, { parentId: orte.id, beforeId: null })).toBe(false)
  expect((await listFolders(book.id)).find((x) => x.id === orte.id)!.parentId).toBeNull()

  // Five levels at most (0–4).
  let parent: string | null = null
  const chain: string[] = []
  for (let level = 0; level < 5; level++) {
    const folder: { id: string } = await createFolder(book.id, `Ebene ${level}`, parent)
    chain.push(folder.id)
    parent = folder.id
  }
  const loose = await createFolder(book.id, 'Lose')
  expect(await moveWikiItem(book.id, { kind: 'folder', id: loose.id }, { parentId: chain[4], beforeId: null })).toBe(false)
  expect(await moveWikiItem(book.id, { kind: 'folder', id: loose.id }, { parentId: chain[3], beforeId: null })).toBe(true)
  expect(await moveWikiItem(book.id, { kind: 'entry', id: ben.id }, { parentId: chain[4], beforeId: null })).toBe(true)
})

test('stepping moves one place among its own kind', async () => {
  const book = await createBook('B')
  const a = await createEntry(book.id, 'A')
  await createEntry(book.id, 'B')
  const c = await createEntry(book.id, 'C')
  await stepWikiItem(book.id, { kind: 'entry', id: c.id }, 'up')
  expect((await tree(book.id)).entries).toEqual(['A', 'C', 'B'])
  await stepWikiItem(book.id, { kind: 'entry', id: a.id }, 'up')
  expect((await tree(book.id)).entries).toEqual(['A', 'C', 'B'])
  await stepWikiItem(book.id, { kind: 'entry', id: a.id }, 'down')
  expect((await tree(book.id)).entries).toEqual(['C', 'A', 'B'])
  const x = await createFolder(book.id, 'X')
  await createFolder(book.id, 'Y')
  await stepWikiItem(book.id, { kind: 'folder', id: x.id }, 'down')
  expect(await tree(book.id)).toEqual({ folders: ['Y', 'X'], entries: ['C', 'A', 'B'] })
})

test('template fields move up and down', async () => {
  const book = await createBook('B')
  const folder = await createFolder(book.id, 'Characters')
  await setFolderTemplate(folder.id, ['A', 'B', 'C'])
  await moveTemplateField(folder.id, 'C', 'up')
  expect((await listFolders(book.id))[0].template).toEqual(['A', 'C', 'B'])
  await moveTemplateField(folder.id, 'A', 'up')
  expect((await listFolders(book.id))[0].template).toEqual(['A', 'C', 'B'])
})

test('a folder colour can be set and cleared; junk is ignored', async () => {
  const book = await createBook('B')
  const folder = await createFolder(book.id, 'Orte')
  await setFolderColor(folder.id, '#1f4a4f')
  expect((await listFolders(book.id))[0].color).toBe('#1f4a4f')
  await setFolderColor(folder.id, 'url(x)')
  expect((await listFolders(book.id))[0].color).toBe('#1f4a4f')
  await setFolderColor(folder.id, null)
  expect((await listFolders(book.id))[0].color).toBeUndefined()
})

test('an image becomes the portrait by moving it to the front', async () => {
  const { setPortrait } = await import('./wiki')
  const book = await createBook('B')
  const entry = await createEntry(book.id, 'Mira')
  const pixel = () => ({ type: 'image/webp', data: new Uint8Array([1]).buffer, width: 1, height: 1 })
  const first = await addImage(entry.id, pixel())
  const second = await addImage(entry.id, pixel())
  await setPortrait(second.id)
  expect((await getEntry(entry.id))!.imageIds).toEqual([second.id, first.id])
})
