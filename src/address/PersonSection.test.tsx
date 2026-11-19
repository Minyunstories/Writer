import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useEffect, useState } from 'react'
import { beforeEach, expect, test } from 'vitest'
import { addRank, saveForm, setPerson, updateRank } from '../storage/address'
import { createBook, createChapter, getBook, listChapters, resetDatabaseForTests } from '../storage/db'
import { setModule } from '../storage/modules'
import { createEntry, createFolder, listEntries, listFolders } from '../storage/wiki'
import type { Book, Chapter, WikiEntry, WikiFolder } from '../types'
import { PersonSection } from './PersonSection'

beforeEach(async () => {
  await resetDatabaseForTests()
})

function Harness({ bookId, entryId, chapterId = null }: { bookId: string; entryId: string; chapterId?: string | null }) {
  const [state, setState] = useState<{ book: Book; entries: WikiEntry[]; folders: WikiFolder[]; chapters: Chapter[] }>()
  const load = useCallback(async () => {
    const [book, entries, folders, chapters] = await Promise.all([getBook(bookId), listEntries(bookId), listFolders(bookId), listChapters(bookId)])
    setState({ book: book!, entries, folders, chapters })
  }, [bookId])
  useEffect(() => {
    void load()
  }, [load])
  if (!state) return null
  const entry = state.entries.find((item) => item.id === entryId)!
  return <PersonSection book={state.book} entry={entry} entries={state.entries} folders={state.folders} chapters={state.chapters} chapterId={chapterId} onChanged={() => void load()} />
}

async function setup() {
  const book = await createBook('Sturmlied')
  await setModule(book.id, 'address', true)
  const k1 = await createChapter(book.id, 'Kapitel 1')
  const k2 = await createChapter(book.id, 'Kapitel 2')
  const chars = await createFolder(book.id, 'Characters')
  const places = await createFolder(book.id, 'Orte')
  const lea = await createEntry(book.id, 'Lea Brandt', chars.id)
  const mira = await createEntry(book.id, 'Mira', chars.id)
  const tom = await createEntry(book.id, 'Tom', chars.id)
  const castle = await createEntry(book.id, 'Burg', places.id)
  const order = [k1.id, k2.id]
  const duchess = await addRank(book.id, 'Duchess')
  await updateRank(book.id, duchess.id, { public: 'Your Grace · Lady {Nachname}' })
  const lady = await addRank(book.id, 'Lady')
  await updateRank(book.id, lady.id, { public: 'Lady {Nachname}' })
  const king = await addRank(book.id, 'King')
  return { book, k1, k2, lea, mira, tom, castle, order, duchess, lady, king }
}

const addressOf = async (bookId: string) => (await getBook(bookId))!.address!

test('rank, names and a change from a chapter on are stored', async () => {
  const user = userEvent.setup()
  const { book, lea, duchess, king, k2 } = await setup()
  render(<Harness bookId={book.id} entryId={lea.id} />)
  const section = await screen.findByRole('region', { name: 'Anreden' })
  expect(within(section).getByRole('textbox', { name: 'Vorname' })).toHaveAttribute('placeholder', 'Lea')
  expect(within(section).getByRole('textbox', { name: 'Nachname' })).toHaveAttribute('placeholder', 'Brandt')
  await user.selectOptions(within(section).getByRole('combobox', { name: 'Rang' }), 'Duchess')
  await waitFor(async () => expect((await addressOf(book.id)).people[0]?.rankId).toBe(duchess.id))
  await user.type(within(section).getByRole('textbox', { name: 'Nachname' }), 'Brandtle')
  await user.tab()
  await waitFor(async () => expect((await addressOf(book.id)).people[0]?.last).toBe('Brandtle'))
  await user.click(within(section).getByRole('button', { name: '+ Änderung ab Kapitel' }))
  const adder = within(section).getByRole('group', { name: 'Neue Änderung' })
  await user.selectOptions(within(adder).getByRole('combobox', { name: 'Ab Kapitel' }), 'Kapitel 2')
  await user.selectOptions(within(adder).getByRole('combobox', { name: 'Rang' }), 'King')
  await user.click(within(adder).getByRole('button', { name: 'Hinzufügen' }))
  await waitFor(async () => expect((await addressOf(book.id)).people[0]?.changes).toEqual([expect.objectContaining({ chapterId: k2.id, rankId: king.id })]))
  expect(await within(section).findByRole('group', { name: 'Änderung ab Kapitel 2' })).toBeInTheDocument()
})

test('both lists show every other involved figure with rule or exception', async () => {
  const { book, lea, mira, order, duchess, lady } = await setup()
  await setPerson(book.id, lea.id, { rankId: duchess.id }, order)
  await setPerson(book.id, mira.id, { rankId: lady.id }, order)
  await saveForm(book.id, { from: mira.id, to: lea.id, private: 'Lea', changes: [] }, order)
  render(<Harness bookId={book.id} entryId={lea.id} />)
  const towards = await screen.findByRole('list', { name: 'Wie andere Lea Brandt ansprechen' })
  const rows = within(towards).getAllByRole('listitem')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toHaveTextContent('Mira')
  expect(rows[0]).toHaveTextContent('Your Grace · Lady Brandt')
  expect(rows[0]).toHaveTextContent('Lea')
  expect(rows[0]).toHaveTextContent('Abweichung')
  const own = screen.getByRole('list', { name: 'Wie Lea Brandt andere anspricht' })
  expect(within(own).getAllByRole('listitem')[0]).toHaveTextContent('Lady Mira')
  expect(within(own).getAllByRole('listitem')[0]).toHaveTextContent('Regel: Lady')
})

test('the pencil on a rule row creates an exception', async () => {
  const user = userEvent.setup()
  const { book, lea, mira, order, lady } = await setup()
  await setPerson(book.id, mira.id, { rankId: lady.id }, order)
  render(<Harness bookId={book.id} entryId={lea.id} />)
  await user.click(await screen.findByRole('button', { name: 'Lea Brandt spricht Mira an – bearbeiten' }))
  const editor = screen.getByRole('group', { name: 'Lea Brandt spricht Mira an' })
  expect(within(editor).getByText('Regel: Lady – Lady Mira')).toBeInTheDocument()
  await user.type(within(editor).getByRole('textbox', { name: 'Privat' }), 'Mira')
  await user.click(within(editor).getByRole('button', { name: 'Fertig' }))
  await waitFor(async () => expect((await addressOf(book.id)).forms).toEqual([expect.objectContaining({ from: lea.id, to: mira.id, private: 'Mira' })]))
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Lea Brandt spricht Mira an' })).not.toBeInTheDocument())
})

test('a change with noch offen shows as später', async () => {
  const user = userEvent.setup()
  const { book, lea, mira, order, duchess, k2 } = await setup()
  await setPerson(book.id, lea.id, { rankId: duchess.id }, order)
  await saveForm(book.id, { from: mira.id, to: lea.id, changes: [{ private: 'Brandt', note: 'sobald sie es anbietet' }] }, order)
  render(<Harness bookId={book.id} entryId={lea.id} />)
  const towards = await screen.findByRole('list', { name: 'Wie andere Lea Brandt ansprechen' })
  expect(towards).toHaveTextContent('später: Your Grace · Lady Brandt · Brandt (sobald sie es anbietet)')
  expect(towards).toHaveTextContent('sobald sie es anbietet')
  await user.click(screen.getByRole('button', { name: 'Mira spricht Lea Brandt an – bearbeiten' }))
  const editor = screen.getByRole('group', { name: 'Mira spricht Lea Brandt an' })
  const change = within(editor).getByRole('group', { name: 'Wechsel 1' })
  expect(within(change).getByRole('combobox', { name: 'Ab Kapitel' })).toHaveValue('')
  await user.click(within(editor).getByRole('button', { name: '+ Wechsel' }))
  expect(within(within(editor).getByRole('group', { name: 'Wechsel 2' })).getByRole('combobox', { name: 'Ab Kapitel' })).toHaveValue('')
  void k2
})

test('Abweichung löschen asks and brings back the rule', async () => {
  const user = userEvent.setup()
  const { book, lea, mira, order, duchess, lady } = await setup()
  await setPerson(book.id, lea.id, { rankId: duchess.id }, order)
  await setPerson(book.id, mira.id, { rankId: lady.id }, order)
  await saveForm(book.id, { from: mira.id, to: lea.id, private: 'Lea', changes: [] }, order)
  render(<Harness bookId={book.id} entryId={lea.id} />)
  await user.click(await screen.findByRole('button', { name: 'Mira spricht Lea Brandt an – bearbeiten' }))
  await user.click(screen.getByRole('button', { name: 'Abweichung löschen' }))
  await user.click(within(screen.getByRole('alertdialog', { name: 'Abweichung löschen?' })).getByRole('button', { name: 'Löschen' }))
  await waitFor(async () => expect((await addressOf(book.id)).forms).toEqual([]))
  const towards = await screen.findByRole('list', { name: 'Wie andere Lea Brandt ansprechen' })
  await waitFor(() => expect(towards).toHaveTextContent('Regel: Duchess'))
})

test('entries outside the figure folder get no section', async () => {
  const { book, castle, lea } = await setup()
  const { rerender } = render(<Harness bookId={book.id} entryId={castle.id} />)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(screen.queryByRole('region', { name: 'Anreden' })).not.toBeInTheDocument()
  rerender(<Harness bookId={book.id} entryId={lea.id} />)
  expect(await screen.findByRole('region', { name: 'Anreden' })).toBeInTheDocument()
})
