import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { addComment, updateComment } from '../storage/comments'
import { createBook, createChapter, getChapter, resetDatabaseForTests, updateChapter } from '../storage/db'
import { CommentsPanel } from './CommentsPanel'

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('open comments by chapter; a click jumps to the words, even if they moved', async () => {
  const user = userEvent.setup()
  const book = await createBook('B')
  const a = await createChapter(book.id, 'Anfang', 'The storm came late.')
  const b = await createChapter(book.id, 'Ende', 'All quiet.')
  const first = await addComment(a.id, { from: 4, to: 9, quote: 'storm', text: 'Zu laut?' })
  const done = await addComment(b.id, { from: 0, to: 3, quote: 'All', text: 'Erledigt schon' })
  await updateComment(b.id, done.id, { done: true })
  await updateChapter(a.id, { content: 'Late, the storm came.' })
  const onOpen = vi.fn()
  render(<CommentsPanel bookId={book.id} onOpen={onOpen} onClose={() => {}} />)
  const panel = screen.getByRole('complementary', { name: 'Kommentare' })
  expect(await within(panel).findByRole('heading', { name: 'Anfang' })).toBeInTheDocument()
  expect(within(panel).queryByText('Erledigt schon')).not.toBeInTheDocument()
  await user.click(within(panel).getByRole('button', { name: /storm.*Zu laut\?/s }))
  expect(onOpen).toHaveBeenCalledWith(a.id, { from: 10, to: 15 })
  await user.click(within(panel).getByRole('button', { name: 'Erledigt' }))
  await waitFor(async () => expect((await getChapter(a.id))!.comments![0].done).toBe(true))
  await user.click(await within(panel).findByRole('button', { name: /Erledigt \(2\)/ }))
  expect(within(panel).getByText('Erledigt schon')).toBeInTheDocument()
  expect(first.id).toBeTruthy()
})
