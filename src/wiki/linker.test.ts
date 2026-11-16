import { expect, test } from 'vitest'
import { buildMatcher } from './linker'

const entry = (id: string, name: string, extra: Partial<{ aliases: string[]; autoLink: boolean; createdAt: number }> = {}) => ({
  id,
  name,
  aliases: [],
  autoLink: true,
  createdAt: 1,
  ...extra,
})

const matcher = buildMatcher([
  entry('pascal', 'Pascal', { aliases: ['the Heir'] }),
  entry('arlen', 'Pascal Arlen'),
  entry('rose', 'Rose'),
  entry('storm', 'Storm', { autoLink: false }),
])

const ids = (text: string) => matcher.find(text).map((m) => `${m.entryId}:${text.slice(m.from, m.to)}`)

test('matches a whole name', () => {
  expect(matcher.find('Pascal stood.')).toEqual([{ from: 0, to: 6, entryId: 'pascal' }])
})

test('possessives match, longer words and other case do not', () => {
  expect(ids("Pascal's coat")).toEqual(['pascal:Pascal'])
  expect(ids('Pascalss Rosenkohl rose')).toEqual([])
})

test('the longest name wins', () => {
  expect(ids('Pascal Arlen came')).toEqual(['arlen:Pascal Arlen'])
  expect(ids('Pascal and Pascal Arlen')).toEqual(['pascal:Pascal', 'arlen:Pascal Arlen'])
})

test('aliases match; entries with autoLink off do not', () => {
  expect(ids('Hail the Heir!')).toEqual(['pascal:the Heir'])
  expect(ids('Storm came')).toEqual([])
})

test('boundaries respect umlauts and accents', () => {
  expect(ids('Größe Rose.')).toEqual(['rose:Rose'])
  expect(ids('Roseé')).toEqual([])
  expect(ids('ÄRose')).toEqual([])
  expect(ids('„Rose“—Rose…')).toEqual(['rose:Rose', 'rose:Rose'])
})

test('names with special characters match literally', () => {
  const special = buildMatcher([entry('x', 'Mr. X'), entry('cpp', 'C++'), entry('q', 'What?')])
  const found = (text: string) => special.find(text).map((m) => m.entryId)
  expect(found('Mr. X likes C++.')).toEqual(['x', 'cpp'])
  expect(found('Mr Y likes C and MrzX')).toEqual([])
  expect(found('What? No.')).toEqual(['q'])
})

test('with a shared name the entry created first wins', () => {
  const shared = buildMatcher([entry('late', 'Rose', { createdAt: 5 }), entry('early', 'Rose', { createdAt: 2 })])
  expect(shared.find('Rose')[0].entryId).toBe('early')
})

test('offset shifts the positions', () => {
  expect(matcher.find('Rose', 100)).toEqual([{ from: 100, to: 104, entryId: 'rose' }])
})

test('an empty list matches nothing', () => {
  const empty = buildMatcher([])
  expect(empty.size).toBe(0)
  expect(empty.find('Pascal Rose')).toEqual([])
  expect(buildMatcher([entry('blank', '   ', { aliases: ['', ' '] })]).size).toBe(0)
})
