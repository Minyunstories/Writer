import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { createBook, createChapter, getChapter, resetDatabaseForTests } from '../storage/db'
import { StatusPicker } from './StatusPicker'

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('the status is picked, stored and can be cleared', async () => {
  const user = userEvent.setup()
  const book = await createBook('B')
  const chapter = await createChapter(book.id, 'Anfang')
  const onChanged = vi.fn()
  render(<StatusPicker chapter={chapter} onChanged={onChanged} />)
  const picker = screen.getByRole('combobox', { name: 'Status von „Anfang“' })
  expect(picker).toHaveValue('')
  await user.selectOptions(picker, 'Überarbeitung')
  await waitFor(async () => expect((await getChapter(chapter.id))!.status).toBe('revision'))
  expect(onChanged).toHaveBeenCalled()
  expect(picker.closest('.status-picker')).toHaveClass('status-revision')
  await user.selectOptions(picker, 'Ohne Status')
  await waitFor(async () => expect((await getChapter(chapter.id))!.status).toBeUndefined())
})
