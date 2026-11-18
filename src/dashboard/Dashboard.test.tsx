import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test } from 'vitest'
import { COVERS, HIGHLIGHTS } from '../lib/bookStyle'
import { createBook, createChapter, getBook, listBooks, resetDatabaseForTests, updateChapter } from '../storage/db'
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
  expect(within(card).getByText('0 Kapitel')).toBeInTheDocument()
  expect(within(card).getByText(/^Zuletzt heute, \d\d:\d\d$/)).toBeInTheDocument()
  const cover = within(card).getByRole('link', { name: 'Sturmlied' })
  expect(cover).toHaveAttribute('href', `/book/${(await listBooks())[0].id}`)
  expect(cover.style.getPropertyValue('--cover')).toBe(COVERS[0].color)

  // The next book gets the next colour.
  await user.click(screen.getByRole('button', { name: 'Neues Buch' }))
  await user.type(screen.getByLabelText('Titel'), 'Windlied')
  await user.click(screen.getByRole('button', { name: 'Anlegen' }))
  const second = await screen.findByRole('article', { name: 'Windlied' })
  expect(within(second).getByRole('link', { name: 'Windlied' }).style.getPropertyValue('--cover')).toBe(COVERS[1].color)
})

test('the shelf ends with a card for a new book', async () => {
  const user = userEvent.setup()
  await createBook('Sturmlied')
  renderDashboard()
  await screen.findByRole('article', { name: 'Sturmlied' })
  await user.click(screen.getByRole('button', { name: 'Neues Buch (im Regal)' }))
  expect(screen.getByLabelText('Titel')).toBeInTheDocument()
})

test('the book menu sets cover and highlight colour', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  renderDashboard()
  const card = await screen.findByRole('article', { name: 'Sturmlied' })
  await user.click(within(card).getByRole('button', { name: 'Buchmenü für Sturmlied' }))
  const menu = screen.getByRole('dialog', { name: 'Buchmenü für Sturmlied' })
  await user.click(within(menu).getByRole('button', { name: 'Einband Nachtblau' }))
  await waitFor(async () => expect((await getBook(book.id))!.cover).toBe('#283650'))
  await waitFor(() => expect(within(card).getByRole('link', { name: 'Sturmlied' }).style.getPropertyValue('--cover')).toBe('#283650'))
  const reopened = screen.getByRole('dialog', { name: 'Buchmenü für Sturmlied' })
  await waitFor(() => expect(within(reopened).getByRole('button', { name: 'Einband Nachtblau' })).toHaveAttribute('aria-pressed', 'true'))
  await user.click(within(reopened).getByRole('button', { name: 'Markierung Salbei' }))
  await waitFor(async () => expect((await getBook(book.id))!.highlight).toBe(HIGHLIGHTS[3].color))
  await waitFor(() => expect(within(reopened).getByRole('button', { name: 'Markierung Salbei' })).toHaveAttribute('aria-pressed', 'true'))
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Buchmenü für Sturmlied' })).not.toBeInTheDocument()
})

test('shows the word count across chapters', async () => {
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Eins')
  await updateChapter(chapter.id, { content: 'eins zwei drei' })
  renderDashboard()
  const card = await screen.findByRole('article', { name: 'Sturmlied' })
  expect(within(card).getByText('3 Wörter')).toBeInTheDocument()
  expect(within(card).getByText('1 Kapitel')).toBeInTheDocument()
})

test('deleting asks first and then removes the card', async () => {
  const user = userEvent.setup()
  await createBook('Sturmlied')
  renderDashboard()
  const card = await screen.findByRole('article', { name: 'Sturmlied' })
  await user.click(within(card).getByRole('button', { name: 'Buchmenü für Sturmlied' }))
  await user.click(screen.getByRole('button', { name: 'Löschen' }))
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
  await user.click(within(card).getByRole('button', { name: 'Buchmenü für Sturmlied' }))
  await user.click(screen.getByRole('button', { name: 'Umbenennen' }))
  const input = screen.getByLabelText('Titel')
  await user.clear(input)
  await user.type(input, 'Windlied')
  await user.click(screen.getByRole('button', { name: 'Speichern' }))
  expect(await screen.findByRole('article', { name: 'Windlied' })).toBeInTheDocument()
})

test('the book menu sets the English variant of the check', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  renderDashboard()
  const card = await screen.findByRole('article', { name: 'Sturmlied' })
  await user.click(within(card).getByRole('button', { name: 'Buchmenü für Sturmlied' }))
  const select = screen.getByLabelText('Englisch der Prüfung')
  expect(select).toHaveValue('american')
  await user.selectOptions(select, 'british')
  await waitFor(async () => expect((await getBook(book.id))!.spelling?.dialect).toBe('british'))
})

test('the book menu switches modules on and off', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  renderDashboard()
  await user.click(await screen.findByRole('button', { name: 'Buchmenü für Sturmlied' }))
  const menu = screen.getByRole('dialog', { name: 'Buchmenü für Sturmlied' })
  expect(within(menu).getByText('Module')).toBeInTheDocument()
  const box = within(menu).getByRole('checkbox', { name: 'Vokabelheft' })
  expect(box).not.toBeChecked()
  await user.click(box)
  await waitFor(async () => expect((await getBook(book.id))!.modules).toEqual({ vocabulary: true }))
  await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Buchmenü für Sturmlied' })).getByRole('checkbox', { name: 'Vokabelheft' })).toBeChecked())
  await user.click(within(screen.getByRole('dialog', { name: 'Buchmenü für Sturmlied' })).getByRole('checkbox', { name: 'Vokabelheft' }))
  await waitFor(async () => expect((await getBook(book.id))!.modules).toBeUndefined())
})
