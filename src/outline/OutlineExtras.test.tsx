import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { createBook, createChapter, getBook, getChapter, listChapters, resetDatabaseForTests, setChapterDate, updateChapter } from '../storage/db'
import { createEntry, createFolder, listEntries, listFolders } from '../storage/wiki'
import type { Book } from '../types'
import { Outline } from './Outline'
import { tagColor } from './Tags'

async function setup() {
  const created = await createBook('Sturmlied')
  const a = await createChapter(created.id, 'Anfang', 'Pascal ging zum Hafen. Mira wartete. Pascal kam.')
  const b = await createChapter(created.id, 'Sturm', 'Nichts passiert.')
  const c = await createChapter(created.id, 'Ende', 'Notiz am Rand.')
  await updateChapter(b.id, { tags: ['PoV: Mira'] })
  await updateChapter(c.id, { tags: ['PoV: Pascal', 'Rückblick'] })
  const chars = await createFolder(created.id, 'Characters')
  const royals = await createFolder(created.id, 'Royals', chars.id)
  const locs = await createFolder(created.id, 'Locations')
  const pascal = await createEntry(created.id, 'Pascal', royals.id)
  await createEntry(created.id, 'Mira', chars.id)
  await createEntry(created.id, 'Hafen', locs.id)
  await createEntry(created.id, 'Notiz')
  const onOpenEntry = vi.fn()
  const load = async () => ({
    book: (await getBook(created.id)) as Book,
    chapters: await listChapters(created.id),
    entries: await listEntries(created.id),
    folders: await listFolders(created.id),
  })
  let state = await load()
  const ui = () => (
    <MemoryRouter>
      <Outline
        book={state.book}
        chapters={state.chapters}
        entries={state.entries}
        folders={state.folders}
        onChanged={refresh}
        onError={() => {}}
        onCreateChapter={() => {}}
        onOpenEntry={onOpenEntry}
      />
    </MemoryRouter>
  )
  async function refresh() {
    state = await load()
    // A save may finish after the test ended and the view was removed.
    if (utils.container.isConnected) utils.rerender(ui())
  }
  const utils = render(ui())
  await screen.findByLabelText('Notizen zu Ende')
  return { a, b, c, pascal, onOpenEntry, user: userEvent.setup() }
}

const card = (title: string) => screen.getByRole('link', { name: title }).closest('li')!
const titles = () => screen.getAllByRole('link').map((link) => link.textContent)

beforeEach(async () => {
  await resetDatabaseForTests()
  localStorage.clear()
})

test('a tag is added with Enter and removed with its ×', async () => {
  const { a, user } = await setup()
  await user.type(within(card('Anfang')).getByLabelText('Tag hinzufügen'), 'PoV: Pascal{Enter}')
  await waitFor(async () => expect((await getChapter(a.id))!.tags).toEqual(['PoV: Pascal']))
  expect(await within(card('Anfang')).findByRole('button', { name: 'Nach Tag „PoV: Pascal“ filtern' })).toBeInTheDocument()
  await user.click(within(card('Anfang')).getByRole('button', { name: 'Tag „PoV: Pascal“ entfernen' }))
  await waitFor(async () => expect((await getChapter(a.id))!.tags).toBeUndefined())
})

test('tags already used in the book are suggested', async () => {
  await setup()
  const input = within(card('Anfang')).getByLabelText('Tag hinzufügen')
  const list = document.getElementById(input.getAttribute('list')!)!
  expect([...list.querySelectorAll('option')].map((option) => option.value)).toEqual(['PoV: Mira', 'PoV: Pascal', 'Rückblick'])
})

test('clicking a tag filters the outline until the filter is removed', async () => {
  const { user } = await setup()
  await user.click(within(card('Ende')).getByRole('button', { name: 'Nach Tag „PoV: Pascal“ filtern' }))
  expect(titles()).toEqual(['Ende'])
  expect(screen.getByText('Filter: PoV: Pascal')).toBeInTheDocument()
  expect(within(card('Ende')).getByRole('button', { name: 'Ende nach oben' })).toBeDisabled()
  expect(within(card('Ende')).getByTitle('Ziehen zum Umsortieren')).toHaveAttribute('draggable', 'false')
  await user.click(screen.getByRole('button', { name: 'Filter aufheben' }))
  expect(titles()).toEqual(['Anfang', 'Sturm', 'Ende'])
})

test('each card lists the wiki entries in its text, grouped by top-level folder', async () => {
  const { pascal, onOpenEntry, user } = await setup()
  const groups = within(card('Anfang')).getAllByRole('group')
  expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Characters', 'Locations'])
  expect(within(groups[0]).getAllByRole('button').map((b) => b.textContent)).toEqual(['Pascal', 'Mira'])
  expect(within(groups[1]).getAllByRole('button').map((b) => b.textContent)).toEqual(['Hafen'])
  expect(within(card('Ende')).getAllByRole('group').map((g) => g.getAttribute('aria-label'))).toEqual(['Weitere'])
  expect(within(card('Sturm')).queryAllByRole('group')).toEqual([])
  await user.click(within(groups[0]).getByRole('button', { name: 'Pascal' }))
  expect(onOpenEntry).toHaveBeenCalledWith(pascal.id)
})

test('tag colours are stable and come from a fixed set', () => {
  expect(tagColor('PoV: Pascal')).toBe(tagColor('PoV: Pascal'))
  const all = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map(tagColor))
  expect(all.size).toBeLessThanOrEqual(8)
  expect(all.size).toBeGreaterThan(2)
})

test('two quick tag changes both survive', async () => {
  const { c, user } = await setup()
  const input = within(card('Ende')).getByLabelText('Tag hinzufügen')
  await user.type(input, 'Nacht{Enter}')
  await user.click(within(card('Ende')).getByRole('button', { name: 'Tag „Rückblick“ entfernen' }))
  await waitFor(async () => expect((await getChapter(c.id))!.tags).toEqual(['PoV: Pascal', 'Nacht']))
})

test('each chapter has a free-text date on the timeline that is saved while typing', async () => {
  const { a, user } = await setup()
  const date = screen.getByLabelText('Datum für Anfang')
  expect(date).toHaveValue('')
  expect(card('Anfang').querySelector('.outline-dot')).not.toHaveClass('filled')
  await user.type(date, '  12. März 1204')
  await waitFor(async () => expect((await getChapter(a.id))!.date).toBe('12. März 1204'), { timeout: 2000 })
  await waitFor(() => expect(card('Anfang').querySelector('.outline-dot')).toHaveClass('filled'))
  expect(date).toHaveAttribute('maxLength', '40')
})

test('a date stored elsewhere shows up', async () => {
  const { c } = await setup()
  await setChapterDate(c.id, 'drei Tage später')
  window.dispatchEvent(new Event('focus'))
  await waitFor(() => expect(screen.getByLabelText('Datum für Ende')).toHaveValue('drei Tage später'))
})
