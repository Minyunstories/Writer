import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useEffect, useState } from 'react'
import { beforeEach, expect, test } from 'vitest'
import { addRank } from '../storage/address'
import { createBook, getBook, resetDatabaseForTests } from '../storage/db'
import { createEntry, createFolder, listEntries, listFolders } from '../storage/wiki'
import type { Book, WikiEntry, WikiFolder } from '../types'
import { RanksPage } from './RanksPage'

beforeEach(async () => {
  await resetDatabaseForTests()
})

function Harness({ bookId }: { bookId: string }) {
  const [state, setState] = useState<{ book: Book; folders: WikiFolder[]; entries: WikiEntry[] }>()
  const load = useCallback(async () => {
    const [book, folders, entries] = await Promise.all([getBook(bookId), listFolders(bookId), listEntries(bookId)])
    setState({ book: book!, folders, entries })
  }, [bookId])
  useEffect(() => {
    void load()
  }, [load])
  return state ? <RanksPage book={state.book} folders={state.folders} entries={state.entries} onChanged={() => void load()} /> : null
}

const ranksOf = async (bookId: string) => (await getBook(bookId))!.address?.ranks ?? []

test('+ Rang adds a rank whose fields save on leaving the field', async () => {
  const user = userEvent.setup()
  const book = await createBook('B')
  render(<Harness bookId={book.id} />)
  await user.click(await screen.findByRole('button', { name: '+ Rang' }))
  const rank = await screen.findByRole('group', { name: 'Neuer Rang' })
  const name = within(rank).getByRole('textbox', { name: 'Name' })
  await waitFor(() => expect(name).toHaveFocus())
  await user.clear(name)
  await user.type(name, 'Duchess')
  await user.tab()
  await waitFor(async () => expect((await ranksOf(book.id))[0]?.name).toBe('Duchess'))
  const group = await screen.findByRole('group', { name: 'Duchess' })
  await user.type(within(group).getByRole('textbox', { name: 'Öffentlich / dienstlich' }), 'Your Grace · Lady {{Nachname}')
  await user.tab()
  await waitFor(async () => expect((await ranksOf(book.id))[0]?.public).toBe('Your Grace · Lady {Nachname}'))
  await user.type(within(screen.getByRole('group', { name: 'Duchess' })).getByRole('textbox', { name: 'Notiz' }), 'Bedienstete: My Lady')
  await user.tab()
  await waitFor(async () => expect((await ranksOf(book.id))[0]?.note).toBe('Bedienstete: My Lady'))
})

test('Anordnen moves ranks with the arrows', async () => {
  const user = userEvent.setup()
  const book = await createBook('B')
  await addRank(book.id, 'King')
  await addRank(book.id, 'Duchess')
  render(<Harness bookId={book.id} />)
  await user.click(await screen.findByRole('button', { name: 'Anordnen' }))
  await user.click(screen.getByRole('button', { name: 'Duchess nach oben' }))
  await waitFor(async () => expect((await ranksOf(book.id)).map((r) => r.name)).toEqual(['Duchess', 'King']))
  await user.click(screen.getByRole('button', { name: 'Fertig' }))
  expect(screen.queryByRole('button', { name: 'King nach oben' })).not.toBeInTheDocument()
})

test('Löschen asks first', async () => {
  const user = userEvent.setup()
  const book = await createBook('B')
  await addRank(book.id, 'King')
  render(<Harness bookId={book.id} />)
  await user.click(await screen.findByRole('button', { name: 'Rang „King“ löschen' }))
  await user.click(within(screen.getByRole('alertdialog', { name: 'Rang löschen?' })).getByRole('button', { name: 'Abbrechen' }))
  expect(await ranksOf(book.id)).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'Rang „King“ löschen' }))
  await user.click(within(screen.getByRole('alertdialog', { name: 'Rang löschen?' })).getByRole('button', { name: 'Löschen' }))
  await waitFor(async () => expect(await ranksOf(book.id)).toHaveLength(0))
})

test('the figure folder defaults to Characters and can be set to Alle Einträge', async () => {
  const user = userEvent.setup()
  const book = await createBook('B')
  const chars = await createFolder(book.id, 'Characters')
  await createFolder(book.id, 'Orte')
  render(<Harness bookId={book.id} />)
  const select = await screen.findByRole('combobox', { name: 'Figuren stehen im Ordner' })
  expect(select).toHaveValue(chars.id)
  expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Alle Einträge', 'Characters', 'Orte'])
  await user.selectOptions(select, 'Alle Einträge')
  await waitFor(async () => expect((await getBook(book.id))!.address?.folder).toBe('*'))
})

test('the placeholder hint is shown', async () => {
  const book = await createBook('B')
  render(<Harness bookId={book.id} />)
  expect(await screen.findByText('{Vorname} und {Nachname} werden mit den Namen der Figur gefüllt.')).toBeInTheDocument()
})

const importText = JSON.stringify({
  writer: 'address-import',
  version: 1,
  ranks: [
    { name: 'Knight', public: 'Sir {Vorname}' },
    { name: 'Duchess', public: 'Your Grace' },
  ],
  people: [
    { name: 'Mira', rank: 'Knight' },
    { name: 'Pascal', rank: 'Knight' },
  ],
  forms: [{ from: 'Mira', to: 'Lea', public: 'My Lady' }],
})

async function bookWithFigures() {
  const book = await createBook('B')
  const chars = await createFolder(book.id, 'Characters')
  await createEntry(book.id, 'Mira Hale', chars.id)
  await createEntry(book.id, 'Lea', chars.id)
  return book
}

test('Anreden einlesen: asks first, then replaces the address data and reports what it took over', async () => {
  const user = userEvent.setup()
  const book = await bookWithFigures()
  await addRank(book.id, 'Herzogin')
  render(<Harness bookId={book.id} />)
  await user.upload(await screen.findByLabelText('Anreden einlesen'), new File([importText], 'anreden.json', { type: 'application/json' }))
  const dialog = await screen.findByRole('alertdialog', { name: 'Anreden einlesen?' })
  expect(dialog).toHaveTextContent('Das ersetzt alle Ränge, Angaben zu Figuren und Abweichungen, die bisher unter „Anreden“ stehen.')
  await user.click(within(dialog).getByRole('button', { name: 'Einlesen' }))
  expect(await screen.findByText('Eingelesen: 2 Ränge, 1 Figur, 1 Abweichung. Nicht gefunden: Pascal.')).toHaveAttribute('role', 'status')
  expect((await ranksOf(book.id)).map((rank) => rank.name)).toEqual(['Knight', 'Duchess'])
  expect(await screen.findByRole('group', { name: 'Knight' })).toBeInTheDocument()
})

test('Anreden einlesen: cancelling the question changes nothing', async () => {
  const user = userEvent.setup()
  const book = await bookWithFigures()
  render(<Harness bookId={book.id} />)
  await user.upload(await screen.findByLabelText('Anreden einlesen'), new File([importText], 'anreden.json', { type: 'application/json' }))
  await user.click(within(await screen.findByRole('alertdialog', { name: 'Anreden einlesen?' })).getByRole('button', { name: 'Abbrechen' }))
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(await ranksOf(book.id)).toEqual([])
})

test('Anreden einlesen: a file Writer cannot read says so', async () => {
  const user = userEvent.setup()
  const book = await bookWithFigures()
  render(<Harness bookId={book.id} />)
  await user.upload(await screen.findByLabelText('Anreden einlesen'), new File(['{"writer":"other"}'], 'x.json', { type: 'application/json' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Diese Datei kann Writer nicht als Anreden einlesen.')
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
})
