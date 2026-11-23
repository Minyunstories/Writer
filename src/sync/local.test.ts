import { beforeEach, expect, test } from 'vitest'
import { createBook, createChapter, getBook, getChapter, listBooks, listChapters, resetDatabaseForTests, savePlace, setBookStyle, setChapterDate, updateChapter } from '../storage/db'
import { addNote, updateNote } from '../storage/notes'
import { updateSpelling } from '../storage/spelling'
import { addImage, createEntry, createFolder, getEntry, getImage, listEntries, listFolders, moveWikiItem, setFolderColor, setFolderTemplate, updateEntry } from '../storage/wiki'
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
  const entry = await createEntry(book.id, 'Pascal', folder.id)
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
      `${p}wiki/order.json`,
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
  expect(entry).toMatchObject({ name: 'Pascal', folderId: source.folder.id, imageIds: [source.image.id] })
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
    ['Pascal', 'Notiz aus dem Repo', true, [image.id]],
    ['Pascal (Fassung von diesem Gerät)', 'meine Notiz', false, []],
  ])
  expect(notes).toEqual([{ bookTitle: 'Sturmlied', kind: 'entry', name: 'Pascal' }])
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

test('tags and templates are taken over from their own files; book.json and folders.json leave them alone', async () => {
  const { p, book, a, b, folder } = await seed()
  await updateChapter(b.id, { tags: ['Alt'] })
  await setFolderTemplate(folder.id, ['Alt'])
  const snapshot = await readLocalFiles()
  await apply({
    write: new Map([
      [`${p}tags.json`, JSON.stringify({ [a.id]: ['PoV: Pascal'] })],
      [`${p}wiki/templates.json`, JSON.stringify({ [folder.id]: ['Augenfarbe'] })],
    ]),
    snapshot,
  })
  expect((await getChapter(a.id))!.tags).toEqual(['PoV: Pascal'])
  expect((await getChapter(b.id))!.tags).toBeUndefined()
  expect((await listFolders(book.id))[0].template).toEqual(['Augenfarbe'])

  // A pulled book.json or folders.json (e.g. from an older app) keeps tags and templates.
  const now = await readLocalFiles()
  await apply({ write: new Map([[`${p}book.json`, now.get(`${p}book.json`)!], [`${p}wiki/folders.json`, now.get(`${p}wiki/folders.json`)!]]), snapshot: now })
  expect((await getChapter(a.id))!.tags).toEqual(['PoV: Pascal'])
  expect((await listFolders(book.id))[0].template).toEqual(['Augenfarbe'])

  // Removed in the repository and untouched here: cleared.
  const before = await readLocalFiles()
  await apply({ remove: [`${p}tags.json`, `${p}wiki/templates.json`], snapshot: before })
  expect((await getChapter(a.id))!.tags).toBeUndefined()
  expect((await listFolders(book.id))[0].template).toBeUndefined()
})

test('tags and templates changed on both sides are merged, nothing is dropped', async () => {
  const { p, book, a, b, folder } = await seed()
  await updateChapter(a.id, { tags: ['PoV: Elena'] })
  await updateChapter(b.id, { tags: ['Rückblick'] })
  await setFolderTemplate(folder.id, ['Augenfarbe', 'Alter'])
  const snapshot = await readLocalFiles()
  const { notes } = await applyFull({
    conflicts: [
      { path: `${p}tags.json`, remote: JSON.stringify({ [a.id]: ['PoV: Pascal'] }) },
      { path: `${p}wiki/templates.json`, remote: JSON.stringify({ [folder.id]: ['Größe', 'Augenfarbe'] }) },
    ],
    snapshot,
  })
  expect((await getChapter(a.id))!.tags).toEqual(['PoV: Pascal', 'PoV: Elena'])
  expect((await getChapter(b.id))!.tags).toEqual(['Rückblick'])
  expect((await listFolders(book.id))[0].template).toEqual(['Größe', 'Augenfarbe', 'Alter'])
  expect(notes.map((n) => n.kind).sort()).toEqual(['tags', 'templates'])
})

test('tags changed here during the run are merged into a pulled tags file', async () => {
  const { p, a } = await seed()
  const snapshot = await readLocalFiles()
  await updateChapter(a.id, { tags: ['gerade eben'] })
  await apply({ write: new Map([[`${p}tags.json`, JSON.stringify({ [a.id]: ['von woanders'] })]]), snapshot })
  expect((await getChapter(a.id))!.tags).toEqual(['von woanders', 'gerade eben'])
})

test('cover, highlight, dates and place are taken over from their files; a pulled book.json leaves them alone', async () => {
  const { p, book, a, b } = await seed()
  const snapshot = await readLocalFiles()
  const later = Date.now() + 60_000
  await apply({
    write: new Map([
      [`${p}style.json`, JSON.stringify({ cover: '#283650', highlight: 'rgba(1, 2, 3, 0.4)' })],
      [`${p}dates.json`, JSON.stringify({ [a.id]: 'März' })],
      [`${p}place.json`, JSON.stringify({ chapterId: b.id, offset: 3, at: later })],
    ]),
    snapshot,
  })
  let stored = (await getBook(book.id))!
  expect(stored.cover).toBe('#283650')
  expect(stored.highlight).toBe('rgba(1, 2, 3, 0.4)')
  expect(stored.place).toEqual({ chapterId: b.id, offset: 3, at: later })
  expect((await getChapter(a.id))!.date).toBe('März')

  const now = await readLocalFiles()
  await apply({ write: new Map([[`${p}book.json`, now.get(`${p}book.json`)!]]), snapshot: now })
  stored = (await getBook(book.id))!
  expect(stored.cover).toBe('#283650')
  expect((await getChapter(a.id))!.date).toBe('März')

  // Removed in the repository and untouched here: cleared.
  const before = await readLocalFiles()
  await apply({ remove: [`${p}style.json`, `${p}dates.json`, `${p}place.json`], snapshot: before })
  stored = (await getBook(book.id))!
  expect(stored.cover).toBeUndefined()
  expect(stored.highlight).toBeUndefined()
  expect(stored.place).toBeUndefined()
  expect((await getChapter(a.id))!.date).toBeUndefined()
})

test('dates: changed here wins; changed on both sides, both texts are kept with a note', async () => {
  const { p, a, b } = await seed()
  await setChapterDate(a.id, 'Montag')
  await setChapterDate(b.id, 'Dienstag')
  const snapshot = await readLocalFiles()
  const { notes } = await applyFull({
    conflicts: [{ path: `${p}dates.json`, remote: JSON.stringify({ [a.id]: 'Mittwoch', [b.id]: 'Dienstag' }) }],
    snapshot,
  })
  expect((await getChapter(a.id))!.date).toBe('Mittwoch / Montag')
  expect((await getChapter(b.id))!.date).toBe('Dienstag')
  expect(notes.map((n) => n.kind)).toEqual(['dates'])
})

test('a date typed here during the run is kept', async () => {
  const { p, a } = await seed()
  const snapshot = await readLocalFiles()
  await setChapterDate(a.id, 'gerade eben')
  await apply({ write: new Map([[`${p}dates.json`, JSON.stringify({ [a.id]: 'von woanders' })]]), snapshot })
  expect((await getChapter(a.id))!.date).toBe('gerade eben')
})

test('place: the newer one wins; unreadable files are skipped', async () => {
  const { p, book, a, b } = await seed()
  await savePlace(book.id, { chapterId: a.id, offset: 4, at: 2000 })
  await apply({ conflicts: [{ path: `${p}place.json`, remote: JSON.stringify({ chapterId: b.id, offset: 1, at: 1000 }) }], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.place?.chapterId).toBe(a.id)
  await apply({ write: new Map([[`${p}place.json`, JSON.stringify({ chapterId: b.id, offset: 1, at: 3000 })]]), snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.place).toEqual({ chapterId: b.id, offset: 1, at: 3000 })
  const { skipped } = await applyFull({
    write: new Map([[`${p}place.json`, '{"chapterId": 5}'], [`${p}style.json`, 'kein json'], [`${p}dates.json`, '[1, 2]']]),
    snapshot: await readLocalFiles(),
  })
  expect(skipped.sort()).toEqual([`${p}dates.json`, `${p}place.json`, `${p}style.json`].sort())
  expect((await getBook(book.id))!.place?.chapterId).toBe(b.id)
})

test('style changed on both sides: the other device wins, with a note', async () => {
  const { p, book } = await seed()
  await setBookStyle(book.id, { cover: '#6e2a26' })
  const { notes } = await applyFull({
    conflicts: [{ path: `${p}style.json`, remote: JSON.stringify({ cover: '#283650' }) }],
    snapshot: await readLocalFiles(),
  })
  expect((await getBook(book.id))!.cover).toBe('#283650')
  expect(notes.map((n) => n.kind)).toEqual(['style'])
})

test('a colour picked here during the run is kept', async () => {
  const { p, book } = await seed()
  const snapshot = await readLocalFiles()
  await setBookStyle(book.id, { cover: '#6e2a26' })
  await apply({ write: new Map([[`${p}style.json`, JSON.stringify({ cover: '#283650' })]]), snapshot })
  expect((await getBook(book.id))!.cover).toBe('#6e2a26')
})

test('wiki order: taken over, kept when changed here during the run, cleared when removed', async () => {
  const { p, book, entry, folder } = await seed()
  const second = await createEntry(book.id, 'Zweiter', folder.id)
  const snapshot = await readLocalFiles()
  await apply({ write: new Map([[`${p}wiki/order.json`, JSON.stringify({ [folder.id]: [second.id, entry.id] })]]), snapshot })
  expect((await getBook(book.id))!.wikiOrder?.[folder.id]).toEqual([second.id, entry.id])

  const planned = await readLocalFiles()
  await moveWikiItem(book.id, { kind: 'entry', id: entry.id }, { parentId: folder.id, beforeId: second.id })
  await apply({ write: new Map([[`${p}wiki/order.json`, JSON.stringify({ [folder.id]: [second.id, entry.id] })]]), snapshot: planned })
  expect((await getBook(book.id))!.wikiOrder?.[folder.id]).toEqual([entry.id, second.id])

  // Both changed: the other device's order wins.
  await apply({ conflicts: [{ path: `${p}wiki/order.json`, remote: JSON.stringify({ [folder.id]: [second.id, entry.id] }) }], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.wikiOrder?.[folder.id]).toEqual([second.id, entry.id])

  await apply({ remove: [`${p}wiki/order.json`], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.wikiOrder).toBeUndefined()
})

test('folder colours: taken over from their file, kept by a pulled folders.json, cleared when removed', async () => {
  const { p, book, folder } = await seed()
  await apply({ write: new Map([[`${p}wiki/colors.json`, JSON.stringify({ [folder.id]: '#1f4a4f' })]]), snapshot: await readLocalFiles() })
  expect((await listFolders(book.id))[0].color).toBe('#1f4a4f')
  const now = await readLocalFiles()
  await apply({ write: new Map([[`${p}wiki/folders.json`, now.get(`${p}wiki/folders.json`)!]]), snapshot: now })
  expect((await listFolders(book.id))[0].color).toBe('#1f4a4f')
  const planned = await readLocalFiles()
  await setFolderColor(folder.id, '#6e2a26')
  await apply({ write: new Map([[`${p}wiki/colors.json`, JSON.stringify({ [folder.id]: '#1f4a4f' })]]), snapshot: planned })
  expect((await listFolders(book.id))[0].color).toBe('#6e2a26')
  await apply({ remove: [`${p}wiki/colors.json`], snapshot: await readLocalFiles() })
  expect((await listFolders(book.id))[0].color).toBeUndefined()
})

test('notes: taken over; when both devices changed them, both sets are merged by note, newest wins', async () => {
  const { p, book } = await seed()
  const mine = (await addNote(book.id, 'von hier'))!
  const remoteNote = { id: 'r1', text: 'von dort', done: false, createdAt: 1, updatedAt: 1 }
  const { notes } = await applyFull({
    conflicts: [{ path: `${p}notes.json`, remote: JSON.stringify([remoteNote, { ...mine, text: 'älter', updatedAt: mine.updatedAt - 10 }]) }],
    snapshot: await readLocalFiles(),
  })
  expect(notes).toEqual([])
  const stored = (await getBook(book.id))!.notes!
  expect(stored.map((n) => n.text).sort()).toEqual(['von dort', 'von hier'])

  const planned = await readLocalFiles()
  await updateNote(book.id, mine.id, { done: true })
  await apply({ write: new Map([[`${p}notes.json`, JSON.stringify([remoteNote])]]), snapshot: planned })
  expect((await getBook(book.id))!.notes!.find((n) => n.id === mine.id)!.done).toBe(true)

  await apply({ write: new Map([[`${p}notes.json`, JSON.stringify([remoteNote])]]), snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.notes!.map((n) => n.id)).toEqual(['r1'])
  await apply({ write: new Map([[`${p}wiki/stars.json`, JSON.stringify(['e9'])]]), snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.wikiStars).toEqual(['e9'])
  await apply({ remove: [`${p}wiki/stars.json`, `${p}notes.json`], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.wikiStars).toBeUndefined()
  expect((await getBook(book.id))!.notes).toBeUndefined()
})

test('starred blocks: taken over from their file and kept by a pulled folders.json', async () => {
  const { p, book, folder } = await seed()
  const value = JSON.stringify({ [folder.id]: { blocks: ['Aussehen'], fields: { Augenfarbe: 'Aussehen' } } })
  await apply({ write: new Map([[`${p}wiki/template-blocks.json`, value]]), snapshot: await readLocalFiles() })
  expect((await listFolders(book.id))[0].templateBlocks).toEqual(['Aussehen'])
  const now = await readLocalFiles()
  await apply({ write: new Map([[`${p}wiki/folders.json`, now.get(`${p}wiki/folders.json`)!]]), snapshot: now })
  expect((await listFolders(book.id))[0].templateGroups).toEqual({ Augenfarbe: 'Aussehen' })
  await apply({ remove: [`${p}wiki/template-blocks.json`], snapshot: await readLocalFiles() })
  expect((await listFolders(book.id))[0].templateBlocks).toBeUndefined()
})

test('spelling: both devices added words, both lists are kept', async () => {
  const { p, book } = await seed()
  await updateSpelling(book.id, (current) => ({ ...current, words: ['Hiersss'] }))
  await apply({
    conflicts: [{ path: `${p}spelling.json`, remote: JSON.stringify({ dialect: 'british', words: ['Dortsss'] }) }],
    snapshot: await readLocalFiles(),
  })
  expect((await getBook(book.id))!.spelling).toEqual({ dialect: 'british', words: ['Dortsss', 'Hiersss'] })
  await apply({ remove: [`${p}spelling.json`], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.spelling).toBeUndefined()
})

test('the collection travels in its own file outside books/, merged when both sides changed it', async () => {
  const { addToCollection, deleteCollectionItem, getCollection } = await import('../storage/collection')
  expect((await readLocalFiles()).has('collection/collection.json')).toBe(false)
  const mine = (await addToCollection({ text: 'She looked away.', category: 'Blicke' }))!
  const gone = (await addToCollection({ text: 'Old one.', category: 'Blicke' }))!
  await deleteCollectionItem(gone.id)
  const files = await readLocalFiles()
  expect(JSON.parse(files.get('collection/collection.json') as string).items.map((i: { text: string }) => i.text)).toEqual(['She looked away.'])

  const remote = { items: [{ ...gone }, { id: 'r1', text: 'He grinned.', category: 'Lächeln', createdAt: 1, updatedAt: 1 }] }
  await applyFull({ conflicts: [{ path: 'collection/collection.json', remote: JSON.stringify(remote) }], snapshot: files })
  expect((await getCollection()).items.map((i) => i.text).sort()).toEqual(['He grinned.', 'She looked away.'])

  // A plain pull replaces, unless the collection changed here during the run.
  const planned = await readLocalFiles()
  await addToCollection({ text: 'Typed during the run.', category: 'Blicke' })
  await apply({ write: new Map([['collection/collection.json', JSON.stringify({ items: [] })]]), snapshot: planned })
  expect((await getCollection()).items).toHaveLength(3)
  await apply({ write: new Map([['collection/collection.json', JSON.stringify({ items: [remote.items[1]] })]]), snapshot: await readLocalFiles() })
  expect((await getCollection()).items.map((i) => i.id)).toEqual(['r1'])
  expect(mine.id).toBeTruthy()

  await apply({ remove: ['collection/collection.json'], snapshot: await readLocalFiles() })
  expect((await getCollection()).items).toEqual([])
})

test('versions: pulled, removed, and gone with their book', async () => {
  const { listVersions, saveVersion } = await import('../storage/versions')
  const { p, book, a } = await seed()
  await saveVersion(a, 'hier', 'Von hier')
  expect([...(await readLocalFiles()).keys()].some((path) => path.startsWith(`${p}versions/${a.id}/`))).toBe(true)
  const remote = { id: 'r1', chapterId: a.id, content: 'dort', createdAt: 3, label: 'Von dort' }
  await apply({ write: new Map([[`${p}versions/${a.id}/r1.json`, JSON.stringify(remote)]]), snapshot: await readLocalFiles() })
  expect((await listVersions(a.id)).map((v) => v.label)).toEqual(['Von hier', 'Von dort'])
  await apply({ remove: [`${p}versions/${a.id}/r1.json`], snapshot: await readLocalFiles() })
  expect((await listVersions(a.id)).map((v) => v.label)).toEqual(['Von hier'])
  await apply({ remove: [...(await readLocalFiles()).keys()].filter((path) => path.startsWith(p)), snapshot: await readLocalFiles() })
  expect(await listVersions(a.id)).toEqual([])
  expect(book.id).toBeTruthy()
})

test('status: taken over, kept when set here during the run, cleared when removed', async () => {
  const { setChapterStatus } = await import('../storage/db')
  const { p, a, b } = await seed()
  await apply({ write: new Map([[`${p}status.json`, JSON.stringify({ [a.id]: 'draft', [b.id]: 'nonsense' })]]), snapshot: await readLocalFiles() })
  expect((await getChapter(a.id))!.status).toBe('draft')
  expect((await getChapter(b.id))!.status).toBeUndefined()
  const planned = await readLocalFiles()
  await setChapterStatus(a.id, 'done')
  await apply({ write: new Map([[`${p}status.json`, JSON.stringify({ [a.id]: 'idea' })]]), snapshot: planned })
  expect((await getChapter(a.id))!.status).toBe('done')
  await apply({ remove: [`${p}status.json`], snapshot: await readLocalFiles() })
  expect((await getChapter(a.id))!.status).toBeUndefined()
})

test('comments: taken over, kept when changed here during the run, merged by comment on conflict', async () => {
  const { addComment, updateComment } = await import('../storage/comments')
  const { p, a } = await seed()
  const remote = { id: 'r1', from: 0, to: 3, quote: 'alt', text: 'Von dort', done: false, createdAt: 1, updatedAt: 1 }
  await apply({ write: new Map([[`${p}comments.json`, JSON.stringify({ [a.id]: [remote] })]]), snapshot: await readLocalFiles() })
  expect((await getChapter(a.id))!.comments!.map((c) => c.text)).toEqual(['Von dort'])
  const planned = await readLocalFiles()
  await updateComment(a.id, 'r1', { text: 'Hier geändert' })
  await apply({ write: new Map([[`${p}comments.json`, JSON.stringify({})]]), snapshot: planned })
  expect((await getChapter(a.id))!.comments!.map((c) => c.text)).toEqual(['Hier geändert'])
  const mine = await addComment(a.id, { from: 1, to: 2, quote: 'l', text: 'Neu hier' })
  await applyFull({ conflicts: [{ path: `${p}comments.json`, remote: JSON.stringify({ [a.id]: [remote] }) }], snapshot: await readLocalFiles() })
  expect((await getChapter(a.id))!.comments!.map((c) => c.text).sort()).toEqual(['Hier geändert', 'Neu hier'])
  expect(mine.id).toBeTruthy()
  await apply({ remove: [`${p}comments.json`], snapshot: await readLocalFiles() })
  expect((await getChapter(a.id))!.comments).toBeUndefined()
})

test('relationships: taken over, kept when changed here during the run, merged on conflict', async () => {
  const { addRelation, addRelationType, deleteRelation } = await import('../storage/relations')
  const { p, book } = await seed()
  const remote = { types: [{ id: 't1', forward: 'Lehrer von', backward: 'Schüler von' }], relations: [{ id: 'r1', from: 'a', to: 'b', typeId: 't1', createdAt: 1, updatedAt: 1 }] }
  await apply({ write: new Map([[`${p}wiki/relations.json`, JSON.stringify(remote)]]), snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.relations).toEqual(remote)
  const planned = await readLocalFiles()
  const type = await addRelationType(book.id, 'befreundet mit')
  await apply({ write: new Map([[`${p}wiki/relations.json`, JSON.stringify({ types: [], relations: [] })]]), snapshot: planned })
  expect((await getBook(book.id))!.relations!.types).toHaveLength(2)
  await addRelation(book.id, { from: 'c', to: 'd', typeId: type.id })
  await deleteRelation(book.id, 'r1')
  await applyFull({ conflicts: [{ path: `${p}wiki/relations.json`, remote: JSON.stringify(remote) }], snapshot: await readLocalFiles() })
  const merged = (await getBook(book.id))!.relations!
  expect(merged.relations.map((r) => r.from)).toEqual(['c'])
  expect(merged.types.map((t) => t.forward).sort()).toEqual(['Lehrer von', 'befreundet mit'])
  await apply({ remove: [`${p}wiki/relations.json`], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.relations).toBeUndefined()
})

test('modules: taken over, kept when switched here during the run, GitHub wins a conflict, removed', async () => {
  const { setModule } = await import('../storage/modules')
  const { p, book } = await seed()
  await apply({ write: new Map([[`${p}modules.json`, '{"vocabulary":true,"address":true}']]), snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.modules).toEqual({ vocabulary: true, address: true })

  const planned = await readLocalFiles()
  await setModule(book.id, 'vocabulary', false)
  await apply({ write: new Map([[`${p}modules.json`, '{"vocabulary":true}']]), snapshot: planned })
  expect((await getBook(book.id))!.modules).toEqual({ address: true })

  await applyFull({ conflicts: [{ path: `${p}modules.json`, remote: '{"vocabulary":true}' }], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.modules).toEqual({ vocabulary: true })

  await apply({ remove: [`${p}modules.json`], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.modules).toBeUndefined()
})

test('shelf: taken over, kept when changed here during the run, GitHub wins a conflict, removed', async () => {
  const { setPattern, setStarred } = await import('../storage/shelf')
  const { p, book } = await seed()
  const updatedAt = (await getBook(book.id))!.updatedAt
  await apply({ write: new Map([[`${p}shelf.json`, '{"pattern":"dots","starred":true,"ribbon":"red"}']]), snapshot: await readLocalFiles() })
  let stored = (await getBook(book.id))!
  expect(stored.shelf).toEqual({ starred: true, pattern: 'dots', extra: { ribbon: 'red' } })
  expect(stored.updatedAt).toBe(updatedAt)

  const planned = await readLocalFiles()
  await setPattern(book.id, 'zigzag')
  await apply({ write: new Map([[`${p}shelf.json`, '{"pattern":"stripes"}']]), snapshot: planned })
  expect((await getBook(book.id))!.shelf).toEqual({ starred: true, pattern: 'zigzag', extra: { ribbon: 'red' } })

  await applyFull({ conflicts: [{ path: `${p}shelf.json`, remote: '{"starred":true}' }], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.shelf).toEqual({ starred: true })

  await apply({ remove: [`${p}shelf.json`], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.shelf).toBeUndefined()

  // Removed there, but starred here during the run: the star stays.
  await setStarred(book.id, true)
  const before = await readLocalFiles()
  await setStarred(book.id, false)
  await setStarred(book.id, true)
  await setPattern(book.id, 'dots')
  await apply({ remove: [`${p}shelf.json`], snapshot: before })
  stored = (await getBook(book.id))!
  expect(stored.shelf).toEqual({ starred: true, pattern: 'dots' })

  // A file that is not JSON is skipped and changes nothing.
  const { skipped } = await applyFull({ write: new Map([[`${p}shelf.json`, 'kaputt']]), snapshot: await readLocalFiles() })
  expect(skipped).toEqual([`${p}shelf.json`])
  expect((await getBook(book.id))!.shelf).toEqual({ starred: true, pattern: 'dots' })
})

test('vocabulary: taken over, kept when changed here during the run, merged on conflict, removed', async () => {
  const { vocabularyFile } = await import('../vocabulary/vocabularyFile')
  const { p, book } = await seed()
  const word = (id: string, translation: string, updatedAt: number) => ({ id, word: id, translation, known: [], createdAt: 1, updatedAt })
  const remote = { learners: [{ entryId: 'mira', updatedAt: 1 }], words: [word('w1', 'water', 1)] }
  await apply({ write: new Map([[`${p}vocabulary.json`, vocabularyFile(remote)!]]), snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.vocabulary).toEqual(remote)

  const planned = await readLocalFiles()
  const { db } = await import('../storage/connection')
  const putVocabulary = async (vocabulary: object) => {
    const stored = (await getBook(book.id))!
    await (await db()).put('books', { ...stored, vocabulary } as typeof stored)
  }
  await putVocabulary({ learners: [], words: [word('w1', 'water', 1), word('w2', 'stone', 2)] })
  await apply({ write: new Map([[`${p}vocabulary.json`, JSON.stringify({ learners: [], words: [] })]]), snapshot: planned })
  expect((await getBook(book.id))!.vocabulary!.words.map((w) => w.id)).toEqual(['w1', 'w2'])

  await putVocabulary({ learners: [], words: [word('w1', 'water here', 5), word('w2', 'stone', 2)] })
  const theirs = { learners: [], words: [word('w1', 'water there', 3), word('w3', 'bread', 3)], deleted: ['w2'] }
  await applyFull({ conflicts: [{ path: `${p}vocabulary.json`, remote: vocabularyFile(theirs)! }], snapshot: await readLocalFiles() })
  const merged = (await getBook(book.id))!.vocabulary!
  expect(merged.words.map((w) => [w.id, w.translation])).toEqual([
    ['w1', 'water here'],
    ['w3', 'bread'],
  ])
  expect(merged.deleted).toEqual(['w2'])

  await apply({ remove: [`${p}vocabulary.json`], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.vocabulary).toBeUndefined()
})

test('address: taken over, kept when changed here during the run, merged on conflict, removed', async () => {
  const { addressFile } = await import('../address/addressFile')
  const { db } = await import('../storage/connection')
  const { p, book } = await seed()
  const rank = (id: string, name: string, updatedAt: number) => ({ id, name, public: name, updatedAt })
  const remote = { ranks: [rank('r1', 'Duchess', 1)], people: [], forms: [] }
  await apply({ write: new Map([[`${p}address.json`, addressFile(remote)!]]), snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.address).toEqual(remote)

  const planned = await readLocalFiles()
  const putAddress = async (address: object) => {
    const stored = (await getBook(book.id))!
    await (await db()).put('books', { ...stored, address } as typeof stored)
  }
  await putAddress({ ranks: [rank('r1', 'Duchess', 1), rank('r2', 'King', 2)], people: [], forms: [] })
  await apply({ write: new Map([[`${p}address.json`, addressFile({ ranks: [], people: [], forms: [], deleted: ['x'] })!]]), snapshot: planned })
  expect((await getBook(book.id))!.address!.ranks.map((r) => r.id)).toEqual(['r1', 'r2'])

  await putAddress({ ranks: [rank('r1', 'Duchess here', 5), rank('r2', 'King', 2)], people: [], forms: [] })
  const theirs = { ranks: [rank('r1', 'Duchess there', 3), rank('r3', 'Knight', 3)], people: [], forms: [], deleted: ['r2'] }
  await applyFull({ conflicts: [{ path: `${p}address.json`, remote: addressFile(theirs)! }], snapshot: await readLocalFiles() })
  const merged = (await getBook(book.id))!.address!
  expect(merged.ranks.map((r) => [r.id, r.name])).toEqual([
    ['r1', 'Duchess here'],
    ['r3', 'Knight'],
  ])

  await apply({ remove: [`${p}address.json`], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.address).toBeUndefined()
})

test('graph places: taken over, kept when moved here during the run, joined on conflict', async () => {
  const { placeInGraph } = await import('../storage/relations')
  const { p, book } = await seed()
  await apply({ write: new Map([[`${p}wiki/graph.json`, JSON.stringify({ a: { x: 1, y: 1 } })]]), snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.graph).toEqual({ a: { x: 1, y: 1 } })
  const planned = await readLocalFiles()
  await placeInGraph(book.id, { b: { x: 2, y: 2 } })
  await apply({ write: new Map([[`${p}wiki/graph.json`, JSON.stringify({})]]), snapshot: planned })
  expect(Object.keys((await getBook(book.id))!.graph!)).toEqual(['a', 'b'])
  await applyFull({ conflicts: [{ path: `${p}wiki/graph.json`, remote: JSON.stringify({ a: { x: 9, y: 9 }, c: { x: 3, y: 3 } }) }], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.graph).toEqual({ a: { x: 1, y: 1 }, b: { x: 2, y: 2 }, c: { x: 3, y: 3 } })
  await apply({ remove: [`${p}wiki/graph.json`], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.graph).toBeUndefined()
})

test('groups: taken over, kept when changed here during the run, joined on conflict, cleared when removed', async () => {
  const { createGroup, setChapterGroup } = await import('../storage/groups')
  const { p, book, a, b } = await seed()
  const remote = { groups: [{ id: 'g1', name: 'Winterball' }], chapters: { [a.id]: 'g1' } }
  await apply({ write: new Map([[`${p}groups.json`, JSON.stringify(remote)]]), snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.chapterGroups).toEqual(remote.groups)
  expect((await getChapter(a.id))!.group).toBe('g1')
  const planned = await readLocalFiles()
  const mine = await createGroup(book.id, 'Belagerung')
  await setChapterGroup(b.id, mine.id)
  await apply({ write: new Map([[`${p}groups.json`, JSON.stringify({ groups: [], chapters: {} })]]), snapshot: planned })
  expect((await getChapter(b.id))!.group).toBe(mine.id)
  await applyFull({ conflicts: [{ path: `${p}groups.json`, remote: JSON.stringify({ groups: [{ id: 'g2', name: 'Flucht' }], chapters: { [a.id]: 'g2' } }) }], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.chapterGroups!.map((g) => g.name).sort()).toEqual(['Belagerung', 'Flucht', 'Winterball'])
  expect((await getChapter(a.id))!.group).toBe('g1')
  await apply({ remove: [`${p}groups.json`], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.chapterGroups).toBeUndefined()
  expect((await getChapter(b.id))!.group).toBeUndefined()
})

const trashFile = (id: string, kind = 'chapter') => `${JSON.stringify({ id, kind, title: 'Zwei', deletedAt: 1700000000000, chapter: { id: 'c9' } }, null, 2)}\n`

test('a trash file from the repository becomes a trash item, and leaves with it', async () => {
  const { listTrash } = await import('../storage/trash')
  const { p, book } = await seed()
  const file = trashFile('t1')
  await apply({ write: new Map([[`${p}trash/t1.json`, file]]), snapshot: await readLocalFiles() })
  expect(await listTrash(book.id)).toEqual([{ id: 't1', bookId: book.id, kind: 'chapter', title: 'Zwei', deletedAt: 1700000000000, file }])
  // Not mistaken for an image or an entry.
  expect(await listEntries(book.id)).toHaveLength(1)

  await apply({ remove: [`${p}trash/t1.json`], snapshot: await readLocalFiles() })
  expect(await listTrash(book.id)).toEqual([])
})

test('an unreadable trash file is skipped', async () => {
  const { listTrash } = await import('../storage/trash')
  const { p, book } = await seed()
  const result = await applyFull({ write: new Map([[`${p}trash/t1.json`, 'not json'], [`${p}trash/t2.json`, trashFile('other')]]), snapshot: await readLocalFiles() })
  expect(result.skipped.sort()).toEqual([`${p}trash/t1.json`, `${p}trash/t2.json`])
  expect(await listTrash(book.id)).toEqual([])
})

test('a book removed in the repository takes its trash along', async () => {
  const { listTrash, trashChapter } = await import('../storage/trash')
  const { p, book, a } = await seed()
  await trashChapter(a.id)
  const snapshot = await readLocalFiles()
  await apply({ remove: [...snapshot.keys()].filter((path) => path.startsWith(p)), snapshot })
  expect(await listBooks()).toEqual([])
  expect(await listTrash(book.id)).toEqual([])
})

test('readLocalFiles writes the same bytes for a trash item every time', async () => {
  const { trashChapter } = await import('../storage/trash')
  const { p, a } = await seed()
  const item = await trashChapter(a.id)
  const first = await readLocalFiles()
  const second = await readLocalFiles()
  expect(first.get(`${p}trash/${item!.id}.json`)).toBe(item!.file)
  expect(second.get(`${p}trash/${item!.id}.json`)).toBe(item!.file)
  expect(first.has(`${p}chapters/${a.id}.md`)).toBe(false)
})

test('a trash file for a book that is not here is not kept, and the repository should drop it', async () => {
  const { db } = await import('../storage/connection')
  await seed()
  const path = 'books/gone/trash/t1.json'
  const result = await applyFull({ write: new Map([[path, trashFile('t1')]]), snapshot: await readLocalFiles() })
  expect(result.skipped).toEqual([])
  expect(result.obsolete).toEqual([path])
  expect(await (await db()).getAll('trash')).toEqual([])
})

test('favourites travel in their own file next to the collection, merged per word when both sides changed them', async () => {
  const { toggleFavorite, getFavorites } = await import('../storage/favorites')
  const { favoriteKeys, favoriteKey } = await import('../collection/favoritesFile')
  expect((await readLocalFiles()).has('collection/favorites.json')).toBe(false)
  await toggleFavorite('Speed', 'swift')
  const files = await readLocalFiles()
  expect(JSON.parse(files.get('collection/favorites.json') as string).marks.map((m: { text: string }) => m.text)).toEqual(['swift'])
  // Favourites never end up in the collection file.
  expect(files.has('collection/collection.json')).toBe(false)

  const remote = { marks: [{ category: 'Speed', text: 'rapid', on: true, updatedAt: 1 }] }
  await applyFull({ conflicts: [{ path: 'collection/favorites.json', remote: JSON.stringify(remote) }], snapshot: files })
  expect([...favoriteKeys(await getFavorites())].sort()).toEqual([favoriteKey('Speed', 'rapid'), favoriteKey('Speed', 'swift')])

  // A plain pull replaces; if the favourites changed here during the run, both sides are merged per word.
  const planned = await readLocalFiles()
  await toggleFavorite('Speed', 'brisk')
  const fromOther = { marks: [{ category: 'Speed', text: 'rapid', on: true, updatedAt: 1 }, { category: 'Speed', text: 'fleet', on: true, updatedAt: 2 }] }
  await apply({ write: new Map([['collection/favorites.json', JSON.stringify(fromOther)]]), snapshot: planned })
  expect(favoriteKeys(await getFavorites()).size).toBe(4)
  await apply({ write: new Map([['collection/favorites.json', JSON.stringify(remote)]]), snapshot: await readLocalFiles() })
  expect([...favoriteKeys(await getFavorites())]).toEqual([favoriteKey('Speed', 'rapid')])

  await apply({ remove: ['collection/favorites.json'], snapshot: await readLocalFiles() })
  expect((await getFavorites()).marks).toEqual([])
})

test('a favourites file without any marks is taken and then removed from the repository, not fetched forever', async () => {
  const { getFavorites } = await import('../storage/favorites')
  const result = await applyFull({ write: new Map([['collection/favorites.json', '{"marks":[{"text":"no category"}],"later":1}']]), snapshot: new Map() })
  expect((await getFavorites()).marks).toEqual([])
  expect(result.obsolete).toEqual(['collection/favorites.json'])
})

test('sketches: taken over, kept when drawn on here during the run, merged on conflict, removed only when unchanged here', async () => {
  const { sketchFile } = await import('../sketches/sketchFile')
  const { db } = await import('../storage/connection')
  const { p, book } = await seed()
  const stroke = (id: string, createdAt: number) => ({ id, color: '#fff', width: 2 as const, points: [0, 0, 1, 1], createdAt })
  const remote = { id: 'sk1', name: 'Map', strokes: [stroke('a', 1)], stamps: [], createdAt: 1, updatedAt: 1 }
  await apply({ write: new Map([[`${p}sketches/sk1.json`, sketchFile(remote)]]), snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.sketches).toEqual([remote])

  const putSketches = async (sketches: object[]) => {
    const stored = (await getBook(book.id))!
    await (await db()).put('books', { ...stored, sketches } as typeof stored)
  }
  // Drawn here while the run was under way: merged, so the stroke from there is not lost either.
  const planned = await readLocalFiles()
  await putSketches([{ ...remote, strokes: [stroke('a', 1), stroke('mine', 2)] }])
  await apply({ write: new Map([[`${p}sketches/sk1.json`, sketchFile({ ...remote, strokes: [stroke('a', 1), stroke('other', 3)] })]]), snapshot: planned })
  expect((await getBook(book.id))!.sketches![0].strokes.map((s) => s.id)).toEqual(['a', 'mine', 'other'])

  // Both drew: merged, erased stays erased.
  const theirs = { ...remote, strokes: [stroke('a', 1), stroke('theirs', 3)], deleted: ['mine', 'other'], updatedAt: 3 }
  await applyFull({ conflicts: [{ path: `${p}sketches/sk1.json`, remote: sketchFile(theirs) }], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.sketches![0].strokes.map((s) => s.id)).toEqual(['a', 'theirs'])

  // Deleted there while drawn on here: the drawing survives; unchanged here: it goes.
  const before = await readLocalFiles()
  await putSketches([{ ...(await getBook(book.id))!.sketches![0], strokes: [stroke('a', 1), stroke('theirs', 3), stroke('late', 4)], updatedAt: 4 }])
  await apply({ remove: [`${p}sketches/sk1.json`], snapshot: before })
  expect((await getBook(book.id))!.sketches).toHaveLength(1)
  await apply({ remove: [`${p}sketches/sk1.json`], snapshot: await readLocalFiles() })
  expect((await getBook(book.id))!.sketches).toBeUndefined()
})

test('own stamps travel in stamps/stamps.json for all books, merged per stamp', async () => {
  const { stampsFile } = await import('../sketches/stampsFile')
  const { db } = await import('../storage/connection')
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0L1 1"/></svg>'
  expect((await readLocalFiles()).has('stamps/stamps.json')).toBe(false)
  await apply({ write: new Map([['stamps/stamps.json', stampsFile({ stamps: [{ id: 'a', name: 'Turm', svg, updatedAt: 1 }] })!]]), snapshot: await readLocalFiles() })
  const files = await readLocalFiles()
  expect(JSON.parse(files.get('stamps/stamps.json') as string).stamps.map((s: { name: string }) => s.name)).toEqual(['Turm'])

  await (await db()).put('shared', { id: 'stamps', stamps: [{ id: 'a', name: 'Turm', svg, updatedAt: 1 }, { id: 'b', name: 'Brunnen', svg, updatedAt: 2 }] })
  await applyFull({ conflicts: [{ path: 'stamps/stamps.json', remote: stampsFile({ stamps: [{ id: 'c', name: 'Mühle', svg, updatedAt: 3 }], deleted: ['a'] })! }], snapshot: await readLocalFiles() })
  const stored = await (await db()).get('shared', 'stamps')
  expect((stored as { stamps: { name: string }[] }).stamps.map((s) => s.name)).toEqual(['Brunnen', 'Mühle'])
})
