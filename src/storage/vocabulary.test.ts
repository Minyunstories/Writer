import { beforeEach, expect, test } from 'vitest'
import { createBook, getBook, resetDatabaseForTests } from './db'
import { addWord, captureWord, deleteWord, setLearner, updateWord } from './vocabulary'

beforeEach(async () => {
  await resetDatabaseForTests()
})

const vocabularyOf = async (bookId: string) => (await getBook(bookId))!.vocabulary!

test('addWord trims, stamps and makes knowers learners', async () => {
  const book = await createBook('B')
  const word = await addWord(book.id, { word: '  vaeri ', translation: ' water ', note: '  ', known: [{ entryId: 'mira', chapterId: 'c2' }] })
  expect(word).toMatchObject({ word: 'vaeri', translation: 'water', known: [{ entryId: 'mira', chapterId: 'c2' }] })
  expect(word.note).toBeUndefined()
  expect(word.createdAt).toBeGreaterThan(0)
  expect(word.updatedAt).toBe(word.createdAt)
  const vocabulary = await vocabularyOf(book.id)
  expect(vocabulary.words).toEqual([word])
  expect(vocabulary.learners.map((l) => [l.entryId, l.removed])).toEqual([['mira', undefined]])
  await expect(addWord(book.id, { word: '   ' })).rejects.toThrow()
})

test('updateWord changes fields, stamps and revives a removed learner it names', async () => {
  const book = await createBook('B')
  const word = await addWord(book.id, { word: 'vaeri', translation: 'water' })
  await setLearner(book.id, 'lea', true)
  await setLearner(book.id, 'lea', false)
  await new Promise((resolve) => setTimeout(resolve, 2))
  await updateWord(book.id, word.id, { translation: 'fresh water', note: 'Norden', known: [{ entryId: 'lea', chapterId: 'c1' }] })
  const vocabulary = await vocabularyOf(book.id)
  expect(vocabulary.words[0]).toMatchObject({ translation: 'fresh water', note: 'Norden', known: [{ entryId: 'lea', chapterId: 'c1' }] })
  expect(vocabulary.words[0].updatedAt).toBeGreaterThan(word.updatedAt)
  expect(vocabulary.learners.find((l) => l.entryId === 'lea')?.removed).toBeUndefined()
  await updateWord(book.id, word.id, { note: '' })
  expect((await vocabularyOf(book.id)).words[0].note).toBeUndefined()
})

test('deleteWord remembers the id so a sync cannot bring it back', async () => {
  const book = await createBook('B')
  const word = await addWord(book.id, { word: 'vaeri' })
  await deleteWord(book.id, word.id)
  const vocabulary = await vocabularyOf(book.id)
  expect(vocabulary.words).toEqual([])
  expect(vocabulary.deleted).toEqual([word.id])
})

test('removing a learner keeps what they know', async () => {
  const book = await createBook('B')
  await addWord(book.id, { word: 'vaeri', known: [{ entryId: 'mira', chapterId: 'c2' }] })
  await setLearner(book.id, 'mira', false)
  const vocabulary = await vocabularyOf(book.id)
  expect(vocabulary.learners).toEqual([expect.objectContaining({ entryId: 'mira', removed: true })])
  expect(vocabulary.words[0].known).toEqual([{ entryId: 'mira', chapterId: 'c2' }])
})

test('captureWord: new word', async () => {
  const book = await createBook('B')
  const result = await captureWord(book.id, ' vaeri, ', { entryId: 'mira', chapterId: 'c2' })
  expect(result).toMatchObject({ created: true, word: { word: 'vaeri', translation: '', known: [{ entryId: 'mira', chapterId: 'c2' }] } })
  expect((await vocabularyOf(book.id)).words).toHaveLength(1)
})

test('captureWord: existing word is opened, not doubled', async () => {
  const book = await createBook('B')
  const first = await captureWord(book.id, 'vaeri', { entryId: 'mira', chapterId: 'c2' })
  const again = await captureWord(book.id, 'Váeri', { entryId: 'lea', chapterId: 'c3' })
  expect(again).toMatchObject({ created: false, word: { id: first!.word.id } })
  let words = (await vocabularyOf(book.id)).words
  expect(words).toHaveLength(1)
  expect(words[0].known).toEqual([
    { entryId: 'mira', chapterId: 'c2' },
    { entryId: 'lea', chapterId: 'c3' },
  ])
  await captureWord(book.id, 'vaeri', { entryId: 'mira', chapterId: 'c5' })
  await captureWord(book.id, 'vaeri')
  words = (await vocabularyOf(book.id)).words
  expect(words[0].known.find((k) => k.entryId === 'mira')?.chapterId).toBe('c2')
  expect(words).toHaveLength(1)
})

test('captureWord: empty selection stores nothing', async () => {
  const book = await createBook('B')
  expect(await captureWord(book.id, ' , ')).toBeNull()
  expect((await getBook(book.id))!.vocabulary).toBeUndefined()
})

test('editing a word does not bring back a learner who was taken off', async () => {
  const book = await createBook('B')
  const word = await addWord(book.id, { word: 'vaeri', translation: 'water', known: [{ entryId: 'mira', chapterId: 'c1' }, { entryId: 'ghost', chapterId: 'c1' }] })
  await setLearner(book.id, 'mira', false)
  await setLearner(book.id, 'ghost', false)
  await updateWord(book.id, word.id, { translation: 'fresh water', known: [{ entryId: 'mira', chapterId: 'c1' }, { entryId: 'ghost', chapterId: 'c1' }] })
  const learners = (await vocabularyOf(book.id)).learners
  expect(learners.find((l) => l.entryId === 'mira')?.removed).toBe(true)
  expect(learners.find((l) => l.entryId === 'ghost')?.removed).toBe(true)
})

test('saving an unchanged word writes nothing, so it cannot win over an edit from the other device', async () => {
  const book = await createBook('B')
  const word = await addWord(book.id, { word: 'vaeri', translation: 'water', note: 'Norden', known: [{ entryId: 'mira', chapterId: 'c1' }] })
  await new Promise((resolve) => setTimeout(resolve, 2))
  await updateWord(book.id, word.id, { word: ' vaeri ', translation: 'water', note: 'Norden', known: [{ entryId: 'mira', chapterId: 'c1' }] })
  expect((await vocabularyOf(book.id)).words[0].updatedAt).toBe(word.updatedAt)
})
