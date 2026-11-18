import { expect, test } from 'vitest'
import type { Book, Chapter, WikiEntry, WikiFolder, WikiImage } from '../types'
import { bookIdOf, bundleToFiles, classifyPath, filesToBundle, type BookBundle, type FileSet } from './files'
import { gitBlobSha } from './hash'

const book: Book = { id: 'b1', title: 'Sturmlied', font: 'inter', chapterOrder: ['c2', 'c1'], createdAt: 10, updatedAt: 99 }
const chapters: Chapter[] = [
  { id: 'c2', bookId: 'b1', title: 'Sturm', content: 'Text\n\n---\n\nmit Strichen\n', outline: '', updatedAt: 30 },
  { id: 'c1', bookId: 'b1', title: 'Anfang', content: 'Größe — „Zitat“', outline: 'Regen.\n---\nKalt.', updatedAt: 20 },
]
const folders: WikiFolder[] = [
  { id: 'f1', bookId: 'b1', parentId: null, name: 'Welt', createdAt: 1 },
  { id: 'f2', bookId: 'b1', parentId: 'f1', name: 'Orte', createdAt: 2 },
]
const entries: WikiEntry[] = [
  {
    id: 'e1',
    bookId: 'b1',
    folderId: 'f2',
    name: 'Pascal',
    aliases: ['the Heir', 'Nys'],
    properties: [{ id: 'p1', key: 'Augenfarbe', value: 'grün' }],
    imageIds: ['i1'],
    body: 'Notiz\n---\nmit Strich',
    autoLink: false,
    createdAt: 5,
    updatedAt: 50,
  },
  { id: 'e2', bookId: 'b1', folderId: null, name: 'Hafen', aliases: [], properties: [], imageIds: [], body: '', autoLink: true, createdAt: 6, updatedAt: 60 },
]
const images: WikiImage[] = [
  { id: 'i1', bookId: 'b1', entryId: 'e1', type: 'image/webp', data: new Uint8Array([0, 255, 7, 13, 10]).buffer, width: 4, height: 2 },
]
const bundle: BookBundle = { book, chapters, folders, entries, images }

const normalise = (b: BookBundle) => ({
  ...b,
  book: { ...b.book, updatedAt: 0 },
  chapters: b.chapters.map((chapter) => ({ ...chapter, updatedAt: 0 })),
  entries: [...b.entries].sort((x, y) => x.id.localeCompare(y.id)),
  folders: [...b.folders].sort((x, y) => x.id.localeCompare(y.id)),
  images: b.images.map((image) => ({ ...image, data: [...new Uint8Array(image.data)] })),
})

test('git blob hashes match git', async () => {
  expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
  expect(await gitBlobSha(new TextEncoder().encode('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  expect(await gitBlobSha('Größe')).toBe(await gitBlobSha(new TextEncoder().encode('Größe')))
})

test('the layout matches the plan and empty notes produce no file', () => {
  expect([...bundleToFiles(bundle).keys()].sort()).toEqual([
    'books/b1/book.json',
    'books/b1/chapters/c1.md',
    'books/b1/chapters/c2.md',
    'books/b1/outline/c1.md',
    'books/b1/wiki/_images/i1.webp',
    'books/b1/wiki/e1.md',
    'books/b1/wiki/e2.md',
    'books/b1/wiki/folders.json',
  ])
  expect(bookIdOf('books/b1/chapters/c1.md')).toBe('b1')
  expect(bookIdOf('README.md')).toBeNull()
})

test('a bundle survives the round trip', () => {
  expect(normalise(filesToBundle('b1', bundleToFiles(bundle)))).toEqual(normalise(bundle))
})

test('files are readable and serialising twice is byte-identical', () => {
  const first = bundleToFiles(bundle)
  const second = bundleToFiles(filesToBundle('b1', first))
  expect([...second.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : [...v]])).toEqual(
    [...first.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : [...v]]),
  )
  expect(first.get('books/b1/chapters/c1.md')).toBe('Größe — „Zitat“')
  const entry = first.get('books/b1/wiki/e1.md') as string
  expect(entry.startsWith('---\n{\n  "id": "e1",\n  "name": "Pascal"')).toBe(true)
  expect(entry.endsWith('\n---\nNotiz\n---\nmit Strich')).toBe(true)
  expect(JSON.parse(first.get('books/b1/book.json') as string).chapters.map((c: { title: string }) => c.title)).toEqual(['Sturm', 'Anfang'])
})

test('parsing is tolerant', () => {
  const files: FileSet = bundleToFiles(bundle)
  files.set('books/b1/chapters/c1.md', 'Zeile eins\r\nZeile zwei')
  files.set('books/b1/chapters/extra.md', 'Nicht in book.json')
  files.delete('books/b1/chapters/c2.md')
  files.set('books/b1/wiki/broken.md', 'kein Kopf')
  files.set('books/b1/wiki/broken2.md', '---\n{ not json\n---\n')
  const parsed = filesToBundle('b1', files)
  expect(parsed.chapters.map((c) => [c.id, c.title, c.content])).toEqual([
    ['c2', 'Sturm', ''],
    ['c1', 'Anfang', 'Zeile eins\nZeile zwei'],
    ['extra', 'Unbenannt', 'Nicht in book.json'],
  ])
  expect(parsed.book.chapterOrder).toEqual(['c2', 'c1', 'extra'])
  expect(parsed.entries.map((e) => e.id).sort()).toEqual(['e1', 'e2'])
})

test('a book without book.json still parses from its files', () => {
  const files: FileSet = new Map([['books/b9/chapters/x.md', 'Text']])
  const parsed = filesToBundle('b9', files)
  expect(parsed.book).toMatchObject({ id: 'b9', title: 'Unbenannt', font: 'literata', chapterOrder: ['x'] })
})

test('tags and templates live in their own files; book.json and folders.json never change because of them', () => {
  const plain = bundleToFiles(bundle)
  expect(plain.has('books/b1/tags.json')).toBe(false)
  expect(plain.has('books/b1/wiki/templates.json')).toBe(false)

  const tagged: BookBundle = {
    ...bundle,
    chapters: bundle.chapters.map((c) => (c.id === 'c2' ? { ...c, tags: ['PoV: Pascal', 'Sturm'] } : c)),
    folders: bundle.folders.map((f) => (f.id === 'f1' ? { ...f, template: ['Augenfarbe', 'Alter'] } : f)),
  }
  const files = bundleToFiles(tagged)
  // An older app version re-serialises these two files byte for byte, so it can never strip anything.
  expect(files.get('books/b1/book.json')).toBe(plain.get('books/b1/book.json'))
  expect(files.get('books/b1/wiki/folders.json')).toBe(plain.get('books/b1/wiki/folders.json'))
  expect(JSON.parse(files.get('books/b1/tags.json') as string)).toEqual({ c2: ['PoV: Pascal', 'Sturm'] })
  expect(JSON.parse(files.get('books/b1/wiki/templates.json') as string)).toEqual({ f1: ['Augenfarbe', 'Alter'] })
  expect(classifyPath('books/b1/tags.json')).toEqual({ bookId: 'b1', kind: 'tags', id: 'b1' })
  expect(classifyPath('books/b1/wiki/templates.json')).toEqual({ bookId: 'b1', kind: 'templates', id: 'b1' })

  const back = filesToBundle('b1', files)
  expect(back.chapters.find((c) => c.id === 'c2')!.tags).toEqual(['PoV: Pascal', 'Sturm'])
  expect(back.chapters.find((c) => c.id === 'c1')!.tags).toBeUndefined()
  expect(back.folders.find((f) => f.id === 'f1')!.template).toEqual(['Augenfarbe', 'Alter'])
  expect(back.folders.find((f) => f.id === 'f2')!.template).toBeUndefined()
  const again = bundleToFiles(back)
  for (const path of ['books/b1/tags.json', 'books/b1/wiki/templates.json']) expect(again.get(path)).toBe(files.get(path))
})

test('cover, highlight, dates and place live in their own files; book.json never changes because of them', () => {
  const plain = bundleToFiles(bundle)
  for (const name of ['style.json', 'dates.json', 'place.json']) expect(plain.has(`books/b1/${name}`)).toBe(false)

  const styled: BookBundle = {
    ...bundle,
    book: { ...book, cover: '#283650', highlight: 'rgba(143, 184, 150, 0.40)', place: { chapterId: 'c1', offset: 7, at: 1234 } },
    chapters: chapters.map((c) => (c.id === 'c1' ? { ...c, date: 'März 1204' } : c)),
  }
  const files = bundleToFiles(styled)
  expect(files.get('books/b1/book.json')).toBe(plain.get('books/b1/book.json'))
  expect(JSON.parse(files.get('books/b1/style.json') as string)).toEqual({ cover: '#283650', highlight: 'rgba(143, 184, 150, 0.40)' })
  expect(JSON.parse(files.get('books/b1/dates.json') as string)).toEqual({ c1: 'März 1204' })
  expect(JSON.parse(files.get('books/b1/place.json') as string)).toEqual({ chapterId: 'c1', offset: 7, at: 1234 })
  expect(classifyPath('books/b1/style.json')).toEqual({ bookId: 'b1', kind: 'style', id: 'b1' })
  expect(classifyPath('books/b1/dates.json')).toEqual({ bookId: 'b1', kind: 'dates', id: 'b1' })
  expect(classifyPath('books/b1/place.json')).toEqual({ bookId: 'b1', kind: 'place', id: 'b1' })

  const back = filesToBundle('b1', files)
  expect(back.book.cover).toBe('#283650')
  expect(back.book.highlight).toBe('rgba(143, 184, 150, 0.40)')
  expect(back.book.place).toEqual({ chapterId: 'c1', offset: 7, at: 1234 })
  expect(back.chapters.find((c) => c.id === 'c1')!.date).toBe('März 1204')
  expect(back.chapters.find((c) => c.id === 'c2')!.date).toBeUndefined()
  const again = bundleToFiles(back)
  for (const name of ['style.json', 'dates.json', 'place.json']) expect(again.get(`books/b1/${name}`)).toBe(files.get(`books/b1/${name}`))
})

test('junk in style, dates and place is ignored field by field', () => {
  const files = bundleToFiles(bundle)
  files.set('books/b1/style.json', JSON.stringify({ cover: 'url(evil)', highlight: '#d58d62' }))
  files.set('books/b1/dates.json', JSON.stringify({ c1: 5, c2: 'x'.repeat(60) }))
  files.set('books/b1/place.json', JSON.stringify({ chapterId: 3, offset: 'a' }))
  const back = filesToBundle('b1', files)
  expect(back.book.cover).toBeUndefined()
  expect(back.book.highlight).toBe('#d58d62')
  expect(back.book.place).toBeUndefined()
  expect(back.chapters.find((c) => c.id === 'c1')!.date).toBeUndefined()
  expect(back.chapters.find((c) => c.id === 'c2')!.date).toBe('x'.repeat(40))
})

test('the wiki order lives in its own file', () => {
  const plain = bundleToFiles(bundle)
  expect(plain.has('books/b1/wiki/order.json')).toBe(false)
  const ordered: BookBundle = { ...bundle, book: { ...book, wikiOrder: { f1: ['f2', 'e1'], _root: ['f1', 'e2'] } } }
  const files = bundleToFiles(ordered)
  expect(files.get('books/b1/book.json')).toBe(plain.get('books/b1/book.json'))
  expect(files.get('books/b1/wiki/folders.json')).toBe(plain.get('books/b1/wiki/folders.json'))
  expect(JSON.parse(files.get('books/b1/wiki/order.json') as string)).toEqual({ _root: ['f1', 'e2'], f1: ['f2', 'e1'] })
  expect(classifyPath('books/b1/wiki/order.json')).toEqual({ bookId: 'b1', kind: 'wikiOrder', id: 'b1' })
  const back = filesToBundle('b1', files)
  expect(back.book.wikiOrder).toEqual({ _root: ['f1', 'e2'], f1: ['f2', 'e1'] })
  expect(bundleToFiles(back).get('books/b1/wiki/order.json')).toBe(files.get('books/b1/wiki/order.json'))

  files.set('books/b1/wiki/order.json', JSON.stringify({ _root: 'x', f1: ['a', 3] }))
  expect(filesToBundle('b1', files).book.wikiOrder).toEqual({ f1: ['a'] })
})

test('folder colours live in their own file', () => {
  const plain = bundleToFiles(bundle)
  const coloured: BookBundle = { ...bundle, folders: bundle.folders.map((f) => (f.id === 'f1' ? { ...f, color: '#1f4a4f' } : f)) }
  const files = bundleToFiles(coloured)
  expect(files.get('books/b1/wiki/folders.json')).toBe(plain.get('books/b1/wiki/folders.json'))
  expect(JSON.parse(files.get('books/b1/wiki/colors.json') as string)).toEqual({ f1: '#1f4a4f' })
  expect(classifyPath('books/b1/wiki/colors.json')).toEqual({ bookId: 'b1', kind: 'folderColors', id: 'b1' })
  const back = filesToBundle('b1', files)
  expect(back.folders.find((f) => f.id === 'f1')!.color).toBe('#1f4a4f')
  expect(back.folders.find((f) => f.id === 'f2')!.color).toBeUndefined()
  files.set('books/b1/wiki/colors.json', JSON.stringify({ f1: 'url(x)', f2: '#4d5a2b' }))
  const junk = filesToBundle('b1', files)
  expect(junk.folders.find((f) => f.id === 'f1')!.color).toBeUndefined()
  expect(junk.folders.find((f) => f.id === 'f2')!.color).toBe('#4d5a2b')
})

test('notes and stars live in their own files', () => {
  const plain = bundleToFiles(bundle)
  const note = { id: 'n1', text: 'Idee', chapterId: 'c1', from: 3, done: false, createdAt: 5, updatedAt: 6 }
  const files = bundleToFiles({ ...bundle, book: { ...book, notes: [note], wikiStars: ['e1'] } })
  expect(files.get('books/b1/book.json')).toBe(plain.get('books/b1/book.json'))
  expect(JSON.parse(files.get('books/b1/notes.json') as string)).toEqual([note])
  expect(JSON.parse(files.get('books/b1/wiki/stars.json') as string)).toEqual(['e1'])
  expect(classifyPath('books/b1/notes.json')).toEqual({ bookId: 'b1', kind: 'notes', id: 'b1' })
  expect(classifyPath('books/b1/wiki/stars.json')).toEqual({ bookId: 'b1', kind: 'stars', id: 'b1' })
  const back = filesToBundle('b1', files)
  expect(back.book.notes).toEqual([note])
  expect(back.book.wikiStars).toEqual(['e1'])
  files.set('books/b1/notes.json', JSON.stringify([{ id: 'x' }, { id: 'n2', text: 'gut', done: 'ja', createdAt: 1, updatedAt: 1 }]))
  expect(filesToBundle('b1', files).book.notes).toEqual([{ id: 'n2', text: 'gut', done: false, createdAt: 1, updatedAt: 1 }])
})

test('property blocks: groups and own blocks travel in the entry, starred blocks in their own file', () => {
  const grouped: BookBundle = {
    ...bundle,
    entries: bundle.entries.map((e, i) =>
      i === 0 ? { ...e, blocks: ['Hobbys'], properties: [{ id: 'p1', key: 'Größe', value: '1,80', group: 'Aussehen' }, { id: 'p2', key: 'Angeln', value: 'ja', group: 'Hobbys' }] } : e,
    ),
    folders: bundle.folders.map((f) => (f.id === 'f1' ? { ...f, template: ['Augenfarbe'], templateBlocks: ['Aussehen'], templateGroups: { Augenfarbe: 'Aussehen' } } : f)),
  }
  const files = bundleToFiles(grouped)
  expect(JSON.parse(files.get('books/b1/wiki/template-blocks.json') as string)).toEqual({ f1: { blocks: ['Aussehen'], fields: { Augenfarbe: 'Aussehen' } } })
  expect(classifyPath('books/b1/wiki/template-blocks.json')).toEqual({ bookId: 'b1', kind: 'templateBlocks', id: 'b1' })
  const back = filesToBundle('b1', files)
  const entry = back.entries.find((e) => e.id === grouped.entries[0].id)!
  expect(entry.blocks).toEqual(['Hobbys'])
  expect(entry.properties.map((p) => p.group)).toEqual(['Aussehen', 'Hobbys'])
  const folder = back.folders.find((f) => f.id === 'f1')!
  expect(folder.templateBlocks).toEqual(['Aussehen'])
  expect(folder.templateGroups).toEqual({ Augenfarbe: 'Aussehen' })
  expect(bundleToFiles(back).get('books/b1/wiki/template-blocks.json')).toBe(files.get('books/b1/wiki/template-blocks.json'))
  // Without blocks nothing changes in the files.
  const plain = bundleToFiles(bundle)
  expect(plain.has('books/b1/wiki/template-blocks.json')).toBe(false)
  expect([...plain.values()].some((text) => typeof text === 'string' && text.includes('"group"'))).toBe(false)
})

test('spelling settings live in their own file', () => {
  const plain = bundleToFiles(bundle)
  const spelling = { dialect: 'british' as const, words: ['Nysss', 'Guidelight'], ignored: ['123'] }
  const files = bundleToFiles({ ...bundle, book: { ...book, spelling } })
  expect(files.get('books/b1/book.json')).toBe(plain.get('books/b1/book.json'))
  expect(JSON.parse(files.get('books/b1/spelling.json') as string)).toEqual(spelling)
  expect(classifyPath('books/b1/spelling.json')).toEqual({ bookId: 'b1', kind: 'spelling', id: 'b1' })
  expect(filesToBundle('b1', files).book.spelling).toEqual(spelling)
  files.set('books/b1/spelling.json', JSON.stringify({ dialect: 'klingon', words: ['ok', 4] }))
  expect(filesToBundle('b1', files).book.spelling).toEqual({ words: ['ok'] })
})

test('switched-off check rules travel with the spelling settings', () => {
  const files = bundleToFiles({ ...bundle, book: { ...book, spelling: { rules: ['NoCurses'] } } })
  expect(filesToBundle('b1', files).book.spelling).toEqual({ rules: ['NoCurses'] })
})

test('the collection file is managed by the app but belongs to no book', () => {
  expect(classifyPath('collection/collection.json')).toEqual({ bookId: '', kind: 'collection', id: 'collection' })
  expect(classifyPath('collection/other.json')).toBeNull()
})

test('named versions travel in files of their own; automatic ones stay on the device', () => {
  const versions = [
    { id: 'v1', bookId: 'b1', chapterId: 'c1', content: 'früher', createdAt: 5, label: 'Erste', auto: false },
    { id: 'v2', bookId: 'b1', chapterId: 'c1', content: 'auto', createdAt: 6, auto: true },
  ]
  const files = bundleToFiles({ ...bundle, versions })
  expect([...files.keys()].filter((path) => path.includes('versions/'))).toEqual(['books/b1/versions/c1/v1.json'])
  expect(classifyPath('books/b1/versions/c1/v1.json')).toEqual({ bookId: 'b1', kind: 'version', id: 'v1' })
  expect(filesToBundle('b1', files).versions).toEqual([versions[0]])
})

test('chapter status travels in status.json', () => {
  const withStatus = { ...bundle, chapters: bundle.chapters.map((chapter, index) => (index === 0 ? { ...chapter, status: 'revision' as const } : chapter)) }
  const files = bundleToFiles(withStatus)
  const id = withStatus.chapters[0].id
  expect(JSON.parse(files.get('books/b1/status.json') as string)).toEqual({ [id]: 'revision' })
  expect(classifyPath('books/b1/status.json')).toEqual({ bookId: 'b1', kind: 'status', id: 'b1' })
  expect(filesToBundle('b1', files).chapters.find((chapter) => chapter.id === id)!.status).toBe('revision')
  expect(bundleToFiles(bundle).has('books/b1/status.json')).toBe(false)
})
