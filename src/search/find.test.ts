import { expect, test } from 'vitest'
import { findMatches, replaceMatches } from './find'

test('finds text, optionally by case and as whole words', () => {
  const text = 'Mira saw Miranda. mira laughed.'
  expect(findMatches(text, 'mira', {}).map((m) => text.slice(m.from, m.to))).toEqual(['Mira', 'Mira', 'mira'])
  expect(findMatches(text, 'mira', { caseSensitive: true })).toEqual([{ from: 18, to: 22 }])
  expect(findMatches(text, 'Mira', { wholeWord: true }).map((m) => m.from)).toEqual([0, 18])
  expect(findMatches(text, '', {})).toEqual([])
  expect(findMatches('a.b a+b', 'a+b', {})).toEqual([{ from: 4, to: 7 }])
})

test('replaces all matches, keeping the rest of the text', () => {
  expect(replaceMatches('Mira saw Miranda. mira laughed.', 'mira', 'Lea', { wholeWord: true })).toEqual({ text: 'Lea saw Miranda. Lea laughed.', count: 2 })
  expect(replaceMatches('nothing', 'x', 'y', {})).toEqual({ text: 'nothing', count: 0 })
})
