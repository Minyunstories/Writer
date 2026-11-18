import { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { expect, test } from 'vitest'
import type { CollectionItem } from '../types'
import { collectionCompletionSource } from './collectionComplete'

const items: CollectionItem[] = [
  { id: '1', text: 'She looked away.', category: 'Blicke', group: 'Ausweichen', createdAt: 1, updatedAt: 1 },
  { id: '2', text: 'He nodded once.', category: 'Nicken', createdAt: 1, updatedAt: 1 },
]
const source = collectionCompletionSource(() => items)
const complete = (doc: string) => source(new CompletionContext(EditorState.create({ doc }), doc.length, false))

test('"//" with a search word offers matching items from text, category and group', () => {
  expect(complete('Then //look')?.options.map((o) => o.label)).toEqual(['She looked away.'])
  expect(complete('//nick')?.options.map((o) => o.label)).toEqual(['He nodded once.'])
  expect(complete('//ausw')?.from).toBe(0)
})

test('web addresses and plain text do not open the list', () => {
  expect(complete('see https://look')).toBeNull()
  expect(complete('Then look')).toBeNull()
  expect(complete('//')).toBeNull()
})
