import { expect, test } from 'vitest'
import { parseShelf, shelfFile } from './shelfFile'

test('nothing set: no file', () => {
  expect(shelfFile({})).toBeUndefined()
})

test('star and pattern, always the same bytes', () => {
  expect(shelfFile({ starred: true, pattern: 'dots' })).toBe('{\n  "pattern": "dots",\n  "starred": true\n}\n')
  expect(shelfFile({ pattern: 'dots', starred: true })).toBe(shelfFile({ starred: true, pattern: 'dots' }))
  expect(shelfFile({ pattern: 'zigzag' })).toBe('{\n  "pattern": "zigzag"\n}\n')
})

test('read back, with fields and patterns from a newer version kept', () => {
  expect(parseShelf(shelfFile({ starred: true, pattern: 'stripes' }))).toEqual({ starred: true, pattern: 'stripes' })
  const newer = '{"pattern":"tartan","starred":true,"ribbon":"red"}'
  const shelf = parseShelf(newer)!
  expect(shelf).toEqual({ starred: true, pattern: 'tartan', extra: { ribbon: 'red' } })
  expect(shelfFile(shelf)).toBe('{\n  "pattern": "tartan",\n  "starred": true,\n  "ribbon": "red"\n}\n')
})

test('values that make no sense are dropped; files that are no object give null', () => {
  expect(parseShelf('{"starred":"yes","pattern":3}')).toEqual({})
  expect(parseShelf('{"starred":false,"pattern":"  "}')).toEqual({})
  expect(parseShelf('[]')).toBeNull()
  expect(parseShelf('kaputt')).toBeNull()
  expect(parseShelf(undefined)).toBeNull()
})
