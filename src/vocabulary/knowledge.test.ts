import { expect, test } from 'vitest'
import type { Book, BookVocabulary, VocabWord, WikiEntry } from '../types'
import { activeLearners, cleanCapture, findWord, normalize, searchWords, spellingNames, wordState } from './knowledge'

const word = (id: string, text: string, translation: string, note?: string, known: VocabWord['known'] = []): VocabWord => ({
  id,
  word: text,
  translation,
  ...(note ? { note } : {}),
  known,
  createdAt: 1,
  updatedAt: 1,
})
const entry = (id: string, name: string, aliases: string[] = []): WikiEntry => ({
  id,
  bookId: 'b',
  folderId: null,
  name,
  aliases,
  properties: [],
  imageIds: [],
  body: '',
  autoLink: true,
  createdAt: 1,
  updatedAt: 1,
})

test('normalize ignores case, accents and spacing', () => {
  expect(normalize('  Éla   Vé ')).toBe('ela ve')
  expect(findWord([word('w1', 'Váeri', 'water')], 'vaeri')?.id).toBe('w1')
  expect(findWord([word('w1', 'vaeri', 'water')], 'vaer')).toBeUndefined()
})

test('cleanCapture strips what a selection drags along', () => {
  expect(cleanCapture(' vaeri, ')).toBe('vaeri')
  expect(cleanCapture('„tol vashen“')).toBe('tol vashen')
  expect(cleanCapture("il'mar-a")).toBe("il'mar-a")
  expect(cleanCapture('(vaeri!)\n')).toBe('vaeri')
  expect(cleanCapture(' , ')).toBe('')
  expect(cleanCapture('*vaeri*')).toBe('vaeri')
  expect(cleanCapture('**ilmar**,')).toBe('ilmar')
  expect(cleanCapture('==tol\n  vashen==')).toBe('tol vashen')
  expect(cleanCapture('_cira_')).toBe('cira')
})

test('search finds by word, translation and note, alphabetically', () => {
  const words = [word('w1', 'Bor', 'stone'), word('w2', 'cira', 'bread', 'Gruß'), word('w3', 'ábel', 'water')]
  expect(searchWords(words, '').map((w) => w.word)).toEqual(['ábel', 'Bor', 'cira'])
  expect(searchWords(words, 'WATER').map((w) => w.word)).toEqual(['ábel'])
  expect(searchWords(words, 'abel').map((w) => w.word)).toEqual(['ábel'])
  expect(searchWords(words, 'gruss')).toEqual([])
  expect(searchWords(words, 'gruß').map((w) => w.word)).toEqual(['cira'])
})

test('wordState', () => {
  const order = ['c1', 'c2', 'c3']
  const known = word('w1', 'vaeri', 'water', undefined, [
    { entryId: 'mira', chapterId: 'c2' },
    { entryId: 'tom', chapterId: 'gone' },
  ])
  expect(wordState(known, 'mira', order, 'c2')).toEqual({ kind: 'known' })
  expect(wordState(known, 'mira', order, 'c3')).toEqual({ kind: 'known' })
  expect(wordState(known, 'mira', order, 'c1')).toEqual({ kind: 'later', chapterId: 'c2' })
  expect(wordState(known, 'lea', order, 'c3')).toEqual({ kind: 'unknown' })
  expect(wordState(known, 'tom', order, 'c3')).toEqual({ kind: 'chapterGone' })
})

test('activeLearners skips removed learners and deleted entries', () => {
  const vocabulary: BookVocabulary = {
    learners: [
      { entryId: 'tom', updatedAt: 1 },
      { entryId: 'lea', removed: true, updatedAt: 1 },
      { entryId: 'ghost', updatedAt: 1 },
      { entryId: 'mira', updatedAt: 1 },
    ],
    words: [],
  }
  const entries = [entry('mira', 'Mira'), entry('lea', 'Lea'), entry('tom', 'Tom')]
  expect(activeLearners(vocabulary, entries).map((e) => e.id)).toEqual(['mira', 'tom'])
  expect(activeLearners(undefined, entries)).toEqual([])
})

test('vocabulary counts for the spell check only while the module is on', () => {
  const entries = [entry('mira', 'Mira', ['Miri'])]
  const vocabulary: BookVocabulary = { learners: [], words: [word('w1', 'vaeri', 'water'), word('w2', 'tol vashen', 'good morning')] }
  const book: Book = { id: 'b', title: 'B', font: 'literata', chapterOrder: [], createdAt: 1, updatedAt: 1, vocabulary }
  expect(spellingNames(book, entries)).toEqual(['Mira', 'Miri'])
  expect(spellingNames({ ...book, modules: { vocabulary: true } }, entries)).toEqual(['Mira', 'Miri', 'vaeri', 'tol vashen'])
})
