import { beforeEach, expect, test } from 'vitest'
import { createBook, createChapter, getBook, getChapter, listBooks, listChapters, resetDatabaseForTests, updateChapter } from '../storage/db'
import { addImage, createEntry, createFolder, getEntry, getImage, listEntries, listFolders, updateEntry } from '../storage/wiki'
import type { FileSet } from './files'
import { applyRemoteFiles, clearSyncState, loadSyncState, readLocalFiles, saveSyncState } from './local'

const pixel = () => ({ type: 'image/webp', data: new Uint8Array([1, 2, 3]).buffer, width: 2, height: 1 })
const applyFull = (change: Partial<Parameters<typeof applyRemoteFiles>[0]> & { snapshot: FileSet }) =>
  applyRemoteFiles({ write: new Map(), remove: [], conflicts: [], ...change })
const apply = async (change: Parameters<typeof applyFull>[0]) => (await applyFull(change)).notes

async function seed() {
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Anfang', 'alt')
  const b = await createChapter(book.id, 'Sturm', 'bleibt')
  const folder = await createFolder(book.id, 'Personen')
  const entry = await createEntry(book.id, 'Prince', folder.id)
  const image = await addImage(entry.id, pixel())
  const p = `books/${book.id}/`
  return { book, a, b, folder, entry, image, p, snapshot: await readLocalFiles() }
}

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('readLocalFiles returns every book as files', async () => {
  const { p, a, b, entry, image } = await seed()
  const other = await createBook('Zweites')
  const files = await readLocalFiles()
  expect([...files.keys()].sort()).toEqual(
    [
      `books/${other.id}/book.json`,
      `${p}book.json`,
      `${p}chapters/${a.id}.md`,
      `${p}chapters/${b.id}.md`,
      `${p}wiki/_images/${image.id}.webp`,
      `${p}wiki/${entry.id}.md`,
      `${p}wiki/folders.json`,
    ].sort(),
  )
})

test('a pulled chapter changes only that chapter', async () => {
  const { p, a, b, snapshot } = await seed()
  const notes = await apply({ write: new Map([[`${p}chapters/${a.id}.md`, 'neu von woanders']]), snapshot })
  expect(notes).toEqual([])
  expect((await getChapter(a.id))!.content).toBe('neu von woanders')
  expect((await getChapter(b.id))!.content).toBe('bleibt')
  expect((await getChapter(a.id))!.title).toBe('Anfang')
})

test('files of an unknown book create it completely', async () => {
  const source = await seed()
  const files = await readLocalFiles()
  await resetDatabaseForTests()
  await apply({ write: files, snapshot: new Map() })
  const [book] = await listBooks()
  expect(book).toMatchObject({ id: source.book.id, title: 'Sturmlied' })
  expect((await listChapters(book.id)).map((c) => [c.title, c.content])).toEqual([
    ['Anfang', 'alt'],
    ['Sturm', 'bleibt'],
  ])
  expect((await listFolders(book.id)).map((f) => f.name)).toEqual(['Personen'])
  const [entry] = await listEntries(book.id)
  expect(entry).toMatchObject({ name: 'Prince', folderId: source.folder.id, imageIds: [source.image.id] })
  expect(new Uint8Array((await getImage(source.image.id))!.data)).toEqual(new Uint8Array([1, 2, 3]))
  expect([...(await readLocalFiles()).keys()].sort()).toEqual([...files.keys()].sort())
})

test('removals: chapter, entry with images, outline note and a whole book', async () => {
  const { p, book, a, b, entry, image } = await seed()
  await updateChapter(b.id, { outline: 'Notiz' })
  const snapshot = await readLocalFiles()
  await apply({ remove: [`${p}chapters/${a.id}.md`, `${p}wiki/${entry.id}.md`, `${p}wiki/_images/${image.id}.webp`, `${p}outline/${b.id}.md`], snapshot })
  expect(await getChapter(a.id)).toBeUndefined()
  expect((await getBook(book.id))!.chapterOrder).toEqual([b.id])
  expect(await getEntry(entry.id)).toBeUndefined()
  expect(await getImage(image.id)).toBeUndefined()
  expect((await getChapter(b.id))!.outline).toBe('')

  const rest = await readLocalFiles()
  await apply({ remove: [...rest.keys()], snapshot: rest })
  expect(await listBooks()).toEqual([])
  expect(await listFolders(book.id)).toEqual([])
})

test('book.json: remote title and order, local-only chapters appended', async () => {
  const { p, book, a, b, snapshot } = await seed()
  const extra = await createChapter(book.id, 'Nur hier')
  const remote = JSON.stringify({
    id: book.id,
    title: 'Sturmlied II',
    font: 'inter',
    createdAt: 1,
    chapters: [
      { id: b.id, title: 'Sturm!' },
      { id: a.id, title: 'Anfang' },
    ],
  })
  const notes = await apply({ conflicts: [{ path: `${p}book.json`, remote }], snapshot })
  expect(await getBook(book.id)).toMatchObject({ title: 'Sturmlied II', font: 'inter', chapterOrder: [b.id, a.id, extra.id] })
  expect((await getChapter(b.id))!.title).toBe('Sturm!')
  expect(notes).toEqual([{ bookTitle: 'Sturmlied II', kind: 'book', name: 'Sturmlied II' }])
})

test('chapter conflict keeps both versions', async () => {
  const { p, book, a, b, snapshot } = await seed()
  const notes = await apply({ conflicts: [{ path: `${p}chapters/${a.id}.md`, remote: 'aus dem Repo' }], snapshot })
  const chapters = await listChapters(book.id)
  expect(chapters.map((c) => [c.title, c.content])).toEqual([
    ['Anfang', 'aus dem Repo'],
    ['Anfang (Fassung von diesem Gerät)', 'alt'],
    ['Sturm', 'bleibt'],
  ])
  expect(chapters[2].id).toBe(b.id)
  expect(notes).toEqual([{ bookTitle: 'Sturmlied', kind: 'chapter', name: 'Anfang' }])
})

test('text saved after the snapshot is treated like a conflict, never overwritten', async () => {
  const { p, book, a, snapshot } = await seed()
  await updateChapter(a.id, { content: 'gerade eben getippt' })
  const notes = await apply({ write: new Map([[`${p}chapters/${a.id}.md`, 'aus dem Repo']]), snapshot })
  expect((await listChapters(book.id)).map((c) => c.content)).toEqual(['aus dem Repo', 'gerade eben getippt', 'bleibt'])
  expect(notes).toHaveLength(1)

  const fresh = await readLocalFiles()
  const [second] = (await listChapters(book.id)).filter((c) => c.content === 'bleibt')
  await updateChapter(second.id, { content: 'auch neu' })
  await apply({ remove: [`${p}chapters/${second.id}.md`], snapshot: fresh })
  expect((await getChapter(second.id))!.content).toBe('auch neu')
})

test('outline conflict joins both notes', async () => {
  const { p, a } = await seed()
  await updateChapter(a.id, { outline: 'hier: Regen' })
  const snapshot = await readLocalFiles()
  const notes = await apply({ conflicts: [{ path: `${p}outline/${a.id}.md`, remote: 'dort: Sonne' }], snapshot })
  expect((await getChapter(a.id))!.outline).toBe('dort: Sonne\n\n--- Fassung von diesem Gerät ---\n\nhier: Regen')
  expect(notes[0]).toMatchObject({ kind: 'outline', name: 'Anfang' })
})

test('entry conflict keeps both, the copy without auto-linking', async () => {
  const { p, book, entry, image, snapshot } = await seed()
  await updateEntry(entry.id, { body: 'meine Notiz' })
  const local = await readLocalFiles()
  const remote = (snapshot.get(`${p}wiki/${entry.id}.md`) as string) + 'Notiz aus dem Repo'
  const notes = await apply({ conflicts: [{ path: `${p}wiki/${entry.id}.md`, remote }], snapshot: local })
  const entries = await listEntries(book.id)
  expect(entries.map((e) => [e.name, e.body, e.autoLink, e.imageIds])).toEqual([
    ['Prince', 'Notiz aus dem Repo', true, [image.id]],
    ['Prince (Fassung von diesem Gerät)', 'meine Notiz', false, []],
  ])
  expect(notes).toEqual([{ bookTitle: 'Sturmlied', kind: 'entry', name: 'Prince' }])
})

test('folders: a plain pull replaces, a conflict unites', async () => {
  const { p, book, folder, snapshot } = await seed()
  const remote = JSON.stringify([{ id: 'r1', name: 'Orte', parentId: null, createdAt: 1 }])
  await apply({ conflicts: [{ path: `${p}wiki/folders.json`, remote }], snapshot })
  expect((await listFolders(book.id)).map((f) => f.id).sort()).toEqual([folder.id, 'r1'].sort())
  await apply({ write: new Map([[`${p}wiki/folders.json`, remote]]), snapshot: await readLocalFiles() })
  expect((await listFolders(book.id)).map((f) => f.id)).toEqual(['r1'])
})

test('files outside books/ and unreadable files are ignored', async () => {
  const { p, a, snapshot } = await seed()
  await apply({
    write: new Map([
      ['README.md', 'hi'],
      [`${p}book.json`, '{ kaputt'],
      [`${p}wiki/x.md`, 'kein Kopf'],
      [`${p}notizen/frei.txt`, 'x'],
    ]),
    remove: ['LICENSE'],
    snapshot,
  })
  expect((await getChapter(a.id))!.content).toBe('alt')
  expect((await listBooks())[0].title).toBe('Sturmlied')
})

test('sync state is stored, read and cleared', async () => {
  expect(await loadSyncState('me/books')).toBeUndefined()
  await saveSyncState('me/books', new Map([['a', '1']]))
  expect([...(await loadSyncState('me/books'))!.base]).toEqual([['a', '1']])
  expect(await loadSyncState('me/other')).toBeUndefined()
  await clearSyncState()
  expect(await loadSyncState('me/books')).toBeUndefined()
})

test('files that cannot be applied are reported as skipped', async () => {
  const { p, snapshot } = await seed()
  const { skipped } = await applyFull({
    write: new Map<string, string | Uint8Array>([
      [`${p}book.json`, '{ kaputt'],
      [`${p}wiki/x.md`, 'kein Kopf'],
      [`${p}wiki/_images/niemand.webp`, new Uint8Array([1])],
      [`${p}chapters/neu.md`, 'geht'],
    ]),
    snapshot,
  })
  expect(skipped.sort()).toEqual([`${p}book.json`, `${p}wiki/_images/niemand.webp`, `${p}wiki/x.md`])
})

test('a book removed elsewhere survives when something in it changed during the run', async () => {
  const { book, a, snapshot } = await seed()
  await updateChapter(a.id, { content: 'gerade eben getippt' })
  await apply({ remove: [...snapshot.keys()], snapshot })
  expect((await getBook(book.id))!.title).toBe('Sturmlied')
  expect((await getChapter(a.id))!.content).toBe('gerade eben getippt')
  expect((await listChapters(book.id)).length).toBe(2)
})

test('a failure in the middle changes nothing', async () => {
  const { p, a, b, snapshot } = await seed()
  const poison = { get length(): number { throw new Error('boom') } } as unknown as Uint8Array
  await expect(
    applyFull({ write: new Map<string, string | Uint8Array>([[`${p}chapters/${a.id}.md`, 'neu'], [`${p}chapters/${b.id}.md`, poison]]), snapshot }),
  ).rejects.toThrow()
  expect((await getChapter(a.id))!.content).toBe('alt')
})
