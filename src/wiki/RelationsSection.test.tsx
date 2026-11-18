import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { CHANGED_EVENT } from '../storage/connection'
import { createBook, getBook, resetDatabaseForTests } from '../storage/db'
import { addRelation, addRelationType } from '../storage/relations'
import type { Book, WikiEntry } from '../types'
import { RelationsSection } from './RelationsSection'

beforeEach(async () => {
  await resetDatabaseForTests()
})

const entry = (id: string, name: string): WikiEntry => ({ id, bookId: 'x', name, aliases: [], folderId: null, autoLink: true, properties: [], body: '', imageIds: [], createdAt: 0, updatedAt: 0 }) as WikiEntry
const entries = [entry('mira', 'Mira'), entry('lea', 'Lea'), entry('tom', 'Tom')]

function Live({ bookId, entryId, onOpenEntry }: { bookId: string; entryId: string; onOpenEntry: (id: string) => void }) {
  const [book, setBook] = useState<Book | null>(null)
  useEffect(() => {
    const load = () => void getBook(bookId).then((loaded) => setBook(loaded ?? null))
    load()
    window.addEventListener(CHANGED_EVENT, load)
    return () => window.removeEventListener(CHANGED_EVENT, load)
  }, [bookId])
  return book ? <RelationsSection book={book} entryId={entryId} entries={entries} onOpenEntry={onOpenEntry} /> : null
}

test('relationships are listed by name from this side; a click opens the other entry', async () => {
  const user = userEvent.setup()
  const book = await createBook('B')
  const teacher = await addRelationType(book.id, 'Lehrer von', 'Schüler von')
  await addRelation(book.id, { from: 'mira', to: 'lea', typeId: teacher.id, note: 'seit dem Brand' })
  const onOpenEntry = vi.fn()
  render(<Live bookId={book.id} entryId="lea" onOpenEntry={onOpenEntry} />)
  const section = await screen.findByRole('region', { name: 'Beziehungen' })
  expect(within(section).getByText('Schüler von')).toBeInTheDocument()
  expect(within(section).getByText('seit dem Brand')).toBeInTheDocument()
  await user.click(within(section).getByRole('button', { name: 'Mira' }))
  expect(onOpenEntry).toHaveBeenCalledWith('mira')
  await user.click(within(section).getByRole('button', { name: 'Beziehung zu Mira löschen' }))
  await waitFor(async () => expect((await getBook(book.id))!.relations!.relations).toEqual([]))
})

test('a relationship is added with an existing kind from either side, or with a new kind', async () => {
  const user = userEvent.setup()
  const book = await createBook('B')
  await addRelationType(book.id, 'Lehrer von', 'Schüler von')
  render(<Live bookId={book.id} entryId="lea" onOpenEntry={() => {}} />)
  const section = await screen.findByRole('region', { name: 'Beziehungen' })
  await user.click(within(section).getByRole('button', { name: '+ Beziehung' }))
  await user.selectOptions(within(section).getByLabelText('Art'), 'Schüler von')
  await user.selectOptions(within(section).getByLabelText('Mit'), 'Mira')
  await user.click(within(section).getByRole('button', { name: 'Hinzufügen' }))
  await waitFor(async () => expect((await getBook(book.id))!.relations!.relations).toEqual([expect.objectContaining({ from: 'mira', to: 'lea' })]))

  await user.click(within(section).getByRole('button', { name: '+ Beziehung' }))
  await user.selectOptions(within(section).getByLabelText('Art'), 'Neue Art …')
  await user.type(within(section).getByLabelText('Name der neuen Art'), 'Mentor von')
  await user.type(within(section).getByLabelText('Gegenstück'), 'Schützling von')
  await user.selectOptions(within(section).getByLabelText('Mit'), 'Tom')
  await user.click(within(section).getByRole('button', { name: 'Hinzufügen' }))
  await waitFor(async () => {
    const stored = (await getBook(book.id))!.relations!
    expect(stored.types.map((t) => [t.forward, t.backward])).toContainEqual(['Mentor von', 'Schützling von'])
    expect(stored.relations).toContainEqual(expect.objectContaining({ from: 'lea', to: 'tom' }))
  })
  expect(await within(section).findByText('Mentor von')).toBeInTheDocument()
})

test('kinds can be renamed and deleted in their list', async () => {
  const user = userEvent.setup()
  const book = await createBook('B')
  await addRelationType(book.id, 'Lehrer von', 'Schüler von')
  render(<Live bookId={book.id} entryId="lea" onOpenEntry={() => {}} />)
  const section = await screen.findByRole('region', { name: 'Beziehungen' })
  await user.click(within(section).getByRole('button', { name: 'Arten verwalten' }))
  const name = within(section).getByLabelText('Name von „Lehrer von“')
  await user.clear(name)
  await user.type(name, 'Meisterin von{Enter}')
  await waitFor(async () => expect((await getBook(book.id))!.relations!.types[0].forward).toBe('Meisterin von'))
  await user.click(within(section).getByRole('button', { name: 'Art „Meisterin von“ löschen' }))
  await waitFor(async () => expect((await getBook(book.id))!.relations!.types).toEqual([]))
})
