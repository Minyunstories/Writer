import { EditorView } from '@codemirror/view'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import * as db from '../storage/db'
import { createBook, createChapter, listChapters, resetDatabaseForTests, updateChapter } from '../storage/db'
import { Editor } from '../editor/Editor'
import { createEntry, createFolder, getEntry, listEntries, listFolders } from '../storage/wiki'
import { BookView } from './BookView'
import { ZoomControl } from './ZoomControl'

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function renderAt(path: string, withEditor = false) {
  const view = withEditor ? (
    <BookView
      renderChapter={({ book, chapter, onChanged, extensions }) => (
        <Editor key={chapter.id} book={book} chapter={chapter} onChanged={onChanged} extraExtensions={extensions} />
      )}
    />
  ) : (
    <BookView />
  )
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>Dashboard</p>} />
        <Route path="/book/:bookId/:section?/:itemId?" element={view} />
      </Routes>
      <Location />
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  await resetDatabaseForTests()
  localStorage.clear()
})

test('shows title, back link and the three tabs', async () => {
  const book = await createBook('Sturmlied')
  renderAt(`/book/${book.id}`)
  expect(await screen.findByRole('heading', { name: 'Sturmlied' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Zurück zur Übersicht' })).toHaveAttribute('href', '/')
  for (const name of ['Kapitel', 'Wiki', 'Outline']) {
    expect(screen.getByRole('tab', { name })).toBeInTheDocument()
  }
  expect(screen.getByText('Noch keine Kapitel')).toBeInTheDocument()
})

test('Neues Kapitel adds, selects and updates the URL', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  renderAt(`/book/${book.id}`)
  await user.click(await screen.findByRole('button', { name: 'Neues Kapitel' }))
  const link = await screen.findByRole('link', { name: 'Kapitel 1' })
  const [chapter] = await listChapters(book.id)
  expect(link).toHaveAttribute('aria-current', 'page')
  expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/chapters/${chapter.id}`)
})

test('opens the first chapter when none is selected', async () => {
  const book = await createBook('Sturmlied')
  const first = await createChapter(book.id, 'Anfang')
  await createChapter(book.id, 'Sturm')
  renderAt(`/book/${book.id}`)
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/chapters/${first.id}`),
  )
})

test('rename and delete update the list; deleting the open chapter selects the next', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Anfang')
  const b = await createChapter(book.id, 'Sturm')
  renderAt(`/book/${book.id}/chapters/${a.id}`)

  const item = (await screen.findByRole('link', { name: 'Anfang' })).closest('li')!
  await user.click(within(item).getByRole('button', { name: 'Kapitel umbenennen' }))
  const input = screen.getByLabelText('Titel')
  await user.clear(input)
  await user.type(input, 'Prolog')
  await user.click(screen.getByRole('button', { name: 'Speichern' }))
  const renamed = (await screen.findByRole('link', { name: 'Prolog' })).closest('li')!

  await user.click(within(renamed).getByRole('button', { name: 'Kapitel löschen' }))
  expect(screen.getByText('Kapitel „Prolog" wirklich löschen?')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Endgültig löschen' }))
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Prolog' })).not.toBeInTheDocument())
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/chapters/${b.id}`),
  )

  const last = screen.getByRole('link', { name: 'Sturm' }).closest('li')!
  await user.click(within(last).getByRole('button', { name: 'Kapitel löschen' }))
  await user.click(screen.getByRole('button', { name: 'Endgültig löschen' }))
  expect(await screen.findByText('Noch keine Kapitel')).toBeInTheDocument()
})

test('Wiki tab shows the wiki, Outline tab the outline', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  renderAt(`/book/${book.id}`)
  await user.click(await screen.findByRole('tab', { name: 'Wiki' }))
  expect(await screen.findByRole('button', { name: 'Neuer Eintrag' })).toBeInTheDocument()
  expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/wiki`)
  await user.click(screen.getByRole('tab', { name: 'Outline' }))
  expect(await screen.findByRole('heading', { name: 'Outline' })).toBeInTheDocument()
  expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/outline`)
})

test('unknown book id shows a not-found message', async () => {
  renderAt('/book/does-not-exist')
  expect(await screen.findByText('Buch nicht gefunden')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Zurück zur Übersicht' })).toHaveAttribute('href', '/')
})

test('ZoomControl steps and stops at the limits', async () => {
  const user = userEvent.setup()
  render(<ZoomControl area="editor" />)
  expect(screen.getByText('100 %')).toBeInTheDocument()
  const plus = screen.getByRole('button', { name: 'Vergrößern' })
  await user.click(plus)
  expect(screen.getByText('110 %')).toBeInTheDocument()
  for (let i = 0; i < 9; i++) await user.click(plus)
  expect(screen.getByText('200 %')).toBeInTheDocument()
  expect(plus).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Verkleinern' })).toBeEnabled()
})

test('a failed rename is reported instead of vanishing', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Anfang')
  renderAt(`/book/${book.id}/chapters/${a.id}`)
  const item = (await screen.findByRole('link', { name: 'Anfang' })).closest('li')!
  const spy = vi.spyOn(db, 'updateChapter').mockRejectedValueOnce(new Error('quota'))
  await user.click(within(item).getByRole('button', { name: 'Kapitel umbenennen' }))
  await user.click(screen.getByRole('button', { name: 'Speichern' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Das hat nicht geklappt')
  spy.mockRestore()
})

test('a load error is not shown as a missing book', async () => {
  const book = await createBook('Sturmlied')
  const spy = vi.spyOn(db, 'getBook').mockRejectedValueOnce(new Error('connection lost'))
  renderAt(`/book/${book.id}`)
  expect(await screen.findByText('Das Buch konnte nicht geladen werden.')).toBeInTheDocument()
  expect(screen.queryByText('Buch nicht gefunden')).not.toBeInTheDocument()
  spy.mockRestore()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Erneut versuchen' }))
  expect(await screen.findByRole('heading', { name: 'Sturmlied' })).toBeInTheDocument()
})

test('wiki: folders and entries can be created from the sidebar', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  renderAt(`/book/${book.id}/wiki`)
  await user.click(await screen.findByRole('button', { name: 'Neuer Ordner' }))
  await user.type(screen.getByLabelText('Titel'), 'Personen')
  await user.click(screen.getByRole('button', { name: 'Anlegen' }))
  expect(await screen.findByText('Personen')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Eintrag in „Personen" anlegen' }))
  const [folder] = await listFolders(book.id)
  const [entry] = await waitFor(async () => {
    const all = await listEntries(book.id)
    expect(all).toHaveLength(1)
    return all
  })
  expect(entry.folderId).toBe(folder.id)
  expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/wiki/${entry.id}`)
  expect(await screen.findByLabelText('Name')).toHaveValue('Unbenannt')
  expect(screen.getByRole('link', { name: 'Unbenannt' })).toHaveAttribute('aria-current', 'page')
})

test('wiki: nested folders render nested and loose entries at the top', async () => {
  const book = await createBook('Sturmlied')
  const welt = await createFolder(book.id, 'Welt')
  const orte = await createFolder(book.id, 'Orte', welt.id)
  await createEntry(book.id, 'Hafen', orte.id)
  await createEntry(book.id, 'Lose Notiz')
  renderAt(`/book/${book.id}/wiki`)
  const hafen = await screen.findByRole('link', { name: 'Hafen' })
  const orteGroup = hafen.closest('[data-folder]')!
  expect(orteGroup).toHaveAttribute('data-folder', orte.id)
  expect(orteGroup.parentElement!.closest('[data-folder]')).toHaveAttribute('data-folder', welt.id)
  expect(screen.getByRole('link', { name: 'Lose Notiz' }).closest('[data-folder]')).toBeNull()
})

test('wiki: deleting a folder keeps its entries', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const orte = await createFolder(book.id, 'Orte')
  const hafen = await createEntry(book.id, 'Hafen', orte.id)
  renderAt(`/book/${book.id}/wiki`)
  await user.click(await screen.findByRole('button', { name: 'Ordner „Orte" löschen' }))
  expect(screen.getByText('Ordner „Orte" wirklich löschen?')).toBeInTheDocument()
  expect(screen.getByText('Die Einträge darin bleiben erhalten.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Ordner löschen' }))
  await waitFor(() => expect(screen.queryByText('Orte')).not.toBeInTheDocument())
  expect(screen.getByRole('link', { name: 'Hafen' })).toBeInTheDocument()
  expect((await getEntry(hafen.id))!.folderId).toBeNull()
})

test('a name in the chapter opens its entry in the panel, where it can be edited', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang')
  await updateChapter(chapter.id, { content: 'Prince stood.' })
  const entry = await createEntry(book.id, 'Prince')
  renderAt(`/book/${book.id}/chapters/${chapter.id}`, true)

  const link = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('.cm-mw-link')
    if (!found) throw new Error('no link yet')
    return found
  })
  expect(link).toHaveTextContent('Prince')
  expect(screen.queryByRole('complementary', { name: 'Wiki-Eintrag' })).not.toBeInTheDocument()
  await user.click(link)

  const panel = await screen.findByRole('complementary', { name: 'Wiki-Eintrag' })
  const name = await within(panel).findByLabelText('Name')
  expect(name).toHaveValue('Prince')
  expect(within(panel).getByRole('link', { name: 'Im Wiki öffnen' })).toHaveAttribute(
    'href',
    `/book/${book.id}/wiki/${entry.id}`,
  )
  await user.clear(name)
  await user.type(name, 'Prinz')
  await waitFor(async () => expect((await getEntry(entry.id))!.name).toBe('Prinz'))
  await waitFor(() => expect(document.querySelector('.cm-mw-link')).toBeNull())
  expect(document.querySelector('.cm-content')).toHaveTextContent('Prince stood.')

  await user.click(within(panel).getByRole('button', { name: 'Schließen' }))
  expect(screen.queryByRole('complementary', { name: 'Wiki-Eintrag' })).not.toBeInTheDocument()
})

test('default chapter names never repeat', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  await createChapter(book.id, 'Kapitel 1')
  await createChapter(book.id, 'Kapitel 3')
  renderAt(`/book/${book.id}`)
  await user.click(await screen.findByRole('button', { name: 'Neues Kapitel' }))
  expect(await screen.findByRole('link', { name: 'Kapitel 4' })).toBeInTheDocument()
  expect(screen.getAllByRole('link', { name: 'Kapitel 3' })).toHaveLength(1)
})

test('outline: cards, zoom and jump list', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  await createChapter(book.id, 'Anfang')
  await createChapter(book.id, 'Sturm')
  renderAt(`/book/${book.id}/outline`)
  expect(await screen.findByLabelText('Notizen zu Sturm')).toBeInTheDocument()
  expect(screen.getByText('100 %')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Zu Sturm springen' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Anfang nach unten' }))
  await waitFor(async () => expect((await listChapters(book.id)).map((c) => c.title)).toEqual(['Sturm', 'Anfang']))
})

test('outline: a note is still there after leaving the outline and coming back', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang')
  renderAt(`/book/${book.id}/outline`)
  const field = await screen.findByLabelText('Notizen zu Anfang')
  const view = EditorView.findFromDOM(field.closest<HTMLElement>('.cm-editor')!)!
  view.dispatch({ changes: { from: 0, insert: 'Regen' } })
  await waitFor(async () => expect((await db.getChapter(chapter.id))!.outline).toBe('Regen'))

  await user.click(screen.getByRole('tab', { name: 'Wiki' }))
  await waitFor(() => expect(screen.queryByLabelText('Notizen zu Anfang')).not.toBeInTheDocument())
  await user.click(screen.getByRole('tab', { name: 'Outline' }))
  const again = await screen.findByLabelText('Notizen zu Anfang')
  expect(again).toHaveTextContent('Regen')

  const second = EditorView.findFromDOM(again.closest<HTMLElement>('.cm-editor')!)!
  second.dispatch({ changes: { from: second.state.doc.length, insert: ' und Wind' } })
  await waitFor(async () => expect((await db.getChapter(chapter.id))!.outline).toBe('Regen und Wind'))
})

test('outline: word counts are fresh after chapter text was saved elsewhere', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang')
  renderAt(`/book/${book.id}/wiki`)
  await screen.findByRole('button', { name: 'Neuer Eintrag' })
  await updateChapter(chapter.id, { content: 'eins zwei drei' })
  await user.click(screen.getByRole('tab', { name: 'Outline' }))
  expect(await screen.findByText('3 Wörter')).toBeInTheDocument()
})
