import { expect, test } from 'vitest'
import type { WikiEntry, WikiFolder } from '../types'
import { orderedChildren, orderKey } from './order'

const f = (id: string, name: string, parentId: string | null = null): WikiFolder => ({ id, bookId: 'b', name, parentId, createdAt: 0 })
const e = (id: string, name: string, folderId: string | null = null): WikiEntry => ({
  id,
  bookId: 'b',
  folderId,
  name,
  aliases: [],
  properties: [],
  imageIds: [],
  body: '',
  autoLink: true,
  createdAt: 0,
  updatedAt: 0,
})

test('children follow the stored order, the rest alphabetically after it; folders stay above entries', () => {
  const folders = [f('f1', 'Orte'), f('f2', 'Charaktere'), f('f3', 'Sub', 'f1')]
  const entries = [e('a', 'Zora'), e('b', 'Anna'), e('c', 'Mira'), e('d', 'Hafen', 'f1')]
  const order = { _root: ['c', 'f1', 'gone', 'a'] }
  const root = orderedChildren(null, folders, entries, order)
  expect(root.folders.map((x) => x.id)).toEqual(['f1', 'f2'])
  expect(root.entries.map((x) => x.id)).toEqual(['c', 'a', 'b'])
  expect(orderedChildren('f1', folders, entries, order).folders.map((x) => x.id)).toEqual(['f3'])
  expect(orderedChildren('f1', folders, entries, order).entries.map((x) => x.id)).toEqual(['d'])
  expect(orderedChildren(null, folders, entries).entries.map((x) => x.name)).toEqual(['Anna', 'Mira', 'Zora'])
  // A missing parent counts as the top level, so nothing is hidden.
  expect(orderedChildren(null, folders, [e('x', 'Waise', 'weg')], {}).entries.map((x) => x.id)).toEqual(['x'])
  expect(orderKey(null)).toBe('_root')
  expect(orderKey('f1')).toBe('f1')
})
