import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test } from 'vitest'
import { createBook, createChapter, listBooks, resetDatabaseForTests, updateChapter } from '../storage/db'
import { Dashboard } from './Dashboard'

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('empty state offers to create a book', async () => {
  renderDashboard()
  expect(await screen.findByText('Noch keine Bücher')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Neues Buch' })).toBeInTheDocument()
})

test('creating a book shows its card with 0 Wörter', async () => {
  const user = userEvent.setup()
  renderDashboard()
  await user.click(await screen.findByRole('button', { name: 'Neues Buch' }))
  await user.type(screen.getByLabelText('Titel'), 'Sturmlied')
  await user.click(screen.getByRole('button', { name: 'Anlegen' }))
  const card = await screen.findByRole('article', { name: 'Sturmlied' })
  expect(within(card).getByText('0 Wörter')).toBeInTheDocument()
  expect(within(card).getByRole('link', { name: 'Sturmlied' })).toHaveAttribute(
    'href',
    `/book/${(await listBooks())[0].id}`,
  )
})

test('shows the word count across chapters', async () => {
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Eins')
  await updateChapter(chapter.id, { content: 'eins zwei drei' })
  renderDashboard()
  const card = await screen.findByRole('article', { name: 'Sturmlied' })
  expect(within(card).getByText('3 Wörter')).toBeInTheDocument()
})

test('deleting asks first and then removes the card', async () => {
  const user = userEvent.setup()
  await createBook('Sturmlied')
  renderDashboard()
  const card = await screen.findByRole('article', { name: 'Sturmlied' })
  await user.click(within(card).getByRole('button', { name: 'Löschen' }))
  expect(screen.getByText('Buch „Sturmlied" wirklich löschen?')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Endgültig löschen' }))
  await waitFor(() => expect(screen.queryByRole('article', { name: 'Sturmlied' })).not.toBeInTheDocument())
  expect(await listBooks()).toEqual([])
})

test('renaming changes the card title', async () => {
  const user = userEvent.setup()
  await createBook('Sturmlied')
  renderDashboard()
  const card = await screen.findByRole('article', { name: 'Sturmlied' })
  await user.click(within(card).getByRole('button', { name: 'Umbenennen' }))
  const input = screen.getByLabelText('Titel')
  await user.clear(input)
  await user.type(input, 'Windlied')
  await user.click(screen.getByRole('button', { name: 'Speichern' }))
  expect(await screen.findByRole('article', { name: 'Windlied' })).toBeInTheDocument()
})
