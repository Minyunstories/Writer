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
  expect(await importIntoCollection(catalogue)).toEqual({ added: 1, known: 1 })
  expect(await importIntoCollection(catalogue)).toEqual({ added: 0, known: 2 })
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
  expect(await importIntoCollection({ items: [{ text: 'chilly', category: 'Temperature', group: 'cold' }] })).toEqual({ added: 1, known: 0 })
})
