import { expect, test } from 'vitest'
import type { BookVocabulary } from '../types'
import { mergeVocabulary, parseVocabulary, vocabularyFile } from './vocabularyFile'

const sorted: BookVocabulary = {
  learners: [
    { entryId: 'lea', removed: true, updatedAt: 7 },
    { entryId: 'mira', updatedAt: 3 },
  ],
  words: [
    {
      id: 'w1',
      word: 'vaeri',
      translation: 'water',
      note: 'nur im Norden',
      known: [
        { entryId: 'lea', chapterId: 'c3' },
        { entryId: 'mira', chapterId: 'c2' },
      ],
      createdAt: 1,
      updatedAt: 4,
    },
    { id: 'w2', word: 'tol vashen', translation: 'good morning', known: [], createdAt: 2, updatedAt: 2 },
    { id: 'w3', word: 'ilmar', translation: 'the old road', known: [], createdAt: 2, updatedAt: 5 },
  ],
  deleted: ['a-old', 'z-old'],
}

test('round trip is lossless and stable', () => {
  const shuffled: BookVocabulary = {
    learners: [sorted.learners[1], sorted.learners[0]],
    words: [sorted.words[2], { ...sorted.words[0], known: [sorted.words[0].known[1], sorted.words[0].known[0]] }, sorted.words[1]],
    deleted: ['z-old', 'a-old'],
  }
  const file = vocabularyFile(shuffled)!
  expect(parseVocabulary(file)).toEqual(sorted)
  expect(vocabularyFile(parseVocabulary(file)!)).toBe(file)
  expect(file.endsWith('}\n')).toBe(true)
  expect(JSON.parse(file).words[0]).toEqual({
    id: 'w1',
    word: 'vaeri',
    translation: 'water',
    note: 'nur im Norden',
    known: [
      { entry: 'lea', chapter: 'c3' },
      { entry: 'mira', chapter: 'c2' },
    ],
    createdAt: 1,
    updatedAt: 4,
  })
  expect(JSON.parse(file).learners[0]).toEqual({ entry: 'lea', removed: true, updatedAt: 7 })
})

test('nothing to write means no file', () => {
  expect(vocabularyFile({ learners: [], words: [] })).toBeUndefined()
  expect(vocabularyFile({ learners: [], words: [], deleted: ['x'] })).toBeDefined()
})

test('unknown fields survive', () => {
  const file = JSON.stringify({
    language: 'x',
    learners: [{ entry: 'mira', updatedAt: 1, color: 'z' }],
    words: [{ id: 'w1', word: 'vaeri', translation: 'water', gender: 'f', known: [{ entry: 'mira', chapter: 'c1', since: 'y' }], createdAt: 1, updatedAt: 1 }],
  })
  const written = JSON.parse(vocabularyFile(parseVocabulary(file)!)!)
  expect(written.language).toBe('x')
  expect(written.learners[0].color).toBe('z')
  expect(written.words[0].gender).toBe('f')
  expect(written.words[0].known[0].since).toBe('y')
})

test('an unknown field never overrides a known one', () => {
  const parsed = parseVocabulary('{"words":[{"id":"w1","word":"a","translation":"b","known":[],"createdAt":1,"updatedAt":1}]}')!
  parsed.words[0].extra = { word: 'evil' }
  expect(JSON.parse(vocabularyFile(parsed)!).words[0].word).toBe('a')
})

test('broken data is tolerated', () => {
  expect(parseVocabulary('nope')).toBeNull()
  expect(parseVocabulary('[]')).toBeNull()
  expect(parseVocabulary(undefined)).toBeNull()
  expect(parseVocabulary('{"words":[{"word":"a"}]}')).toEqual({ learners: [], words: [] })
  const loose = parseVocabulary('{"words":[{"id":"w1","word":"a","known":[{"entry":"mira"},{"entry":"lea","chapter":"c1"}]}]}')!
  expect(loose.words[0]).toEqual({ id: 'w1', word: 'a', translation: '', known: [{ entryId: 'lea', chapterId: 'c1' }], createdAt: 0, updatedAt: 0 })
})

test('merge: newer word wins, deletions stay, learners by updatedAt', () => {
  const word = (id: string, translation: string, updatedAt: number) => ({ id, word: id, translation, known: [], createdAt: 1, updatedAt })
  const mine: BookVocabulary = {
    learners: [{ entryId: 'mira', updatedAt: 4 }, { entryId: 'tom', updatedAt: 2 }],
    words: [word('w1', 'mine', 5), word('w2', 'kept?', 1), word('w3', 'only mine', 1)],
  }
  const theirs: BookVocabulary = {
    learners: [{ entryId: 'mira', removed: true, updatedAt: 9 }, { entryId: 'tom', removed: true, updatedAt: 2 }],
    words: [word('w1', 'theirs', 3)],
    deleted: ['w2'],
  }
  const merged = mergeVocabulary(mine, theirs)
  expect(merged.words.map((w) => [w.id, w.translation])).toEqual([
    ['w1', 'mine'],
    ['w3', 'only mine'],
  ])
  expect(merged.deleted).toEqual(['w2'])
  expect(merged.learners).toEqual([
    { entryId: 'mira', removed: true, updatedAt: 9 },
    { entryId: 'tom', updatedAt: 2 },
  ])
})

test('same word added on both devices: both rows stay', () => {
  const add = (id: string) => ({ id, word: 'vaeri', translation: 'water', known: [], createdAt: 1, updatedAt: 1 })
  const merged = mergeVocabulary({ learners: [], words: [add('w-a')] }, { learners: [], words: [add('w-b')] })
  expect(merged.words.map((w) => w.id).sort()).toEqual(['w-a', 'w-b'])
})
