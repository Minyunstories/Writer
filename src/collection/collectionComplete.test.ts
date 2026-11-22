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

const bank: CollectionItem[] = [
  { id: 'a', text: 'swift', category: 'Speed', group: 'fast', createdAt: 1, updatedAt: 1 },
  { id: 'b', text: 'rapid', category: 'Speed', group: 'fast', createdAt: 2, updatedAt: 2 },
  { id: 'c', text: 'breakneck', category: 'Speed', group: 'fast', createdAt: 3, updatedAt: 3 },
  { id: 'd', text: 'brisk', category: 'Speed', group: 'fast', createdAt: 4, updatedAt: 4 },
  { id: 'e', text: 'brisk', category: 'Temperature', group: 'cool', createdAt: 5, updatedAt: 5 },
  { id: 'f', text: 'crisp', category: 'Temperature', group: 'cool', createdAt: 6, updatedAt: 6 },
  { id: 'g', text: 'swiftly done', category: 'Phrases', createdAt: 7, updatedAt: 7 },
  { id: 'h', text: 'slow', category: 'Speed', group: 'slow', createdAt: 8, updatedAt: 8 },
  { id: 'i', text: 'Swift', category: 'Notes', createdAt: 9, updatedAt: 9 },
]
const completeIn = (list: CollectionItem[], doc: string) =>
  collectionCompletionSource(() => list)(new CompletionContext(EditorState.create({ doc }), doc.length, false))
const labels = (list: CollectionItem[], doc: string) => completeIn(list, doc)?.options.map((o) => o.label)

test('a search word that is an entry also offers the rest of its group, after the direct matches', () => {
  expect(labels(bank, 'He was //swift')).toEqual(['swift', 'swiftly done', 'Swift', 'rapid', 'breakneck', 'brisk'])
  // Siblings show where they come from, like every other suggestion.
  expect(completeIn(bank, '//swift')?.options[3].detail).toBe('Speed · fast')
})

test('a word in several groups offers all of them; partial words and entries without a group offer no siblings', () => {
  expect(labels(bank, '//brisk')).toEqual(['brisk', 'brisk', 'swift', 'rapid', 'breakneck', 'crisp'])
  expect(labels(bank, '//swif')).toEqual(['swift', 'swiftly done', 'Swift'])
  expect(labels([bank[6], bank[0]], '//swiftly done')).toEqual(['swiftly done'])
})

test('siblings never push out direct matches: the list stays at 30', () => {
  const many: CollectionItem[] = Array.from({ length: 40 }, (_, n) => ({
    id: `m${n}`, text: n === 0 ? 'quick' : `quick ${n}`, category: 'Speed', group: n < 20 ? 'fast' : 'other', createdAt: n, updatedAt: n,
  }))
  const shown = labels(many, '//quick')!
  expect(shown).toHaveLength(30)
  expect(shown.slice(0, 30)).toEqual(many.slice(0, 30).map((i) => i.text))
})
