import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { SYNCED_EVENT, db, resetDatabaseForTests } from '../storage/connection'
import { createBook, createChapter } from '../storage/db'
import { listTrash, trashChapter, trashEntry } from '../storage/trash'
import { createEntry } from '../storage/wiki'
import { TrashDialog } from './TrashDialog'

beforeEach(async () => {
  await resetDatabaseForTests()
})

async function setup() {
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Zwei', 'Mira stood.')
  const entry = await createEntry(book.id, 'Pascal')
  const first = await trashChapter(chapter.id)
  const second = await trashEntry(entry.id)
  // Unambiguous order: the entry was deleted a little later.
  await (await db()).put('trash', { ...second!, deletedAt: first!.deletedAt + 1000 })
  const onRestored = vi.fn()
  const onClose = vi.fn()
  render(<TrashDialog bookId={book.id} onRestored={onRestored} onClose={onClose} />)
  const dialog = screen.getByRole('dialog', { name: 'Papierkorb' })
  await within(dialog).findByText('Zwei')
  return { book, chapter, entry, dialog, onRestored, onClose, user: userEvent.setup() }
}

test('lists items newest first with kind, title, date and days left', async () => {
  const { dialog } = await setup()
  expect(within(dialog).getByText('Gelöschtes bleibt 30 Tage, danach ist es endgültig weg.')).toBeInTheDocument()
  const rows = within(dialog).getAllByRole('listitem')
  expect(rows.map((row) => within(row).getByText(/^(Kapitel|Wiki)$/).textContent)).toEqual(['Wiki', 'Kapitel'])
  expect(rows[0]).toHaveTextContent('Pascal')
  expect(rows[1]).toHaveTextContent(/gelöscht am \d\d\.\d\d\. · noch 30 Tage/)
})

test('restoring calls onRestored with what came back', async () => {
  const { chapter, user, onRestored } = await setup()
  await user.click(screen.getByRole('button', { name: '„Zwei“ wiederherstellen' }))
  await waitFor(() => expect(onRestored).toHaveBeenCalledWith({ kind: 'chapter', targetId: chapter.id }))
})

test('deleting for good asks first', async () => {
  const { book, user, dialog } = await setup()
  await user.click(screen.getByRole('button', { name: '„Zwei“ endgültig löschen' }))
  const row = within(dialog).getByText('Zwei').closest('li')!
  expect(within(row).getByText('Endgültig löschen?')).toBeInTheDocument()
  await user.click(within(row).getByRole('button', { name: 'Abbrechen' }))
  expect(await listTrash(book.id)).toHaveLength(2)

  await user.click(screen.getByRole('button', { name: '„Zwei“ endgültig löschen' }))
  await user.click(within(dialog).getByRole('button', { name: 'Ja, löschen' }))
  await waitFor(() => expect(within(dialog).queryByText('Zwei')).toBeNull())
  expect((await listTrash(book.id)).map((item) => item.title)).toEqual(['Pascal'])
})

test('an empty trash says so', async () => {
  const { user, dialog } = await setup()
  for (const name of ['„Zwei“ endgültig löschen', '„Pascal“ endgültig löschen']) {
    await user.click(screen.getByRole('button', { name }))
    await user.click(within(dialog).getByRole('button', { name: 'Ja, löschen' }))
  }
  expect(await within(dialog).findByText('Der Papierkorb ist leer.')).toBeInTheDocument()
})

test('an unknown kind has no restore button', async () => {
  const book = await createBook('Sturmlied')
  await (await db()).put('trash', { id: 'x', bookId: book.id, kind: 'folder', title: 'Orte', deletedAt: Date.now(), file: '{}\n' })
  render(<TrashDialog bookId={book.id} onRestored={() => {}} onClose={() => {}} />)
  await screen.findByText('Orte')
  expect(screen.queryByRole('button', { name: '„Orte“ wiederherstellen' })).toBeNull()
  expect(screen.getByRole('button', { name: '„Orte“ endgültig löschen' })).toBeInTheDocument()
})

test('Esc and ✕ close', async () => {
  const { onClose, user } = await setup()
  fireEvent.keyDown(document.body, { key: 'Escape' })
  await user.click(screen.getByRole('button', { name: 'Schließen' }))
  expect(onClose).toHaveBeenCalledTimes(2)
})

test('after a sync run the list is current: what the other device restored is gone', async () => {
  const { book, dialog } = await setup()
  const [zwei] = (await listTrash(book.id)).filter((item) => item.title === 'Zwei')
  // As if the other device had restored it and the sync run had brought that over.
  await (await db()).delete('trash', zwei.id)
  window.dispatchEvent(new Event(SYNCED_EVENT))
  await waitFor(() => expect(within(dialog).queryByText('Zwei')).toBeNull())
  expect(within(dialog).getByText('Pascal')).toBeInTheDocument()
})

test('a restore that finds nothing any more says so and shows the current list', async () => {
  const { book, user, dialog, onRestored } = await setup()
  const [zwei] = (await listTrash(book.id)).filter((item) => item.title === 'Zwei')
  await (await db()).delete('trash', zwei.id)
  await user.click(screen.getByRole('button', { name: '„Zwei“ wiederherstellen' }))
  expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
  await waitFor(() => expect(within(dialog).queryByText('Zwei')).toBeNull())
  expect(onRestored).not.toHaveBeenCalled()
})

test('Esc while asking “Endgültig löschen?” only takes the question back', async () => {
  const { user, dialog, onClose } = await setup()
  await user.click(screen.getByRole('button', { name: '„Zwei“ endgültig löschen' }))
  expect(within(dialog).getByText('Endgültig löschen?')).toBeInTheDocument()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(within(dialog).queryByText('Endgültig löschen?')).toBeNull()
  expect(onClose).not.toHaveBeenCalled()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('when a sync run takes away the item being asked about, the question goes with it and Esc closes the window', async () => {
  const { book, user, dialog, onClose } = await setup()
  await user.click(screen.getByRole('button', { name: '„Zwei“ endgültig löschen' }))
  const [zwei] = (await listTrash(book.id)).filter((item) => item.title === 'Zwei')
  await (await db()).delete('trash', zwei.id)
  window.dispatchEvent(new Event(SYNCED_EVENT))
  await waitFor(() => expect(within(dialog).queryByText('Zwei')).toBeNull())
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
})
