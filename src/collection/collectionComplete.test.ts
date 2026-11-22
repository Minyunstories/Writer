import { CompletionContext, type Completion } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { expect, test } from 'vitest'
import type { CollectionItem } from '../types'
import { collectionCompletionSource } from './collectionComplete'
import { favoriteKey } from './favoritesFile'

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

test('a search word that is an entry brings its whole group first, then the other matches', () => {
  expect(labels(bank, 'He was //swift')).toEqual(['swift', 'rapid', 'breakneck', 'brisk', 'swiftly done', 'Swift'])
  // Siblings show where they come from, like every other suggestion.
  expect(completeIn(bank, '//swift')?.options[1].detail).toBe('Speed · fast')
})

test('a word in several groups offers all of them; partial words and entries without a group offer no siblings', () => {
  expect(labels(bank, '//brisk')).toEqual(['swift', 'rapid', 'breakneck', 'brisk', 'brisk', 'crisp'])
  expect(labels(bank, '//swif')).toEqual(['swift', 'swiftly done', 'Swift'])
  expect(labels([bank[6], bank[0]], '//swiftly done')).toEqual(['swiftly done'])
})

test('the list stays at 30', () => {
  const many: CollectionItem[] = Array.from({ length: 40 }, (_, n) => ({
    id: `m${n}`, text: n === 0 ? 'quick' : `quick ${n}`, category: 'Speed', group: n < 20 ? 'fast' : 'other', createdAt: n, updatedAt: n,
  }))
  const shown = labels(many, '//quick')!
  expect(shown).toHaveLength(30)
  expect(shown.slice(0, 30)).toEqual(many.slice(0, 30).map((i) => i.text))
})

const words: CollectionItem[] = [
  { id: 'n1', text: 'He was cold to her.', category: '1. Distance', group: 'Coldness', createdAt: 1, updatedAt: 1 },
  { id: 'n2', text: 'Holding his breath.', category: '2. Fear', createdAt: 2, updatedAt: 2 },
  { id: 'w1', text: 'chilly', category: 'Temperature', group: 'cold (air)', createdAt: 3, updatedAt: 3 },
  { id: 'w2', text: 'icy', category: 'Temperature', group: 'cold (air)', createdAt: 4, updatedAt: 4 },
  { id: 'w3', text: 'elderly', category: 'Age', group: 'old (people)', createdAt: 5, updatedAt: 5 },
  { id: 'w4', text: 'stone-cold', category: 'Temperature', group: 'cold (touch)', createdAt: 6, updatedAt: 6 },
  { id: 'w5', text: 'strolled', category: 'Verbs', group: 'walked (slowly)', createdAt: 7, updatedAt: 7 },
  { id: 'w6', text: 'ambled', category: 'Verbs', group: 'walked (slowly)', createdAt: 8, updatedAt: 8 },
  { id: 'w7', text: 'swift', category: 'Speed', group: 'fast', createdAt: 9, updatedAt: 9 },
  { id: 'w8', text: 'rapid', category: 'Speed', group: 'fast', createdAt: 10, updatedAt: 10 },
  { id: 'w9', text: 'restful', category: 'Mood', group: 'calm', createdAt: 11, updatedAt: 11 },
  { id: 'w10', text: 'tired', category: 'Body', group: 'weary', createdAt: 12, updatedAt: 12 },
  { id: 'w11', text: 'old as the hills', category: 'Age', group: 'ancient', createdAt: 13, updatedAt: 13 },
  { id: 'w12', text: 'bitter', category: 'Temperature', group: 'cold (air)', tags: ['Word Bank'], createdAt: 14, updatedAt: 14 },
]

test('only word starts match: "//old" finds old, not cold or holding', () => {
  expect(labels(words, '//old')).toEqual(['elderly', 'old as the hills'])
  expect(labels(words, '//red')).toBeUndefined()
  // A word start after a hyphen counts.
  expect(labels(words, '//cold')).toContain('stone-cold')
})

test('groups named after the word come first, then text matches, then category and tag matches', () => {
  // „Coldness“ is not a name for „cold“, so that beat only matches by its text.
  expect(labels(words, '//cold')).toEqual(['chilly', 'icy', 'bitter', 'stone-cold', 'He was cold to her.'])
  expect(labels(words, '//temp')).toEqual(['chilly', 'icy', 'stone-cold', 'bitter'])
  expect(labels(words, '//word bank')).toEqual(['bitter'])
})

test('inflected forms find their group: walking, walks, swiftly, colder', () => {
  expect(labels(words, '//walking')).toEqual(['strolled', 'ambled'])
  expect(labels(words, '//walks')).toEqual(['strolled', 'ambled'])
  expect(labels(words, '//swiftly')).toEqual(['swift', 'rapid'])
  // "Coldness" is no inflection of "cold" (-ness is not a form), so only the cold groups.
  expect(labels(words, '//colder')).toEqual(['chilly', 'icy', 'bitter', 'stone-cold'])
  // Forms of fewer than three letters never join words: "red" is not "rest…".
  expect(labels(words, '//rested')).toBeUndefined()
})

test('suggestions already in the chapter stay in place, marked with how often they occur', () => {
  const options = completeIn(words, 'The chilly night. Chilly, she thought. An icy-blue sky. //cold')!.options
  expect(options.map((o) => o.label)).toEqual(['chilly', 'icy', 'bitter', 'stone-cold', 'He was cold to her.'])
  expect(options[0].detail).toBe('2× im Kapitel · Temperature · cold (air)')
  expect(options[1].detail).toBe('1× im Kapitel · Temperature · cold (air)')
  expect(options[2].detail).toBe('Temperature · cold (air)')
  expect(options.filter((o) => (o as { used?: boolean }).used).map((o) => o.label)).toEqual(['chilly', 'icy'])
  // The word being typed does not count itself.
  expect(completeIn(words, 'It was //chilly')!.options[0].detail).toBe('Temperature · cold (air)')
})

test('only the names before the brackets lead to a group, as a whole: "thin" is not "things"', () => {
  const list: CollectionItem[] = [
    { id: 'x1', text: 'He hid his face.', category: '5. Shame', group: 'Light embarrassment', createdAt: 1, updatedAt: 1 },
    { id: 'x2', text: 'vast', category: 'Size', group: 'big / large (things, spaces)', createdAt: 2, updatedAt: 2 },
    { id: 'x3', text: 'slender', category: 'Size', group: 'thin (people)', createdAt: 3, updatedAt: 3 },
    { id: 'x4', text: 'featherlight', category: 'Weight', group: 'light (weight)', createdAt: 4, updatedAt: 4 },
    { id: 'x5', text: 'airy', category: 'Weight', group: 'light (weight)', createdAt: 5, updatedAt: 5 },
  ]
  expect(labels(list, '//thin')).toEqual(['slender'])
  // The beat group only matches as a group name, after the real groups.
  expect(labels(list, '//light')).toEqual(['featherlight', 'airy', 'He hid his face.'])
  expect(labels(list, '//large')).toEqual(['vast'])
})

test('within a group: favourites first, then recently used (newest first), then the rest in its order', () => {
  const group: CollectionItem[] = ['swift', 'rapid', 'speedy', 'brisk', 'hasty'].map((text, n) => ({
    id: `g${n}`, text, category: 'Speed', group: 'fast', createdAt: n, updatedAt: n,
  }))
  const prefs = () => ({
    favorites: new Set([favoriteKey('Speed', 'brisk')]),
    recent: new Map([[favoriteKey('Speed', 'rapid'), 1], [favoriteKey('Speed', 'hasty'), 2]]),
  })
  const source = collectionCompletionSource(() => group, prefs)
  const result = source(new CompletionContext(EditorState.create({ doc: '//fast' }), 6, false))!
  expect(result.options.map((o) => o.label)).toEqual(['brisk', 'hasty', 'rapid', 'swift', 'speedy'])
})

test('picking a suggestion puts it in place and tells which word was used', () => {
  const used: string[] = []
  const source = collectionCompletionSource(() => bank, undefined, (item) => used.push(item.text))
  const view = new EditorView({ state: EditorState.create({ doc: 'He was //swift' }), parent: document.body })
  const result = source(new CompletionContext(view.state, view.state.doc.length, false))!
  const rapid = result.options.find((o) => o.label === 'rapid')!
  ;(rapid.apply as (view: EditorView, completion: Completion, from: number, to: number) => void)(view, rapid, result.from, view.state.doc.length)
  expect(view.state.doc.toString()).toBe('He was rapid')
  expect(used).toEqual(['rapid'])
  view.destroy()
})
