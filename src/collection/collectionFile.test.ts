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
