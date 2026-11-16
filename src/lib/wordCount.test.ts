import { expect, test } from 'vitest'
import { countWords } from './wordCount'

test('counts words and ignores markdown markers', () => {
  expect(countWords('')).toBe(0)
  expect(countWords('   \n ')).toBe(0)
  expect(countWords('# Titel\n\nEin **kurzer** Satz.')).toBe(4)
})

test('handles umlauts, apostrophes and dashes', () => {
  expect(countWords("**Pascal's** größter — Tag")).toBe(3)
})

test('unspaced dashes and ellipses separate words', () => {
  expect(countWords('He paused—then left')).toBe(4)
  expect(countWords('Wait…what')).toBe(2)
  expect(countWords('pages 3–4')).toBe(3)
  expect(countWords('well-known')).toBe(1)
})
