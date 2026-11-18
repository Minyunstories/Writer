import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { saveForm } from '../storage/address'
import { db } from '../storage/connection'
import { createBook, createChapter, getBook, listChapters, resetDatabaseForTests } from '../storage/db'
import { setModule } from '../storage/modules'
import { createEntry, createFolder, listEntries } from '../storage/wiki'
import type { AddressForm, Book } from '../types'
import { FormEditor } from './FormEditor'

beforeEach(async () => {
  await resetDatabaseForTests()
})

async function setup(withForm: boolean) {
  const book = await createBook('B')
  await setModule(book.id, 'address', true)
  const k1 = await createChapter(book.id, 'Kapitel 1')
  const chars = await createFolder(book.id, 'Characters')
  const mira = await createEntry(book.id, 'Mira', chars.id)
  const lea = await createEntry(book.id, 'Lea', chars.id)
  if (withForm) await saveForm(book.id, { from: mira.id, to: lea.id, public: 'Mylady', changes: [] }, [k1.id])
  // What the editor saw when it opened.
  const opened = (await getBook(book.id))!
  const entries = await listEntries(book.id)
  const chapters = await listChapters(book.id)
  const byId = (id: string) => entries.find((entry) => entry.id === id)!
  return { book, opened, chapters, from: byId(mira.id), to: byId(lea.id), mira, lea }
}

/** Another device's change arriving through a sync while the editor is open. */
async function arrives(bookId: string, forms: (current: AddressForm[]) => AddressForm[], deleted: string[] = []) {
  const stored = (await getBook(bookId))!
  const address = stored.address ?? { ranks: [], people: [], forms: [] }
  const next: Book = { ...stored, address: { ...address, forms: forms(address.forms), deleted: [...(address.deleted ?? []), ...deleted] } }
  await (await db()).put('books', next)
}

const formsOf = async (bookId: string) => (await getBook(bookId))!.address?.forms ?? []

test('Fertig without edits writes nothing, so a newer edit from the other device stays', async () => {
  const user = userEvent.setup()
  const { book, opened, chapters, from, to } = await setup(true)
  const onDone = vi.fn()
  render(<FormEditor book={opened} from={from} to={to} chapters={chapters} chapterId={null} onDone={onDone} />)
  await arrives(book.id, (forms) => forms.map((form) => ({ ...form, public: 'Lady Lea', updatedAt: form.updatedAt + 1000 })))
  await user.click(screen.getByRole('button', { name: 'Fertig' }))
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(false))
  expect((await formsOf(book.id)).map((form) => form.public)).toEqual(['Lady Lea'])
})

test('Fertig without edits does not delete a form that arrived while the editor was open', async () => {
  const user = userEvent.setup()
  const { book, opened, chapters, from, to } = await setup(false)
  render(<FormEditor book={opened} from={from} to={to} chapters={chapters} chapterId={null} onDone={() => {}} />)
  await arrives(book.id, () => [{ id: 'other', from: from.id, to: to.id, private: 'Lea', changes: [], createdAt: 5, updatedAt: 5 }])
  await user.click(screen.getByRole('button', { name: 'Fertig' }))
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect((await formsOf(book.id)).map((form) => form.id)).toEqual(['other'])
  expect((await getBook(book.id))!.address?.deleted ?? []).not.toContain('other')
})

test('Fertig without edits does not bring back a form deleted on the other device', async () => {
  const user = userEvent.setup()
  const { book, opened, chapters, from, to } = await setup(true)
  render(<FormEditor book={opened} from={from} to={to} chapters={chapters} chapterId={null} onDone={() => {}} />)
  const id = (await formsOf(book.id))[0].id
  await arrives(book.id, () => [], [id])
  await user.click(screen.getByRole('button', { name: 'Fertig' }))
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(await formsOf(book.id)).toEqual([])
})

test('a real edit is still saved', async () => {
  const user = userEvent.setup()
  const { book, opened, chapters, from, to } = await setup(true)
  const onDone = vi.fn()
  render(<FormEditor book={opened} from={from} to={to} chapters={chapters} chapterId={null} onDone={onDone} />)
  const editor = screen.getByRole('group', { name: 'Mira spricht Lea an' })
  await user.type(within(editor).getByRole('textbox', { name: 'Privat' }), 'Lea')
  await user.click(within(editor).getByRole('button', { name: 'Fertig' }))
  await waitFor(() => expect(onDone).toHaveBeenCalledWith(true))
  expect((await formsOf(book.id))[0]).toMatchObject({ public: 'Mylady', private: 'Lea' })
})
