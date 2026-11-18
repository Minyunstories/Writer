import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useEffect, useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { createBook, createChapter, getBook, listChapters, resetDatabaseForTests } from '../storage/db'
import { addWord, setLearner } from '../storage/vocabulary'
import { createEntry, listEntries } from '../storage/wiki'
import type { Book, Chapter, WikiEntry } from '../types'
import { VocabularyPanel } from './VocabularyPanel'

beforeEach(async () => {
  await resetDatabaseForTests()
})

function Harness({ bookId, chapterId, mentioned = [], initialViewer = '', editing }: { bookId: string; chapterId: string; mentioned?: string[]; initialViewer?: string; editing?: { wordId: string | null; key: number } }) {
  const [book, setBook] = useState<Book>()
  const [entries, setEntries] = useState<WikiEntry[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [viewer, setViewer] = useState(initialViewer)
  const load = useCallback(async () => {
    const [b, e, c] = await Promise.all([getBook(bookId), listEntries(bookId), listChapters(bookId)])
    setEntries(e)
    setChapters(c)
    setBook(b)
  }, [bookId])
  useEffect(() => {
    void load()
  }, [load])
  if (!book) return null
  return (
    <>
      <output data-testid="viewer">{viewer}</output>
      <VocabularyPanel book={book} entries={entries} chapters={chapters} chapterId={chapterId} mentioned={mentioned} viewer={viewer} onViewer={setViewer} editing={editing} onChanged={() => void load()} />
    </>
  )
}

async function setup() {
  const book = await createBook('Sturmlied')
  const k1 = await createChapter(book.id, 'Kapitel 1')
  const k2 = await createChapter(book.id, 'Kapitel 2')
  const k3 = await createChapter(book.id, 'Kapitel 3')
  const mira = await createEntry(book.id, 'Mira')
  const lea = await createEntry(book.id, 'Lea')
  const tom = await createEntry(book.id, 'Tom')
  return { book, k1, k2, k3, mira, lea, tom }
}

const rows = () => within(screen.getByRole('list', { name: 'Wörter' })).getAllByRole('listitem')
const words = async (bookId: string) => (await getBook(bookId))!.vocabulary?.words ?? []

test('lists words alphabetically and searches', async () => {
  const user = userEvent.setup()
  const { book, k1 } = await setup()
  await addWord(book.id, { word: 'Bor', translation: 'stone' })
  await addWord(book.id, { word: 'cira', translation: 'bread', note: 'Gruß' })
  await addWord(book.id, { word: 'ábel', translation: 'water' })
  render(<Harness bookId={book.id} chapterId={k1.id} />)
  await waitFor(() => expect(rows()).toHaveLength(3))
  expect(rows().map((row) => row.textContent)).toEqual([expect.stringContaining('ábel'), expect.stringContaining('Bor'), expect.stringContaining('cira')])
  await user.type(screen.getByRole('searchbox', { name: 'Suchen' }), 'WATER')
  expect(rows()).toHaveLength(1)
  expect(rows()[0]).toHaveTextContent('ábel')
  await user.clear(screen.getByRole('searchbox', { name: 'Suchen' }))
  await user.type(screen.getByRole('searchbox', { name: 'Suchen' }), 'gruß')
  expect(rows()[0]).toHaveTextContent('cira')
  await user.type(screen.getByRole('searchbox', { name: 'Suchen' }), 'xyz')
  expect(screen.getByText('Nichts gefunden.')).toBeInTheDocument()
})

test('Aus Sicht von greys what the learner does not know here', async () => {
  const { book, k1, k2, k3, mira } = await setup()
  await addWord(book.id, { word: 'ábel', translation: 'water', known: [{ entryId: mira.id, chapterId: k1.id }] })
  await addWord(book.id, { word: 'Bor', translation: 'stone', known: [{ entryId: mira.id, chapterId: k3.id }] })
  await addWord(book.id, { word: 'cira', translation: 'bread' })
  await addWord(book.id, { word: 'dura', translation: 'fire', known: [{ entryId: mira.id, chapterId: 'gone' }] })
  render(<Harness bookId={book.id} chapterId={k2.id} initialViewer={mira.id} />)
  await waitFor(() => expect(rows()).toHaveLength(4))
  expect(screen.getByRole('combobox', { name: 'Aus Sicht von' })).toHaveValue(mira.id)
  const [abel, bor, cira, dura] = rows()
  expect(abel).not.toHaveTextContent(/ab Kapitel|noch nicht gelernt|Kapitel gelöscht/)
  expect(bor).toHaveTextContent('ab Kapitel 3')
  expect(cira).toHaveTextContent('noch nicht gelernt')
  expect(dura).toHaveTextContent('Kapitel gelöscht')
})

test('a learner is added from the wiki and taken off again', async () => {
  const user = userEvent.setup()
  const { book, k1, lea, tom } = await setup()
  render(<Harness bookId={book.id} chapterId={k1.id} mentioned={[tom.id]} />)
  const view = await screen.findByRole('combobox', { name: 'Aus Sicht von' })
  expect(view).toHaveValue('')
  expect(within(view).getAllByRole('option').map((o) => o.textContent)).toEqual(['Alle Wörter', '+ Lernende Figur …'])
  await user.selectOptions(view, '+ Lernende Figur …')
  const picker = screen.getByRole('combobox', { name: 'Lernende Figur' })
  expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['Figur wählen …', 'Tom', 'Lea', 'Mira'])
  await user.selectOptions(picker, 'Lea')
  await waitFor(() => expect(screen.getByTestId('viewer')).toHaveTextContent(lea.id))
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Aus Sicht von' })).toHaveValue(lea.id))
  expect((await getBook(book.id))!.vocabulary!.learners).toEqual([expect.objectContaining({ entryId: lea.id })])
  await user.click(screen.getByRole('button', { name: 'Nicht mehr lernend' }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Aus Sicht von' })).toHaveValue(''))
  expect((await getBook(book.id))!.vocabulary!.learners[0].removed).toBe(true)
})

test('a remembered viewer who is no longer a learner falls back to Alle Wörter', async () => {
  const { book, k1, tom } = await setup()
  await addWord(book.id, { word: 'cira', translation: 'bread' })
  await setLearner(book.id, tom.id, true)
  await setLearner(book.id, tom.id, false)
  render(<Harness bookId={book.id} chapterId={k1.id} initialViewer={tom.id} />)
  await waitFor(() => expect(rows()).toHaveLength(1))
  expect(screen.getByRole('combobox', { name: 'Aus Sicht von' })).toHaveValue('')
  expect(rows()[0]).not.toHaveTextContent('noch nicht gelernt')
  expect(screen.queryByRole('button', { name: 'Nicht mehr lernend' })).not.toBeInTheDocument()
})

test('new word by hand: Gibt es schon, Zeigen opens the existing row', async () => {
  const user = userEvent.setup()
  const { book, k1 } = await setup()
  await addWord(book.id, { word: 'vaeri', translation: 'water' })
  render(<Harness bookId={book.id} chapterId={k1.id} />)
  await user.click(await screen.findByRole('button', { name: '+ Neues Wort' }))
  const input = screen.getByRole('textbox', { name: 'Wort' })
  expect(input).toHaveFocus()
  await user.type(input, 'Váeri')
  expect(screen.getByText('Gibt es schon')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Zeigen' }))
  expect(screen.getByRole('textbox', { name: 'Wort' })).toHaveValue('vaeri')
  expect(screen.getByRole('textbox', { name: 'Übersetzung' })).toHaveValue('water')
})

test('editing Wer kennt es: Andere Figur makes a learner, chapter defaults to the open one; knowers deleted from the wiki are not listed', async () => {
  const user = userEvent.setup()
  const { book, k1, k2, mira, tom } = await setup()
  await addWord(book.id, {
    word: 'vaeri',
    translation: 'water',
    known: [
      { entryId: mira.id, chapterId: k1.id },
      { entryId: 'ghost', chapterId: k1.id },
    ],
  })
  render(<Harness bookId={book.id} chapterId={k2.id} />)
  await user.click(await screen.findByRole('button', { name: /vaeri/ }))
  const who = screen.getByRole('group', { name: 'Wer kennt es' })
  expect(within(who).getByRole('combobox', { name: 'Ab Kapitel für Mira' })).toHaveValue(k1.id)
  expect(within(who).queryByText('ghost')).not.toBeInTheDocument()
  await user.selectOptions(within(who).getByRole('combobox', { name: 'Figur hinzufügen' }), 'Tom')
  expect(within(who).getByRole('combobox', { name: 'Ab Kapitel für Tom' })).toHaveValue(k2.id)
  await user.click(screen.getByRole('button', { name: 'Fertig' }))
  await waitFor(async () => expect((await words(book.id))[0].known).toHaveLength(3))
  const stored = await getBook(book.id)
  expect(stored!.vocabulary!.words[0].known).toEqual(
    expect.arrayContaining([
      { entryId: mira.id, chapterId: k1.id },
      { entryId: 'ghost', chapterId: k1.id },
      { entryId: tom.id, chapterId: k2.id },
    ]),
  )
  expect(stored!.vocabulary!.learners.find((l) => l.entryId === tom.id)?.removed).toBeUndefined()
})

test('+ Neues Wort with a viewer set prefills that learner and the open chapter', async () => {
  const user = userEvent.setup()
  const { book, k2, mira } = await setup()
  await setLearner(book.id, mira.id, true)
  render(<Harness bookId={book.id} chapterId={k2.id} initialViewer={mira.id} />)
  await user.click(await screen.findByRole('button', { name: '+ Neues Wort' }))
  expect(screen.getByRole('combobox', { name: 'Ab Kapitel für Mira' })).toHaveValue(k2.id)
  await user.type(screen.getByRole('textbox', { name: 'Wort' }), 'ilmar')
  await user.type(screen.getByRole('textbox', { name: 'Übersetzung' }), 'the old road')
  await user.click(screen.getByRole('button', { name: 'Fertig' }))
  await waitFor(async () => expect(await words(book.id)).toHaveLength(1))
  expect((await words(book.id))[0]).toMatchObject({ word: 'ilmar', translation: 'the old road', known: [{ entryId: mira.id, chapterId: k2.id }] })
})

test('Löschen asks first', async () => {
  const user = userEvent.setup()
  const { book, k1 } = await setup()
  await addWord(book.id, { word: 'vaeri', translation: 'water' })
  render(<Harness bookId={book.id} chapterId={k1.id} />)
  await user.click(await screen.findByRole('button', { name: /vaeri/ }))
  await user.click(screen.getByRole('button', { name: 'Löschen' }))
  const dialog = screen.getByRole('alertdialog', { name: 'Wort löschen?' })
  await user.click(within(dialog).getByRole('button', { name: 'Abbrechen' }))
  expect(await words(book.id)).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'Löschen' }))
  await user.click(within(screen.getByRole('alertdialog', { name: 'Wort löschen?' })).getByRole('button', { name: 'Löschen' }))
  await waitFor(async () => expect(await words(book.id)).toHaveLength(0))
  await waitFor(() => expect(screen.queryByRole('list', { name: 'Wörter' })).not.toBeInTheDocument())
})

test('an empty vocabulary invites the first word', async () => {
  const { book, k1 } = await setup()
  render(<Harness bookId={book.id} chapterId={k1.id} />)
  expect(await screen.findByText(/Strg\+Umschalt\+L/)).toBeInTheDocument()
})

test('an opened word scrolls into view in the drawer', async () => {
  const user = userEvent.setup()
  const { book, k1 } = await setup()
  await addWord(book.id, { word: 'vaeri', translation: 'water' })
  const scrolled = vi.fn()
  Element.prototype.scrollIntoView = scrolled
  try {
    render(<Harness bookId={book.id} chapterId={k1.id} />)
    await user.click(await screen.findByRole('button', { name: /vaeri/ }))
    await waitFor(() => expect(scrolled).toHaveBeenCalledWith({ block: 'start' }))
    expect(scrolled.mock.contexts.at(-1)).toBe(screen.getByRole('group', { name: 'Wort bearbeiten' }))
  } finally {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  }
})

test('a word opened from outside or with Zeigen shows even while a search hides it', async () => {
  const user = userEvent.setup()
  const { book, k1 } = await setup()
  const vaeri = await addWord(book.id, { word: 'vaeri', translation: 'water' })
  await addWord(book.id, { word: 'Bor', translation: 'stone' })
  const { rerender } = render(<Harness bookId={book.id} chapterId={k1.id} />)
  await user.type(await screen.findByRole('searchbox', { name: 'Suchen' }), 'stone')
  expect(rows()).toHaveLength(1)
  rerender(<Harness bookId={book.id} chapterId={k1.id} editing={{ wordId: vaeri.id, key: 1 }} />)
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Übersetzung' })).toHaveFocus())
  expect(screen.getByRole('textbox', { name: 'Wort' })).toHaveValue('vaeri')
  await user.click(screen.getByRole('button', { name: 'Abbrechen' }))
  await user.type(screen.getByRole('searchbox', { name: 'Suchen' }), 'stone')
  await user.click(screen.getByRole('button', { name: '+ Neues Wort' }))
  await user.type(screen.getByRole('textbox', { name: 'Wort' }), 'vaeri')
  await user.click(screen.getByRole('button', { name: 'Zeigen' }))
  expect(screen.getByRole('textbox', { name: 'Wort' })).toHaveValue('vaeri')
  expect(screen.getByRole('textbox', { name: 'Übersetzung' })).toHaveValue('water')
})
