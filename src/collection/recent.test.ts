import { beforeEach, expect, test } from 'vitest'
import { favoriteKey } from './favoritesFile'
import { recentUses, recordUse } from './recent'

beforeEach(() => localStorage.clear())

test('used words are remembered on this device, newest first, at most 300', () => {
  recordUse('Speed', 'swift')
  recordUse('Speed', 'rapid')
  recordUse('Speed', 'Swift')
  const uses = recentUses()
  expect([...uses.keys()]).toEqual([favoriteKey('Speed', 'swift'), favoriteKey('Speed', 'rapid')])
  expect(uses.get(favoriteKey('Speed', 'swift'))!).toBeGreaterThanOrEqual(uses.get(favoriteKey('Speed', 'rapid'))!)
  for (let n = 0; n < 310; n++) recordUse('Many', `word ${n}`)
  expect(recentUses().size).toBe(300)
  expect(recentUses().has(favoriteKey('Many', 'word 309'))).toBe(true)
})

test('a broken store reads as empty', () => {
  localStorage.setItem('mw:collection-recent', 'nonsense')
  expect(recentUses().size).toBe(0)
})

test('words used within the same moment still keep their order', () => {
  for (const text of ['a', 'b', 'c']) recordUse('S', text)
  const uses = recentUses()
  expect(uses.get(favoriteKey('S', 'c'))!).toBeGreaterThan(uses.get(favoriteKey('S', 'b'))!)
  expect(uses.get(favoriteKey('S', 'b'))!).toBeGreaterThan(uses.get(favoriteKey('S', 'a'))!)
})
