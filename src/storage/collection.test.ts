import { beforeEach, expect, test } from 'vitest'
import { resetDatabaseForTests } from './db'
import { addToCollection, deleteCollectionCategory, deleteCollectionItem, getCollection, importIntoCollection, updateCollectionItem } from './collection'

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('items are added, changed and deleted; deleted ones are remembered', async () => {
  expect(await getCollection()).toEqual({ items: [] })
  const item = await addToCollection({ text: '  She looked away.  ', category: ' Blicke ', group: '', note: 'gut für Lea' })
  expect(await addToCollection({ text: '  ', category: 'x' })).toBeNull()
  expect(item).toMatchObject({ text: 'She looked away.', category: 'Blicke', note: 'gut für Lea' })
  expect(item).not.toHaveProperty('group')
  await updateCollectionItem(item!.id, { text: 'She glanced away.' })
  expect((await getCollection()).items[0].text).toBe('She glanced away.')
  await deleteCollectionItem(item!.id)
  expect(await getCollection()).toEqual({ items: [], deleted: [item!.id] })
})

test('importing twice adds nothing twice, and keeps what the writer already had', async () => {
  await addToCollection({ text: 'He nodded.', category: '1. Nod' })
  const catalogue = {
    guide: { title: 'Katalog', rules: ['Cut first.'], selfcheck: ['Can I cut it?'] },
    items: [
      { text: 'He nodded.', category: '1. Nod' },
      { text: 'She set down the cup.', category: '1. Nod', group: 'Cut' },
    ],
  }
  expect(await importIntoCollection(catalogue)).toEqual({ added: 1, known: 1, updated: 0 })
  expect(await importIntoCollection(catalogue)).toEqual({ added: 0, known: 2, updated: 0 })
  const collection = await getCollection()
  expect(collection.items.map((i) => i.text)).toEqual(['He nodded.', 'She set down the cup.'])
  expect(collection.guide?.rules).toEqual(['Cut first.'])
})

test('a whole category is deleted at once; its ids are remembered, other categories stay', async () => {
  await importIntoCollection({
    items: [
      { text: 'sweltering', category: 'Temperature', group: 'hot' },
      { text: 'He nodded.', category: '1. Nod' },
      { text: 'chilly', category: 'Temperature', group: 'cold' },
    ],
  })
  const ids = (await getCollection()).items.filter((i) => i.category === 'Temperature').map((i) => i.id)
  expect(await deleteCollectionCategory('Temperature')).toBe(2)
  const collection = await getCollection()
  expect(collection.items.map((i) => i.text)).toEqual(['He nodded.'])
  expect([...collection.deleted!].sort()).toEqual([...ids].sort())
  // Nothing there: nothing changes, not even the deleted list.
  expect(await deleteCollectionCategory('Temperature')).toBe(0)
  expect((await getCollection()).deleted).toHaveLength(2)
  // Importing the same words again brings them back as new entries.
  expect(await importIntoCollection({ items: [{ text: 'chilly', category: 'Temperature', group: 'cold' }] })).toEqual({ added: 1, known: 0, updated: 0 })
})

test('importing again fills empty hints and adds missing markers, but never replaces what is there', async () => {
  await importIntoCollection({ items: [{ text: 'close', category: 'Temperature', tags: ['Word Bank'] }, { text: 'nippy', category: 'Temperature' }] })
  await addToCollection({ text: 'mine', category: 'Temperature', note: 'meine Notiz' })
  const before = await getCollection()
  const result = await importIntoCollection({
    items: [
      { text: 'Close', category: 'Temperature', tags: ['Word Bank', 'British'], note: 'schwül, stickig' },
      { text: 'nippy', category: 'Temperature' },
      { text: 'mine', category: 'Temperature', note: 'etwas anderes', tags: ['informal'] },
    ],
  })
  expect(result).toEqual({ added: 0, known: 3, updated: 2 })
  const after = await getCollection()
  const byText = (text: string) => after.items.find((item) => item.text === text)!
  expect(byText('close')).toMatchObject({ note: 'schwül, stickig', tags: ['Word Bank', 'British'] })
  // Only one step later than before, so an edit on the other device (made at its real time) still wins a merge.
  expect(byText('close').updatedAt).toBe(before.items.find((item) => item.text === 'close')!.updatedAt + 1)
  expect(byText('mine')).toMatchObject({ note: 'meine Notiz', tags: ['informal'] })
  // Nothing new for "nippy": not touched at all.
  expect(byText('nippy')).toEqual(before.items.find((item) => item.text === 'nippy'))
  // A second run changes nothing.
  const again = await getCollection()
  expect(await importIntoCollection({ items: [{ text: 'close', category: 'Temperature', tags: ['British'], note: 'x' }] })).toEqual({ added: 0, known: 1, updated: 0 })
  expect(await getCollection()).toEqual(again)
})

test('a hint filled by an import loses against an edit made on the other device', async () => {
  const { mergeCollections } = await import('../collection/collectionFile')
  await importIntoCollection({ items: [{ text: 'close', category: 'Temperature' }] })
  const shared = await getCollection()
  // Device A edits the entry later on; device B only imports the hinted word bank.
  const edited = { ...shared.items[0], note: 'meine Notiz', group: 'mine', updatedAt: shared.items[0].updatedAt + 5 }
  // The import happens later in real time than the edit.
  await new Promise((resolve) => setTimeout(resolve, 30))
  await importIntoCollection({ items: [{ text: 'close', category: 'Temperature', note: 'schwül' }] })
  const filled = await getCollection()
  for (const merged of [mergeCollections({ items: [edited] }, filled), mergeCollections(filled, { items: [edited] })])
    expect(merged.items[0]).toMatchObject({ note: 'meine Notiz', group: 'mine' })
})

test('import details: whitespace-only hints are filled, tags are not repeated, a word twice in one file counts once', async () => {
  await addToCollection({ text: 'raw', category: 'T', note: '   ', tags: ['British'] })
  expect(await importIntoCollection({ items: [{ text: 'raw', category: 'T', note: 'nasskalt', tags: ['british', 'informal', 'informal'] }] })).toEqual({ added: 0, known: 1, updated: 1 })
  const raw = (await getCollection()).items.find((item) => item.text === 'raw')!
  expect(raw).toMatchObject({ note: 'nasskalt', tags: ['British', 'informal'] })
  expect(await importIntoCollection({ items: [{ text: 'close', category: 'T' }, { text: 'Close', category: 'T' }] })).toEqual({ added: 1, known: 0, updated: 0 })
})

test('a catalogue marked "fill only" adds no entries, so words deleted earlier stay deleted', async () => {
  await importIntoCollection({ items: [{ text: 'close', category: 'T' }] })
  const result = await importIntoCollection({ fillOnly: true, items: [{ text: 'close', category: 'T', note: 'schwül' }, { text: 'gone', category: 'T', note: 'x' }] })
  expect(result).toEqual({ added: 0, known: 1, updated: 1 })
  expect((await getCollection()).items.map((item) => item.text)).toEqual(['close'])
})
