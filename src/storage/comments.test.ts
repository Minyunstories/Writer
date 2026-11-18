import { beforeEach, expect, test } from 'vitest'
import { createBook, createChapter, getChapter, resetDatabaseForTests, updateChapter } from './db'
import { addComment, deleteComment, placeComments, resolveAnchor, updateComment } from './comments'

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('comments are added, changed, moved and deleted, and survive saving the text', async () => {
  const book = await createBook('B')
  const chapter = await createChapter(book.id, 'A', 'The storm came late.')
  const comment = await addComment(chapter.id, { from: 4, to: 9, quote: 'storm', text: ' Zu laut? ' })
  expect(comment).toMatchObject({ from: 4, to: 9, quote: 'storm', text: 'Zu laut?', done: false })
  await updateComment(chapter.id, comment.id, { done: true })
  await updateChapter(chapter.id, { content: 'A storm came late.' })
  await placeComments(chapter.id, [{ id: comment.id, from: 2, to: 7, quote: 'storm' }])
  expect((await getChapter(chapter.id))!.comments).toEqual([expect.objectContaining({ from: 2, to: 7, done: true })])
  await deleteComment(chapter.id, comment.id)
  expect((await getChapter(chapter.id))!.comments).toBeUndefined()
})

test('a comment finds its words again when the text around it changed', () => {
  const comment = { from: 4, to: 9, quote: 'storm' }
  expect(resolveAnchor('The storm came.', comment)).toEqual({ from: 4, to: 9 })
  expect(resolveAnchor('Then, at night, the storm came.', comment)).toEqual({ from: 20, to: 25 })
  expect(resolveAnchor('A storm, a storm.', { from: 12, to: 17, quote: 'storm' })).toEqual({ from: 11, to: 16 })
  expect(resolveAnchor('Rain.', comment)).toEqual({ from: 4, to: 5 })
})
