import { expect, test } from 'vitest'
import type { Favorites } from '../types'
import { favoriteKey, favoriteKeys, favoritesFile, mergeFavorites, parseFavorites } from './favoritesFile'

const mark = (text: string, on: boolean, updatedAt: number, category = 'Speed') => ({ category, text, on, updatedAt })

test('the key ignores case and spaces of the text, but keeps the category', () => {
  expect(favoriteKey('Speed', ' Swift ')).toBe(favoriteKey('Speed', 'swift'))
  expect(favoriteKey('Speed', 'swift')).not.toBe(favoriteKey('Temperature', 'swift'))
})

test('the file is sorted and stable, keeps removed marks and unknown fields, and reads back', () => {
  const favorites: Favorites = { marks: [mark('swift', true, 2), mark('rapid', false, 3)], extra: { later: 1 } }
  const text = favoritesFile(favorites)!
  expect(JSON.parse(text)).toEqual({ marks: [mark('rapid', false, 3), mark('swift', true, 2)], later: 1 })
  expect(favoritesFile(parseFavorites(text)!)).toBe(text)
  expect(favoritesFile({ marks: [] })).toBeUndefined()
  expect(parseFavorites('[]')).toBeNull()
  expect(parseFavorites('{"marks":[{"text":"x"},{"category":"A","text":"y","on":true,"updatedAt":1,"more":2}]}')).toEqual({
    marks: [{ category: 'A', text: 'y', on: true, updatedAt: 1, extra: { more: 2 } }],
  })
})

test('merging keeps the newer mark per word; only marks that are on count as favourites', () => {
  const mine: Favorites = { marks: [mark('swift', false, 5), mark('rapid', true, 1)] }
  const theirs: Favorites = { marks: [mark('swift', true, 4), mark('rapid', false, 2), mark('brisk', true, 3)] }
  const merged = mergeFavorites(mine, theirs)
  expect(merged.marks.map((m) => [m.text, m.on])).toEqual([['brisk', true], ['rapid', false], ['swift', false]])
  expect([...favoriteKeys(merged)]).toEqual([favoriteKey('Speed', 'brisk')])
})

test('a word listed twice keeps only its newest mark', () => {
  const parsed = parseFavorites(JSON.stringify({ marks: [mark('swift', false, 1), mark('Swift', true, 3), mark('swift', false, 2)] }))!
  expect(parsed.marks).toEqual([mark('Swift', true, 3)])
})
