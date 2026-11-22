import { expect, test } from 'vitest'
import type { Collection, CollectionItem } from '../types'
import { collectionFile, mergeCollections, parseCatalogue, parseCollection } from './collectionFile'

const item = (id: string, text: string, updatedAt = 1, extra: Partial<CollectionItem> = {}): CollectionItem => ({
  id,
  text,
  category: 'Nicken',
  createdAt: 1,
  updatedAt,
  ...extra,
})

test('the collection file reads back as written, broken items left out', () => {
  const collection: Collection = {
    items: [item('a', 'He nodded.', 1, { group: 'Ersatz', tags: ['kurz'], note: 'nur einmal', source: { bookId: 'b', bookTitle: 'Buch', chapterId: 'c', offset: 4 } })],
    deleted: ['x'],
    guide: { title: 'Katalog', rules: ['Erst kürzen.'], selfcheck: ['Kann ich kürzen?'] },
  }
  expect(parseCollection(collectionFile(collection))).toEqual(collection)
  expect(parseCollection('{"items":[{"id":"a"},{"id":"b","text":"Hi","category":""}]}')).toEqual({
    items: [{ id: 'b', text: 'Hi', category: 'Allgemein', createdAt: 0, updatedAt: 0 }],
  })
  expect(parseCollection('[]')).toBeNull()
})

test('merging keeps the newer version of each item and honours deletions from both sides', () => {
  const mine: Collection = { items: [item('a', 'mine', 5), item('b', 'only here')], deleted: ['c'] }
  const theirs: Collection = { items: [item('a', 'theirs', 3), item('c', 'deleted here'), item('d', 'new there')], deleted: ['b'] }
  const merged = mergeCollections(mine, theirs)
  expect(merged.items.map((i) => i.text)).toEqual(['mine', 'new there'])
  expect(merged.deleted).toEqual(['b', 'c'])
})

test('a category deleted on one device while the other adds to it: only the new entry survives', () => {
  const before: Collection = { items: [item('a', 'sweltering'), item('b', 'chilly'), item('c', 'He nodded.', 1, { category: '1. Nod' })] }
  const mine: Collection = { items: [before.items[2]], deleted: ['a', 'b'] }
  const theirs: Collection = { items: [...before.items, item('d', 'scorching', 2)] }
  const merged = mergeCollections(mine, theirs)
  expect(merged.items.map((i) => i.text)).toEqual(['He nodded.', 'scorching'])
  expect(merged.deleted).toEqual(['a', 'b'])
})

test('the beat catalogue becomes items with its rules as a guide', () => {
  const html = `<script>const DATA = {
  "rules": ["**Cut** first."],
  "selfcheck": ["Can I cut it?"],
  "part_intro": {},
  "categories": [{"num": 1, "title": "Acknowledgment", "target": "the nod", "part": "Expression", "note": "Overused.",
    "groups": [{"label": "Cut", "kind": "subgroup", "items": ["She set down the cup.", "He was already reaching for it."]}]}]
};
</script>`
  const catalogue = parseCatalogue(html)!
  expect(catalogue.guide).toEqual({ title: 'Reaction-Beat-Katalog', rules: ['**Cut** first.'], selfcheck: ['Can I cut it?'], notes: { '1. Acknowledgment': 'the nod — Overused.' } })
  expect(catalogue.items).toEqual([
    { text: 'She set down the cup.', category: '1. Acknowledgment', group: 'Cut', tags: ['Expression'] },
    { text: 'He was already reaching for it.', category: '1. Acknowledgment', group: 'Cut', tags: ['Expression'] },
  ])
  expect(parseCatalogue('<p>nothing</p>')).toBeNull()
})

test('catalogue entries may bring a hint and markers; the category part stays the first tag', () => {
  const source = JSON.stringify({
    categories: [
      { title: 'Temperature', part: 'Word Bank', groups: [{ label: 'hot', items: ['baking', { text: 'close', note: 'schwül, stickig', tags: ['British'] }, { note: 'no text' }] }] },
    ],
  })
  expect(parseCatalogue(source)!.items).toEqual([
    { text: 'baking', category: 'Temperature', group: 'hot', tags: ['Word Bank'] },
    { text: 'close', category: 'Temperature', group: 'hot', tags: ['Word Bank', 'British'], note: 'schwül, stickig' },
  ])
})

test('odd catalogues do not break the import; "fillOnly" and repeated tags are read', () => {
  expect(parseCatalogue(JSON.stringify({ categories: [null, { title: 'A', groups: [null, 3, { items: [null, 2, ['x'], 'ok'] }] }, { title: 'B', groups: {} }] }))!.items).toEqual([{ text: 'ok', category: 'A' }])
  const parsed = parseCatalogue(JSON.stringify({ fillOnly: true, categories: [{ title: 'A', part: 'Word Bank', groups: [{ items: [{ text: 'x', tags: ['word bank', 'British', 'british'] }] }] }] }))!
  expect(parsed.fillOnly).toBe(true)
  expect(parsed.items[0].tags).toEqual(['Word Bank', 'British'])
})
