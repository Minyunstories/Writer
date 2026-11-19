import { expect, test } from 'vitest'
import type { Book } from '../types'
import { COVER_PATTERNS, isStarred, patternOf, shelfOrder } from './shelf'

const book = (id: string, updatedAt: number, starred = false): Book => ({
  id,
  title: id,
  font: 'literata',
  chapterOrder: [],
  createdAt: 0,
  updatedAt,
  ...(starred ? { shelf: { starred: true as const } } : {}),
})

test('five patterns, with German names', () => {
  expect(COVER_PATTERNS.map((pattern) => pattern.name)).toEqual(['Streifen', 'Rauten', 'Punkte', 'Zickzack', 'Schuppen'])
})

test('starred books first, each group with the last changed first', () => {
  const books = [book('a', 5), book('b', 9), book('c', 1, true), book('d', 7, true)]
  expect(shelfOrder(books).map((b) => b.id)).toEqual(['d', 'c', 'b', 'a'])
  // The list given stays as it was.
  expect(books.map((b) => b.id)).toEqual(['a', 'b', 'c', 'd'])
})

test('isStarred and patternOf read the shelf; unknown patterns show as none', () => {
  expect(isStarred({})).toBe(false)
  expect(isStarred({ shelf: { starred: true } })).toBe(true)
  expect(patternOf({})).toBeUndefined()
  expect(patternOf({ shelf: { pattern: 'scales' } })).toBe('scales')
  expect(patternOf({ shelf: { pattern: 'tartan' } })).toBeUndefined()
})
