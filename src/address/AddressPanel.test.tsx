import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useEffect, useState } from 'react'
import { beforeEach, expect, test } from 'vitest'
import { addRank, saveForm, setPerson, updateRank } from '../storage/address'
import { createBook, createChapter, getBook, listChapters, resetDatabaseForTests } from '../storage/db'
import { setModule } from '../storage/modules'
import { createEntry, createFolder, listEntries, listFolders } from '../storage/wiki'
import type { Book, Chapter, WikiEntry, WikiFolder } from '../types'
import { AddressPanel } from './AddressPanel'

beforeEach(async () => {
  await resetDatabaseForTests()
})

function Harness({ bookId, chapterId, mentioned, initialSpeaker = '' }: { bookId: string; chapterId: string; mentioned: string[]; initialSpeaker?: string }) {
  const [state, setState] = useState<{ book: Book; entries: WikiEntry[]; folders: WikiFolder[]; chapters: Chapter[] }>()
  const [speaker, setSpeaker] = useState(initialSpeaker)
  const load = useCallback(async () => {
    const [book, entries, folders, chapters] = await Promise.all([getBook(bookId), listEntries(bookId), listFolders(bookId), listChapters(bookId)])
    setState({ book: book!, entries, folders, chapters })
  }, [bookId])
  useEffect(() => {
    void load()
  }, [load])
  if (!state) return null
  return <AddressPanel {...state} chapterId={chapterId} mentioned={mentioned} speaker={speaker} onSpeaker={setSpeaker} onChanged={() => void load()} />
}

async function setup() {
  const book = await createBook('Sturmlied')
  await setModule(book.id, 'address', true)
  const k1 = await createChapter(book.id, 'Kapitel 1')
  const k2 = await createChapter(book.id, 'Kapitel 2')
  const k3 = await createChapter(book.id, 'Kapitel 3')
  const order = [k1.id, k2.id, k3.id]
  const chars = await createFolder(book.id, 'Characters')
  const places = await createFolder(book.id, 'Orte')
  const mira = await createEntry(book.id, 'Mira', chars.id)
  const lea = await createEntry(book.id, 'Lea Brandt', chars.id)
  const tom = await createEntry(book.id, 'Tom', chars.id)
  const pascal = await createEntry(book.id, 'Pascal', chars.id)
  const castle = await createEntry(book.id, 'Burg', places.id)
  const rank = async (name: string, publicText: string, note?: string) => {
    const created = await addRank(book.id, name)
    await updateRank(book.id, created.id, { public: publicText, ...(note ? { note } : {}) })
    return created
  }
  const duchess = await rank('Duchess', 'Your Grace · Lady {Nachname}', 'Bedienstete: My Lady')
  const lady = await rank('Lady', 'Lady {Nachname}')
  const knight = await rank('Knight', 'Sir {Vorname}')
  const king = await rank('King', 'Your Majesty')
  await setPerson(book.id, lea.id, { rankId: duchess.id }, order)
  await setPerson(book.id, mira.id, { rankId: lady.id }, order)
  await setPerson(book.id, tom.id, { rankId: knight.id }, order)
  await setPerson(book.id, pascal.id, { rankId: king.id }, order)
  const mentioned = [mira.id, lea.id, tom.id, castle.id]
  return { book, k1, k2, k3, order, mira, lea, tom, pascal, castle, mentioned }
}

test('Wer spricht lists figures in the chapter first', async () => {
  const { book, k2, mentioned } = await setup()
  render(<Harness bookId={book.id} chapterId={k2.id} mentioned={mentioned} />)
  const select = await screen.findByRole('combobox', { name: 'Wer spricht' })
  expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Figur wählen …', 'Mira', 'Lea Brandt', 'Tom', 'Pascal'])
  expect(screen.getByText('Wähle, wer spricht.')).toBeInTheDocument()
})

test('rows show the address that holds in this chapter, with source and notes', async () => {
  const { book, k2, mentioned, mira } = await setup()
  render(<Harness bookId={book.id} chapterId={k2.id} mentioned={mentioned} initialSpeaker={mira.id} />)
  const list = await screen.findByRole('list', { name: 'Anreden im Kapitel' })
  const rows = within(list).getAllByRole('listitem')
  expect(rows).toHaveLength(2)
  expect(rows[0]).toHaveTextContent('Lea Brandt')
  expect(rows[0]).toHaveTextContent('Your Grace · Lady Brandt')
  expect(rows[0]).toHaveTextContent('Regel: Duchess')
  expect(rows[0]).toHaveTextContent('Bedienstete: My Lady')
  expect(rows[0]).not.toHaveTextContent('Regel: Duchess: Bedienstete')
  expect(rows[1]).toHaveTextContent('Sir Tom')
})

test('opening a row shows the other direction and the history', async () => {
  const user = userEvent.setup()
  const { book, k2, k3, order, mentioned, mira, lea } = await setup()
  await setPerson(book.id, lea.id, { changes: [{ chapterId: k2.id, last: 'Hale' }] }, order)
  await saveForm(book.id, { from: mira.id, to: lea.id, private: 'Lea', changes: [{ chapterId: k3.id, label: 'Phase 2', private: 'Leelee' }] }, order)
  render(<Harness bookId={book.id} chapterId={k2.id} mentioned={mentioned} initialSpeaker={mira.id} />)
  const toggle = await screen.findByRole('button', { name: 'Lea Brandt' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  const row = toggle.closest('li')!
  expect(row).toHaveTextContent('Your Grace · Lady Hale')
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  expect(row).toHaveTextContent('Lea Brandt spricht Mira an: Lady Mira')
  expect(row).toHaveTextContent('bis Kapitel 1: Your Grace · Lady Brandt · Lea')
  expect(row).toHaveTextContent('ab Kapitel 3 (Phase 2): Your Grace · Lady Hale · Leelee')
})

test('the pencil edits the direction and the row updates', async () => {
  const user = userEvent.setup()
  const { book, k2, mentioned, mira } = await setup()
  render(<Harness bookId={book.id} chapterId={k2.id} mentioned={mentioned} initialSpeaker={mira.id} />)
  await user.click(await screen.findByRole('button', { name: 'Mira spricht Tom an – bearbeiten' }))
  const editor = screen.getByRole('group', { name: 'Mira spricht Tom an' })
  await user.type(within(editor).getByRole('textbox', { name: 'Öffentlich / dienstlich' }), 'Tom')
  await user.click(within(editor).getByRole('button', { name: 'Fertig' }))
  const row = (await screen.findByRole('button', { name: 'Tom' })).closest('li')!
  await waitFor(() => expect(row).toHaveTextContent('Abweichung'))
  expect(row.querySelector('.address-row-public')).toHaveTextContent('Tom')
})

test('Andere Figur looks up someone outside the chapter', async () => {
  const user = userEvent.setup()
  const { book, k2, mentioned, mira } = await setup()
  render(<Harness bookId={book.id} chapterId={k2.id} mentioned={mentioned} initialSpeaker={mira.id} />)
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Andere Figur' }), 'Pascal')
  const row = (await screen.findByRole('button', { name: 'Pascal' })).closest('li')!
  expect(row).toHaveTextContent('Your Majesty')
})

test('a remembered speaker who is gone asks Wähle, wer spricht.', async () => {
  const { book, k2, mentioned } = await setup()
  render(<Harness bookId={book.id} chapterId={k2.id} mentioned={mentioned} initialSpeaker="gone" />)
  expect(await screen.findByText('Wähle, wer spricht.')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Wer spricht' })).toHaveValue('')
})

test('nobody with a rank in the chapter shows the hint', async () => {
  const { book, k1, mira } = await setup()
  render(<Harness bookId={book.id} chapterId={k1.id} mentioned={[mira.id]} initialSpeaker={mira.id} />)
  expect(await screen.findByText('In diesem Kapitel kommt niemand mit Rang vor. Ränge legst du im Wiki unter „Anreden“ fest.')).toBeInTheDocument()
})

test('the columns say which form is public and which private', async () => {
  const { book, k2, mentioned, mira } = await setup()
  render(<Harness bookId={book.id} chapterId={k2.id} mentioned={mentioned} initialSpeaker={mira.id} />)
  await screen.findByRole('list', { name: 'Anreden im Kapitel' })
  expect(screen.getByText('Öffentlich / dienstlich', { selector: '.address-head span' })).toBeInTheDocument()
  expect(screen.getByText('Privat', { selector: '.address-head span' })).toBeInTheDocument()
  const row = (await screen.findByRole('button', { name: 'Tom' })).closest('li')!
  expect(row.querySelector('.address-row-private .address-cap')).toHaveTextContent('privat')
})

test('later changes show the whole form with their name, and a deleted chapter says so', async () => {
  const { book, k2, order, mentioned, mira, tom } = await setup()
  await saveForm(
    book.id,
    {
      from: mira.id,
      to: tom.id,
      changes: [
        { label: 'Phase 2', private: 'Tommy', note: 'sobald er es anbietet' },
        { chapterId: 'gone', private: 'T' },
      ],
    },
    order,
  )
  render(<Harness bookId={book.id} chapterId={k2.id} mentioned={mentioned} initialSpeaker={mira.id} />)
  const row = (await screen.findByRole('button', { name: 'Tom' })).closest('li')!
  expect(row).toHaveTextContent('später (Phase 2): Sir Tom · Tommy (sobald er es anbietet)')
  expect(row).toHaveTextContent('später – Kapitel gelöscht: Sir Tom · T')
})

test('a remembered speaker without rank who is not in this chapter is still shown as chosen', async () => {
  const { book, k2, mentioned } = await setup()
  const chars = (await listFolders(book.id)).find((folder) => folder.name === 'Characters')!
  const anna = await createEntry(book.id, 'Anna', chars.id)
  render(<Harness bookId={book.id} chapterId={k2.id} mentioned={mentioned} initialSpeaker={anna.id} />)
  await screen.findByRole('list', { name: 'Anreden im Kapitel' })
  expect(screen.getByRole('combobox', { name: 'Wer spricht' })).toHaveValue(anna.id)
})
