import { expect, test } from 'vitest'
import { isJumpKey, searchJump } from './jump'

const chapters = [
  { id: 'c1', title: 'Anfang' },
  { id: 'c2', title: 'Der lange Winter' },
  { id: 'c3', title: 'Mira kehrt zurück' },
]
const folders = [{ id: 'f1', name: 'Figuren' }]
const entries = [
  { id: 'e2', name: 'Pascal', aliases: ['der Kapitän'], folderId: 'f1' },
  { id: 'e1', name: 'Mîra', aliases: [], folderId: 'f1' },
  { id: 'e3', name: 'Winterhafen', aliases: [], folderId: null },
]
const ids = (query: string) => searchJump(query, chapters, entries, folders).map((hit) => hit.id)

test('without a query: chapters in book order, then entries by name', () => {
  expect(ids('')).toEqual(['c1', 'c2', 'c3', 'e1', 'e2', 'e3'])
  expect(searchJump('  ', chapters, entries, folders)[0]).toEqual({ kind: 'chapter', id: 'c1', title: 'Anfang', label: 'Kapitel 1' })
  expect(searchJump('', chapters, entries, folders).find((hit) => hit.id === 'e1')).toEqual({ kind: 'entry', id: 'e1', title: 'Mîra', label: 'Wiki · Figuren' })
  expect(searchJump('', chapters, entries, folders).find((hit) => hit.id === 'e3')!.label).toBe('Wiki')
})

test('a match at the start beats a word start beats anywhere', () => {
  expect(ids('win')).toEqual(['e3', 'c2'])
  expect(ids('ter')).toEqual(['c2', 'e3'])
})

test('case and accents do not matter', () => {
  expect(ids('MIRA')).toEqual(['e1', 'c3'])
})

test('every word of the query has to be there', () => {
  expect(ids('lan win')).toEqual(['c2'])
  expect(ids('lan sommer')).toEqual([])
})

test('an alias finds its entry and says so', () => {
  const [hit] = searchJump('kapitän', chapters, entries, folders)
  expect(hit).toEqual({ kind: 'entry', id: 'e2', title: 'Pascal', label: 'Wiki · Figuren', alias: 'der Kapitän' })
})

test('at most 50 hits', () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `x${i}`, title: `Kapitel ${i}` }))
  expect(searchJump('kapitel', many, [], [])).toHaveLength(50)
})

test('isJumpKey: Ctrl or Cmd with O, without Alt or Shift', () => {
  const key = (init: Partial<KeyboardEvent>) => isJumpKey({ key: 'o', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init })
  expect(key({ ctrlKey: true })).toBe(true)
  expect(key({ metaKey: true, key: 'O' })).toBe(true)
  expect(key({ ctrlKey: true, shiftKey: true })).toBe(false)
  expect(key({ ctrlKey: true, altKey: true })).toBe(false)
  expect(key({})).toBe(false)
})
