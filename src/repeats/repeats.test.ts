import { expect, test } from 'vitest'
import { findRepeats } from './repeats'

const marks = (text: string, names: string[] = []) => findRepeats(text, names).map((repeat) => text.slice(repeat.from, repeat.to))

test('a word twice within 50 words is marked both times', () => {
  expect(marks('The door creaked. Mira opened the door.')).toEqual(['door', 'door'])
})

test('more than 50 words apart is not marked', () => {
  expect(marks(`lamp ${'the '.repeat(50)}lamp`)).toEqual([])
  expect(marks(`lamp ${'the '.repeat(49)}lamp`)).toEqual(['lamp', 'lamp'])
})

test('case and simple word forms count as the same word', () => {
  expect(marks('She walked home. Walking was easy. He walks.')).toEqual(['walked', 'Walking', 'walks'])
  expect(marks('Two boxes. One box.')).toEqual(['boxes', 'box'])
})

test('-er, -est and -ly are not stripped', () => {
  expect(marks('A letter. Let it go.')).toEqual([])
})

test('filler words, said, short words and numbers are never marked', () => {
  expect(marks('She said it was there. She said it was 42 and 42.')).toEqual([])
})

test('names and aliases are never marked, also with possessive and in parts', () => {
  expect(marks("Elena Voss smiled. Elena’s hand, Voss's ring. Cal laughed, Cal left.", ['Elena Voss', 'Cal'])).toEqual([])
})

test('markdown around a word does not matter', () => {
  expect(marks('## Walked\n\n**walked** and ==walked==')).toEqual(['Walked', 'walked', 'walked'])
})

test('contractions are skipped', () => {
  expect(marks("don't stop, don't")).toEqual([])
})

test('occurrences linked in a chain share a group; far apart ones do not', () => {
  const text = `door ${'the '.repeat(40)}door ${'the '.repeat(40)}door ${'the '.repeat(200)}door ${'the '.repeat(3)}door`
  const groups = findRepeats(text, []).map((repeat) => repeat.group)
  expect(groups).toHaveLength(5)
  expect(new Set(groups.slice(0, 3)).size).toBe(1)
  expect(groups[3]).toBe(groups[4])
  expect(groups[3]).not.toBe(groups[0])
})

test('a long chapter is fast', () => {
  const vocab = ['lantern', 'river', 'stone', 'window', 'garden', 'shadow', 'candle', 'walked']
  const text = Array.from({ length: 20000 }, (_, i) => vocab[i % vocab.length]).join(' ')
  const start = performance.now()
  findRepeats(text, [])
  expect(performance.now() - start).toBeLessThan(300)
})

test('a short stem that would double its last letter is not a form of the -ed/-ing word', () => {
  expect(marks('She stared up at the stars.')).toEqual([])
  expect(marks('She hoped for a hop.')).toEqual([])
  expect(marks('He scared the scar.')).toEqual([])
  // Real forms still group: doubled letters, w/x/y endings, longer stems, the stem with e.
  expect(marks('He stopped. Stop.')).toEqual(['stopped', 'Stop'])
  expect(marks('She played. Play on.')).toEqual(['played', 'Play'])
  expect(marks('He fixed it. Fix it.')).toEqual(['fixed', 'Fix'])
  expect(marks('It opened. Open it.')).toEqual(['opened', 'Open'])
  expect(marks('She hoped. Hope stays.')).toEqual(['hoped', 'Hope'])
})

test('more filler words are never marked', () => {
  expect(
    marks('I told myself, then myself again. Down we went, down and down, like this, like that, because, because, while, while, though, though, until, until, toward, towards, across, across, behind, behind, along, along, within, within.'),
  ).toEqual([])
})
