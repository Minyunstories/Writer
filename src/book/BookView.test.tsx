import { EditorView } from '@codemirror/view'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import * as db from '../storage/db'
import { createBook, createChapter, getChapter, listChapters, resetDatabaseForTests, savePlace, setBookStyle, updateChapter } from '../storage/db'
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
      renderChapter={({ book, chapter, onChanged, extensions, jumpTo, onJumped }) => (
        <Editor key={chapter.id} book={book} chapter={chapter} onChanged={onChanged} extraExtensions={extensions} jumpTo={jumpTo} onJumped={onJumped} />
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
  expect(screen.getByText('Kapitel „Prolog" in den Papierkorb legen?')).toBeInTheDocument()
  expect(screen.getByText('Dort kannst du es 30 Tage lang wiederherstellen.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'In den Papierkorb' }))
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Prolog' })).not.toBeInTheDocument())
  await waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/chapters/${b.id}`),
  )

  const last = screen.getByRole('link', { name: 'Sturm' }).closest('li')!
  await user.click(within(last).getByRole('button', { name: 'Kapitel löschen' }))
  await user.click(screen.getByRole('button', { name: 'In den Papierkorb' }))
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
  const hafen = await within(await screen.findByRole('navigation', { name: 'Buchnavigation' })).findByRole('link', { name: 'Hafen' })
  const orteGroup = hafen.closest('[data-folder]')!
  expect(orteGroup).toHaveAttribute('data-folder', orte.id)
  expect(orteGroup.parentElement!.closest('[data-folder]')).toHaveAttribute('data-folder', welt.id)
  expect(within(screen.getByRole('navigation', { name: 'Buchnavigation' })).getByRole('link', { name: 'Lose Notiz' }).closest('[data-folder]')).toBeNull()
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
  expect(within(screen.getByRole('navigation', { name: 'Buchnavigation' })).getByRole('link', { name: 'Hafen' })).toBeInTheDocument()
  expect((await getEntry(hafen.id))!.folderId).toBeNull()
})

test('a name in the chapter opens its entry in the panel, where it can be edited', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang')
  await updateChapter(chapter.id, { content: 'Pascal stood.' })
  const entry = await createEntry(book.id, 'Pascal')
  renderAt(`/book/${book.id}/chapters/${chapter.id}`, true)

  const link = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('.cm-mw-link')
    if (!found) throw new Error('no link yet')
    return found
  })
  expect(link).toHaveTextContent('Pascal')
  expect(screen.queryByRole('complementary', { name: 'Wiki-Eintrag' })).not.toBeInTheDocument()
  await user.click(link)

  const panel = await screen.findByRole('complementary', { name: 'Wiki-Eintrag' })
  const name = await within(panel).findByLabelText('Name')
  expect(name).toHaveValue('Pascal')
  expect(within(panel).getByRole('link', { name: 'Im Wiki öffnen' })).toHaveAttribute(
    'href',
    `/book/${book.id}/wiki/${entry.id}`,
  )
  await user.clear(name)
  await user.type(name, 'Prinz')
  await waitFor(async () => expect((await getEntry(entry.id))!.name).toBe('Prinz'))
  await waitFor(() => expect(document.querySelector('.cm-mw-link')).toBeNull())
  expect(document.querySelector('.cm-content')).toHaveTextContent('Pascal stood.')

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

test('panel: opens from a mention in the outline', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  await createChapter(book.id, 'Anfang', 'Pascal stood.')
  const chars = await createFolder(book.id, 'Characters')
  await createEntry(book.id, 'Pascal', chars.id)
  renderAt(`/book/${book.id}/outline`)
  const group = await screen.findByRole('group', { name: 'Characters' })
  await user.click(within(group).getByRole('button', { name: 'Pascal' }))
  const panel = await screen.findByRole('complementary', { name: 'Wiki-Eintrag' })
  expect(await within(panel).findByLabelText('Name')).toHaveValue('Pascal')
})

test('panel: links inside the panel go forward, Zurück goes back, Schließen ends it', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang', 'Pascal stood.')
  await createEntry(book.id, 'Elena')
  const pascal = await createEntry(book.id, 'Pascal')
  await db.updateChapter(chapter.id, { content: 'Pascal stood.' })
  const { updateEntry } = await import('../storage/wiki')
  await updateEntry(pascal.id, { body: 'Sohn von Elena.' })
  renderAt(`/book/${book.id}/chapters/${chapter.id}`, true)
  const link = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('.editor .cm-mw-link')
    if (!found) throw new Error('no link yet')
    return found
  })
  await user.click(link)
  const panel = await screen.findByRole('complementary', { name: 'Wiki-Eintrag' })
  expect(await within(panel).findByLabelText('Name')).toHaveValue('Pascal')
  expect(within(panel).queryByRole('button', { name: 'Zurück' })).not.toBeInTheDocument()
  const inner = await waitFor(() => {
    const found = panel.querySelector<HTMLElement>('.markdown-field .cm-mw-link')
    if (!found) throw new Error('no link in notes yet')
    return found
  })
  fireEvent.click(inner)
  await waitFor(() => expect(within(panel).getByLabelText('Name')).toHaveValue('Elena'))
  await user.click(within(panel).getByRole('button', { name: 'Zurück' }))
  await waitFor(() => expect(within(panel).getByLabelText('Name')).toHaveValue('Pascal'))
  await user.click(within(panel).getByRole('button', { name: 'Schließen' }))
  expect(screen.queryByRole('complementary', { name: 'Wiki-Eintrag' })).not.toBeInTheDocument()
})

test('wiki: "Erwähnt in" opens the chapter at the first mention', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  await createChapter(book.id, 'Vorher', 'Nichts.')
  const chapter = await createChapter(book.id, 'Anfang', 'Es war Pascal. Pascal!')
  const pascal = await createEntry(book.id, 'Pascal')
  renderAt(`/book/${book.id}/wiki/${pascal.id}`, true)
  const list = await screen.findByRole('list', { name: 'Erwähnt in' })
  await user.click(within(list).getByRole('button', { name: /Anfang/ }))
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/chapters/${chapter.id}`))
  const view = await waitFor(() => {
    const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.editor .cm-editor')!)
    if (!found) throw new Error('not mounted')
    return found
  })
  await waitFor(() => expect([view.state.selection.main.from, view.state.selection.main.to]).toEqual([7, 7]))
  expect(document.querySelector('.cm-mw-flash')?.textContent).toBe('Pascal')

  // Later visits to the chapter do not jump again.
  await user.click(screen.getByRole('link', { name: 'Vorher' }))
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/chapters/'))
  await user.click(screen.getByRole('link', { name: 'Anfang' }))
  const again = await waitFor(() => {
    const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.editor .cm-editor')!)
    if (!found || found === view) throw new Error('not remounted')
    return found
  })
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(again.state.selection.main.from).toBe(0)
  expect(document.querySelector('.cm-mw-flash')).toBeNull()
})

test('chapter: [[ creates an entry in the chosen folder', async () => {
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang', '')
  await createFolder(book.id, 'Characters')
  renderAt(`/book/${book.id}/chapters/${chapter.id}`, true)
  const view = await waitFor(() => {
    const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.editor .cm-editor')!)
    if (!found) throw new Error('not mounted')
    return found
  })
  const { startCompletion, currentCompletions, acceptCompletion, selectedCompletionIndex, setSelectedCompletion } = await import('@codemirror/autocomplete')
  view.dispatch({ changes: { from: 0, insert: 'Da kam [[Mira' }, selection: { anchor: 13 } })
  startCompletion(view)
  await waitFor(() => expect(currentCompletions(view.state).map((c) => c.label)).toContain('„Mira" neu anlegen in: Characters'))
  // Nothing is picked until the writer picks it: Enter keeps writing.
  await new Promise((resolve) => setTimeout(resolve, 120))
  expect(selectedCompletionIndex(view.state)).toBeNull()
  expect(acceptCompletion(view)).toBe(false)
  const index = currentCompletions(view.state).findIndex((c) => c.label === '„Mira" neu anlegen in: Characters')
  view.dispatch({ effects: setSelectedCompletion(index) })
  // CodeMirror ignores an accept within its short interaction delay after the list opens.
  await new Promise((resolve) => setTimeout(resolve, 120))
  expect(selectedCompletionIndex(view.state)).toBe(index)
  expect(acceptCompletion(view)).toBe(true)
  expect(view.state.doc.toString()).toBe('Da kam Mira')
  await waitFor(async () => {
    const [entry] = await listEntries(book.id)
    expect(entry?.name).toBe('Mira')
    expect((await listFolders(book.id))[0].id).toBe(entry.folderId)
  })
  await waitFor(() => expect(document.querySelector('.editor .cm-mw-link')?.textContent).toBe('Mira'))
})

test('panel: on a phone, jumping from "Erwähnt in" closes the panel so the place is visible', async () => {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  try {
    const user = userEvent.setup()
    const book = await createBook('Sturmlied')
    const chapter = await createChapter(book.id, 'Anfang', 'Pascal stood.')
    await createEntry(book.id, 'Pascal')
    renderAt(`/book/${book.id}/chapters/${chapter.id}`, true)
    const link = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.editor .cm-mw-link')
      if (!found) throw new Error('no link yet')
      return found
    })
    await user.click(link)
    const panel = await screen.findByRole('complementary', { name: 'Wiki-Eintrag' })
    const list = await within(panel).findByRole('list', { name: 'Erwähnt in' })
    await user.click(within(list).getByRole('button', { name: /Anfang/ }))
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Wiki-Eintrag' })).not.toBeInTheDocument())
  } finally {
    window.matchMedia = original
  }
})

test('the book highlight colour reaches the text through a CSS variable', async () => {
  const book = await createBook('Sturmlied')
  await setBookStyle(book.id, { highlight: 'rgba(143, 184, 150, 0.40)' })
  await createChapter(book.id, 'Anfang', 'Ein ==Satz==.')
  renderAt(`/book/${book.id}/chapters`)
  await screen.findByRole('heading', { name: 'Sturmlied' })
  const root = document.querySelector<HTMLElement>('.book-view')!
  expect(root.style.getPropertyValue('--mw-highlight')).toBe('rgba(143, 184, 150, 0.40)')
})

async function editorView() {
  return waitFor(() => {
    const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.editor .cm-editor')!)
    if (!found) throw new Error('not mounted')
    return found
  })
}

test('opening a book continues at the last place', async () => {
  const book = await createBook('Sturmlied')
  await createChapter(book.id, 'Anfang', 'eins')
  const second = await createChapter(book.id, 'Sturm', 'Erste Zeile\nzweite Zeile hier')
  await savePlace(book.id, { chapterId: second.id, offset: 15, at: Date.now() })
  renderAt(`/book/${book.id}`, true)
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/chapters/${second.id}`))
  const view = await editorView()
  await waitFor(() => expect(view.state.selection.main.head).toBe(15))
  expect(document.querySelector('.cm-mw-flash')?.textContent).toBe('zweite Zeile hier')
})

test('a place beyond the end of a shorter chapter lands at its end', async () => {
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang', 'kurz')
  await savePlace(book.id, { chapterId: chapter.id, offset: 999, at: Date.now() })
  renderAt(`/book/${book.id}`, true)
  const view = await editorView()
  await waitFor(() => expect(view.state.selection.main.head).toBe(4))
})

test('the chapter list and a missing chapter open without jumping to the last place', async () => {
  const book = await createBook('Sturmlied')
  const first = await createChapter(book.id, 'Anfang', 'eins zwei')
  const second = await createChapter(book.id, 'Sturm', 'drei vier')
  await savePlace(book.id, { chapterId: second.id, offset: 5, at: Date.now() })
  const { unmount } = renderAt(`/book/${book.id}/chapters`, true)
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/chapters/${first.id}`))
  expect((await editorView()).state.selection.main.head).toBe(0)
  unmount()

  await savePlace(book.id, { chapterId: 'weg', offset: 5, at: Date.now() + 1 })
  renderAt(`/book/${book.id}`, true)
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/chapters/${first.id}`))
})

test('Neues Kapitel in a book with chapters opens the new chapter, not the first', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const first = await createChapter(book.id, 'Anfang', 'eins')
  renderAt(`/book/${book.id}/chapters/${first.id}`)
  await screen.findByRole('link', { name: 'Anfang' })
  await user.click(screen.getByRole('button', { name: 'Neues Kapitel' }))
  await waitFor(async () => expect(await listChapters(book.id)).toHaveLength(2))
  const created = (await listChapters(book.id)).find((chapter) => chapter.id !== first.id)!
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/chapters/${created.id}`))
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(screen.getByTestId('location')).toHaveTextContent(`/chapters/${created.id}`)
})

test('wiki: "Anordnen" in the book reorders entries and keeps the order', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  await createEntry(book.id, 'Anna')
  await createEntry(book.id, 'Ben')
  renderAt(`/book/${book.id}/wiki`)
  await within(await screen.findByRole('navigation', { name: 'Buchnavigation' })).findByRole('link', { name: 'Ben' })
  await user.click(screen.getByRole('button', { name: 'Anordnen' }))
  await user.click(screen.getByRole('button', { name: 'Ben nach oben' }))
  await waitFor(async () => expect((await db.getBook(book.id))!.wikiOrder?._root).toEqual([expect.any(String), expect.any(String)]))
  await waitFor(() => expect([...document.querySelectorAll('.wiki-tree-entry a')].map((a) => a.textContent)).toEqual(['Ben', 'Anna']))
})

test('wiki: a new entry puts the cursor in its name, ready to type', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  await createEntry(book.id, 'Anna')
  renderAt(`/book/${book.id}/wiki`)
  await user.click(await screen.findByRole('button', { name: 'Neuer Eintrag' }))
  const name = await screen.findByLabelText('Name')
  await waitFor(() => expect(name).toHaveFocus())
  await user.keyboard('Marlow')
  await waitFor(() => expect(name).toHaveValue('Marlow'))
})

test('wiki: the start page shows the last edited entries, a search and every folder', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const orte = await createFolder(book.id, 'Orte')
  await createEntry(book.id, 'Hafen', orte.id)
  for (const name of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
    await createEntry(book.id, name)
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
  renderAt(`/book/${book.id}/wiki`)
  const recent = await screen.findByRole('list', { name: 'Zuletzt bearbeitet' })
  expect(within(recent).getAllByRole('link').map((link) => link.textContent)).toEqual(
    expect.arrayContaining([expect.stringContaining('A6')]),
  )
  expect(within(recent).getAllByRole('link')).toHaveLength(5)
  expect(within(recent).getAllByRole('link')[0]).toHaveTextContent('A6')
  const block = screen.getByRole('region', { name: 'Orte' })
  expect(within(block).getByRole('link', { name: 'Hafen' })).toBeInTheDocument()
  await user.type(screen.getByRole('searchbox', { name: 'Wiki durchsuchen' }), 'haf')
  const results = screen.getByRole('list', { name: 'Suchergebnisse' })
  expect(within(results).getAllByRole('link').map((link) => link.textContent)).toEqual([expect.stringContaining('Hafen')])
  await user.click(within(results).getByRole('link', { name: /Hafen/ }))
  await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Hafen'))
})

test('the sidebar width can be changed with the handle and is remembered', async () => {
  const book = await createBook('Sturmlied')
  const { unmount } = renderAt(`/book/${book.id}/wiki`)
  const handle = await screen.findByRole('separator', { name: 'Breite der Seitenleiste' })
  const start = Number(handle.getAttribute('aria-valuenow'))
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  fireEvent.keyDown(handle, { key: 'ArrowRight' })
  expect(Number(handle.getAttribute('aria-valuenow'))).toBe(start + 32)
  unmount()
  renderAt(`/book/${book.id}/wiki`)
  expect(Number((await screen.findByRole('separator', { name: 'Breite der Seitenleiste' })).getAttribute('aria-valuenow'))).toBe(start + 32)
})

test('notepad: ideas from a chapter, done, moved to a chapter outline', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const first = await createChapter(book.id, 'Anfang', 'eins')
  const second = await createChapter(book.id, 'Sturm', 'zwei')
  renderAt(`/book/${book.id}/chapters/${first.id}`)
  await screen.findByRole('link', { name: 'Anfang' })
  await user.click(screen.getByRole('button', { name: /^Notizblock/ }))
  const pad = screen.getByRole('complementary', { name: 'Notizblock' })
  await user.type(within(pad).getByLabelText('Neue Idee'), 'Sturm vorbereiten{Enter}')
  await user.type(within(pad).getByLabelText('Neue Idee'), 'Zweite Idee{Enter}')
  const list = within(pad).getByRole('list', { name: 'Offene Ideen' })
  await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2))
  const idea = within(list).getByText('Sturm vorbereiten').closest('li')!
  expect(within(idea).getByRole('button', { name: 'aus: Anfang' })).toBeInTheDocument()
  await user.selectOptions(within(idea).getByLabelText('In die Outline von …'), second.id)
  await waitFor(async () => expect((await db.getChapter(second.id))!.outline).toBe('Sturm vorbereiten'))
  const other = within(list).getByText('Zweite Idee').closest('li')!
  await user.click(within(other).getByRole('button', { name: 'Erledigt' }))
  await waitFor(() => expect(within(pad).queryByRole('list', { name: 'Offene Ideen' })).not.toBeInTheDocument())
  await user.click(within(pad).getByRole('button', { name: /Erledigt \(2\)/ }))
  expect(within(pad).getByText('Zweite Idee')).toBeInTheDocument()
  // The keyboard closes it again.
  fireEvent.keyDown(window, { key: 'N', ctrlKey: true, shiftKey: true })
  await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Notizblock' })).not.toBeInTheDocument())
})

test('wiki: starred entries come first, marked, and show on the start page', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  await createEntry(book.id, 'Anna')
  const zora = await createEntry(book.id, 'Zora')
  const { unmount } = renderAt(`/book/${book.id}/wiki/${zora.id}`)
  await user.click(await screen.findByRole('button', { name: 'Mit Stern markieren' }))
  const nav = screen.getByRole('navigation', { name: 'Buchnavigation' })
  await waitFor(() => expect([...nav.querySelectorAll('.wiki-tree-entry a')].map((a) => a.textContent)).toEqual(['★ Zora', 'Anna']))
  expect(screen.getByRole('button', { name: 'Stern entfernen' })).toHaveAttribute('aria-pressed', 'true')
  unmount()
  renderAt(`/book/${book.id}/wiki`)
  const starred = await screen.findByRole('list', { name: 'Markiert' })
  expect(within(starred).getByRole('link', { name: /Zora/ })).toBeInTheDocument()
})

test('Ctrl+B hides and shows the sidebar outside the text', async () => {
  const book = await createBook('Sturmlied')
  renderAt(`/book/${book.id}/wiki`)
  const toggle = await screen.findByRole('button', { name: 'Navigation ausblenden' })
  fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true })
  await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'))
  fireEvent.keyDown(document.body, { key: 'b', ctrlKey: true })
  await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'))
})

test('a link straight to a later chapter opens that chapter on a fresh start', async () => {
  const book = await createBook('Sturmlied')
  await createChapter(book.id, 'Anfang', 'eins')
  const later = await createChapter(book.id, 'Später', 'zwei')
  renderAt(`/book/${book.id}/chapters/${later.id}`)
  await screen.findByRole('link', { name: 'Später' })
  await new Promise((resolve) => setTimeout(resolve, 100))
  expect(screen.getByTestId('location')).toHaveTextContent(`/chapters/${later.id}`)
})

test('manuscript: every chapter in one document; a click opens the chapter at that paragraph', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  await createChapter(book.id, 'Anfang', 'Eins.')
  const second = await createChapter(book.id, 'Sturm', 'Zwei.\nDrei.')
  renderAt(`/book/${book.id}/chapters`, true)
  await user.click(await screen.findByRole('link', { name: 'Manuskript lesen' }))
  const doc = await screen.findByRole('article')
  expect(within(doc).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Anfang', 'Sturm'])
  await user.click(within(doc).getByText('Drei.'))
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/chapters/${second.id}`))
  const view = await editorView()
  await waitFor(() => expect(view.state.selection.main.head).toBe(6))
})

test('search the whole book, jump to a match, replace everywhere', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const first = await createChapter(book.id, 'Anfang', 'Mira kam. Miranda nicht.')
  const second = await createChapter(book.id, 'Sturm', 'Später kam Mira zurück.')
  renderAt(`/book/${book.id}/chapters/${first.id}`, true)
  await screen.findByRole('link', { name: 'Anfang' })
  fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true })
  const panel = await screen.findByRole('complementary', { name: 'Suchen und Ersetzen' })
  await user.type(within(panel).getByLabelText('Suchen nach'), 'Mira')
  await user.click(within(panel).getByLabelText('Ganze Wörter'))
  const results = within(panel).getByRole('list', { name: 'Fundstellen' })
  await waitFor(() => expect(within(results).getAllByRole('button')).toHaveLength(2))
  expect(within(panel).getByText('2 Treffer in 2 Kapiteln')).toBeInTheDocument()
  await user.click(within(results).getAllByRole('button')[1])
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/chapters/${second.id}`))
  await user.type(within(panel).getByLabelText('Ersetzen durch'), 'Lea')
  await user.click(within(panel).getByRole('button', { name: 'Alle ersetzen' }))
  expect(within(panel).getByText('2 Stellen durch „Lea“ ersetzen?')).toBeInTheDocument()
  await user.click(within(panel).getByRole('button', { name: 'Ja, ersetzen' }))
  await waitFor(async () => {
    expect((await db.getChapter(first.id))!.content).toBe('Lea kam. Miranda nicht.')
    expect((await db.getChapter(second.id))!.content).toBe('Später kam Lea zurück.')
  })
  expect(await within(panel).findByText('2 Stellen ersetzt.')).toBeInTheDocument()
})

test('collection: a tab beside the notepad; items are added and put in at the cursor', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang', 'eins')
  renderAt(`/book/${book.id}/chapters/${chapter.id}`, true)
  await screen.findByRole('link', { name: 'Anfang' })
  await waitFor(() => expect(document.querySelector('.cm-content')).not.toBeNull())
  await user.click(screen.getByRole('button', { name: /^Notizblock/ }))
  await user.click(screen.getByRole('tab', { name: 'Sammlung' }))
  const panel = screen.getByRole('complementary', { name: 'Sammlung' })
  await user.click(within(panel).getByRole('button', { name: '+ Aus dem Text' }))
  const dialog = screen.getByRole('dialog', { name: 'In die Sammlung' })
  await user.type(within(dialog).getByLabelText('Text'), 'She looked away.')
  await user.type(within(dialog).getByLabelText('Neue Kategorie'), 'Blicke')
  await user.click(within(dialog).getByRole('button', { name: 'Aufnehmen' }))
  const item = await within(panel).findByRole('button', { name: 'She looked away.' })
  await user.click(item)
  await waitFor(() => expect(document.querySelector('.cm-content')!.textContent).toContain('She looked away.'))
  await user.click(screen.getByRole('tab', { name: 'Notizen' }))
  expect(screen.getByRole('complementary', { name: 'Notizblock' })).toBeInTheDocument()
})

test('replacing everywhere keeps a version of each changed chapter first', async () => {
  const { listVersions } = await import('../storage/versions')
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const first = await createChapter(book.id, 'Anfang', 'Mira kam.')
  renderAt(`/book/${book.id}/chapters/${first.id}`)
  await screen.findByRole('link', { name: 'Anfang' })
  fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true })
  const panel = await screen.findByRole('complementary', { name: 'Suchen und Ersetzen' })
  await user.type(within(panel).getByLabelText('Suchen nach'), 'Mira')
  await user.type(within(panel).getByLabelText('Ersetzen durch'), 'Lea')
  await user.click(within(panel).getByRole('button', { name: 'Alle ersetzen' }))
  await user.click(within(panel).getByRole('button', { name: 'Ja, ersetzen' }))
  await waitFor(async () => expect((await listVersions(first.id)).map((v) => [v.label, v.content])).toEqual([['Vor „Alle ersetzen“', 'Mira kam.']]))
})

test('typography for the whole book changes the chapters and keeps a version first', async () => {
  const { listVersions } = await import('../storage/versions')
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const first = await createChapter(book.id, 'Anfang', '"Hi," she said - quietly.')
  renderAt(`/book/${book.id}/chapters/${first.id}`)
  await screen.findByRole('link', { name: 'Anfang' })
  fireEvent.keyDown(window, { key: 'F', ctrlKey: true, shiftKey: true })
  const panel = await screen.findByRole('complementary', { name: 'Suchen und Ersetzen' })
  await user.click(within(panel).getByRole('button', { name: 'Anführungszeichen und Striche umwandeln' }))
  await user.click(within(panel).getByRole('button', { name: 'Ja, umwandeln' }))
  await waitFor(async () => expect((await db.getChapter(first.id))!.content).toBe('“Hi,” she said – quietly.'))
  expect((await listVersions(first.id))[0].label).toBe('Vor der Typografie')
})

test('scenes of the open chapter are listed under it and jump to their start', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang', 'The storm came.\n\n***\n\nMorning came.')
  renderAt(`/book/${book.id}/chapters/${chapter.id}`, true)
  const nav = await screen.findByRole('navigation', { name: 'Buchnavigation' })
  const second = await within(nav).findByRole('button', { name: /Szene 2.*Morning came\./ })
  await user.click(second)
  await waitFor(() => {
    const dom = document.querySelector<HTMLElement>('.cm-editor')!
    expect(EditorView.findFromDOM(dom)!.state.selection.main.head).toBe(22)
  })
})

test('wiki: the relationship network is a second view of the start page; a tap opens the entry beside it', async () => {
  const { addRelation, addRelationType } = await import('../storage/relations')
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const mira = await createEntry(book.id, 'Mira')
  const lea = await createEntry(book.id, 'Lea')
  const type = await addRelationType(book.id, 'Lehrerin von', 'Schülerin von')
  await addRelation(book.id, { from: mira.id, to: lea.id, typeId: type.id })
  renderAt(`/book/${book.id}/wiki`)
  await user.click(await screen.findByRole('tab', { name: 'Beziehungsnetz' }))
  const graph = await screen.findByRole('group', { name: 'Beziehungsnetz' })
  const node = within(graph).getByRole('button', { name: 'Lea' })
  fireEvent.pointerDown(node, { pointerId: 1, clientX: 5, clientY: 5 })
  fireEvent.pointerUp(node, { pointerId: 1, clientX: 5, clientY: 5 })
  expect(await screen.findByRole('complementary', { name: 'Wiki-Eintrag' })).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'Übersicht' }))
})

test('chapters can be grouped under a heading in the list; the group folds, is renamed and dissolved', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Anfang')
  await createChapter(book.id, 'Ball')
  await createChapter(book.id, 'Tanz')
  renderAt(`/book/${book.id}/chapters/${a.id}`)
  for (const [title, choice] of [
    ['Ball', 'Neue Gruppe …'],
    ['Tanz', 'Der Winterball'],
  ]) {
    const item = (await screen.findByRole('link', { name: title })).closest('li')!
    await user.click(within(item).getByRole('button', { name: 'Kapitel umbenennen' }))
    const dialog = screen.getByRole('dialog', { name: 'Kapitel bearbeiten' })
    await user.selectOptions(within(dialog).getByLabelText('Gruppe'), choice)
    if (choice === 'Neue Gruppe …') await user.type(within(dialog).getByLabelText('Name der neuen Gruppe'), 'Der Winterball')
    await user.click(within(dialog).getByRole('button', { name: 'Speichern' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  }
  const nav = screen.getByRole('navigation', { name: 'Buchnavigation' })
  const toggle = await within(nav).findByRole('button', { name: 'Der Winterball' })
  expect([...nav.querySelectorAll('.chapter-list > li')].map((li) => li.textContent?.replace(/[✎×▾▸]/g, '').trim())).toEqual(['Anfang', 'Der Winterball', 'Ball', 'Tanz'])
  await user.click(toggle)
  expect(within(nav).queryByRole('link', { name: 'Ball' })).not.toBeInTheDocument()
  await user.click(toggle)
  await user.click(within(nav).getByRole('button', { name: 'Gruppe „Der Winterball“ auflösen' }))
  await user.click(screen.getByRole('button', { name: 'Auflösen' }))
  await waitFor(() => expect(within(nav).queryByRole('button', { name: 'Der Winterball' })).not.toBeInTheDocument())
  expect(within(nav).getByRole('link', { name: 'Ball' })).toBeInTheDocument()
})

test('the panel on the right can be made wider, and keeps its width', async () => {
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang')
  const { unmount } = renderAt(`/book/${book.id}/chapters/${chapter.id}`)
  await screen.findByRole('link', { name: 'Anfang' })
  fireEvent.keyDown(window, { key: 'N', ctrlKey: true, shiftKey: true })
  const grip = await screen.findByRole('separator', { name: 'Breite der rechten Leiste' })
  const start = Number(grip.getAttribute('aria-valuenow'))
  fireEvent.keyDown(grip, { key: 'ArrowLeft' })
  fireEvent.keyDown(grip, { key: 'ArrowLeft' })
  expect(Number(grip.getAttribute('aria-valuenow'))).toBe(start + 32)
  unmount()
  renderAt(`/book/${book.id}/chapters/${chapter.id}`)
  await screen.findByRole('link', { name: 'Anfang' })
  fireEvent.keyDown(window, { key: 'N', ctrlKey: true, shiftKey: true })
  expect(Number((await screen.findByRole('separator', { name: 'Breite der rechten Leiste' })).getAttribute('aria-valuenow'))).toBe(start + 32)
})

test('module off, even with words stored: no drawer button', async () => {
  const { addWord } = await import('../storage/vocabulary')
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang')
  await addWord(book.id, { word: 'vaeri', translation: 'water' })
  renderAt(`/book/${book.id}/chapters/${chapter.id}`)
  expect(await screen.findByRole('heading', { name: 'Sturmlied' })).toBeInTheDocument()
  await screen.findByText('Notizen')
  expect(screen.queryByRole('button', { name: 'Vokabeln' })).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Module' })).not.toBeInTheDocument()
})

test('vocabulary on: the button opens the drawer for the open chapter and remembers it', async () => {
  const { setModule } = await import('../storage/modules')
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang')
  await setModule(book.id, 'vocabulary', true)
  const first = renderAt(`/book/${book.id}/chapters/${chapter.id}`)
  const button = await screen.findByRole('button', { name: 'Vokabeln' })
  expect(button).toHaveAttribute('aria-pressed', 'false')
  await user.click(button)
  const drawer = screen.getByRole('region', { name: 'Module' })
  expect(within(drawer).getByRole('heading', { name: 'Kapitel: Anfang' })).toBeInTheDocument()
  expect(button).toHaveAttribute('aria-pressed', 'true')
  first.unmount()

  renderAt(`/book/${book.id}/chapters/${chapter.id}`)
  expect(await screen.findByRole('region', { name: 'Module' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Vokabeln' }))
  expect(screen.queryByRole('region', { name: 'Module' })).not.toBeInTheDocument()
})

test('the drawer is only in the chapter view', async () => {
  const { setModule } = await import('../storage/modules')
  const book = await createBook('Sturmlied')
  await createChapter(book.id, 'Anfang')
  await setModule(book.id, 'vocabulary', true)
  localStorage.setItem(`mw:drawer-open:${book.id}`, '1')
  renderAt(`/book/${book.id}/wiki`)
  expect(await screen.findByRole('heading', { name: 'Sturmlied' })).toBeInTheDocument()
  await screen.findByText('Notizen')
  expect(screen.queryByRole('button', { name: 'Vokabeln' })).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Module' })).not.toBeInTheDocument()
})

test('on a phone the drawer and the wiki panel take turns', async () => {
  const { setModule } = await import('../storage/modules')
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  try {
    const user = userEvent.setup()
    const book = await createBook('Sturmlied')
    const chapter = await createChapter(book.id, 'Anfang', 'Pascal stood.')
    await createEntry(book.id, 'Pascal')
    await setModule(book.id, 'vocabulary', true)
    renderAt(`/book/${book.id}/chapters/${chapter.id}`, true)
    await user.click(await screen.findByRole('button', { name: 'Vokabeln' }))
    expect(screen.getByRole('region', { name: 'Module' })).toBeInTheDocument()
    const link = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.editor .cm-mw-link')
      if (!found) throw new Error('no link yet')
      return found
    })
    await user.click(link)
    expect(await screen.findByRole('complementary', { name: 'Wiki-Eintrag' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Module' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Vokabeln' }))
    expect(screen.getByRole('region', { name: 'Module' })).toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Wiki-Eintrag' })).not.toBeInTheDocument()
  } finally {
    window.matchMedia = original
  }
})

async function chapterWithVocabulary(text: string, moduleOn = true) {
  const { setModule } = await import('../storage/modules')
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang', text)
  if (moduleOn) await setModule(book.id, 'vocabulary', true)
  renderAt(`/book/${book.id}/chapters/${chapter.id}`, true)
  const view = await waitFor(() => {
    const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.editor .cm-editor')!)
    if (!found || !found.state.doc.toString()) throw new Error('not mounted')
    return found
  })
  return { book, chapter, view }
}

async function pressTakeWord(view: EditorView) {
  const { runScopeHandlers } = await import('@codemirror/view')
  return runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', keyCode: 76, ctrlKey: true, shiftKey: true }), 'editor')
}

test('Strg+Umschalt+L takes the marked word and opens it', async () => {
  const { book, view } = await chapterWithVocabulary('She said vaeri, softly.')
  view.dispatch({ selection: { anchor: 9, head: 15 } })
  expect(await pressTakeWord(view)).toBe(true)
  await waitFor(async () => expect((await db.getBook(book.id))!.vocabulary?.words.map((w) => w.word)).toEqual(['vaeri']))
  const drawer = await screen.findByRole('region', { name: 'Module' })
  await waitFor(() => expect(within(drawer).getByRole('textbox', { name: 'Übersetzung' })).toHaveFocus())
  view.dispatch({ selection: { anchor: 9, head: 14 } })
  await pressTakeWord(view)
  await new Promise((resolve) => setTimeout(resolve, 50))
  await waitFor(async () => expect((await db.getBook(book.id))!.vocabulary!.words).toHaveLength(1))
})

test('with a viewer set, the word is known from the open chapter', async () => {
  const { setModule } = await import('../storage/modules')
  const { setLearner } = await import('../storage/vocabulary')
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang', 'She said vaeri.')
  const mira = await createEntry(book.id, 'Mira')
  await setModule(book.id, 'vocabulary', true)
  await setLearner(book.id, mira.id, true)
  localStorage.setItem(`mw:vocab-viewer:${book.id}`, mira.id)
  renderAt(`/book/${book.id}/chapters/${chapter.id}`, true)
  const view = await waitFor(() => {
    const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.editor .cm-editor')!)
    if (!found || !found.state.doc.toString()) throw new Error('not mounted')
    return found
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Vokabeln' })).toBeInTheDocument())
  view.dispatch({ selection: { anchor: 9, head: 14 } })
  await pressTakeWord(view)
  await waitFor(async () => expect((await db.getBook(book.id))!.vocabulary?.words[0]?.known).toEqual([{ entryId: mira.id, chapterId: chapter.id }]))
})

test('without a selection the shortcut opens an empty new row and stores nothing', async () => {
  const { book, view } = await chapterWithVocabulary('She said vaeri.')
  view.dispatch({ selection: { anchor: 3 } })
  expect(await pressTakeWord(view)).toBe(true)
  const drawer = await screen.findByRole('region', { name: 'Module' })
  await waitFor(() => expect(within(drawer).getByRole('textbox', { name: 'Wort' })).toHaveFocus())
  expect(within(drawer).getByRole('textbox', { name: 'Wort' })).toHaveValue('')
  expect((await db.getBook(book.id))!.vocabulary).toBeUndefined()
})

test('module off: the shortcut does nothing', async () => {
  const { book, view } = await chapterWithVocabulary('She said vaeri.', false)
  view.dispatch({ selection: { anchor: 9, head: 14 } })
  expect(await pressTakeWord(view)).toBe(false)
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(screen.queryByRole('region', { name: 'Module' })).not.toBeInTheDocument()
  expect((await db.getBook(book.id))!.vocabulary).toBeUndefined()
})

test('a word taken earlier does not open again when the drawer is opened again', async () => {
  const user = userEvent.setup()
  const { view } = await chapterWithVocabulary('She said vaeri, softly.')
  view.dispatch({ selection: { anchor: 9, head: 14 } })
  await pressTakeWord(view)
  const drawer = await screen.findByRole('region', { name: 'Module' })
  await waitFor(() => expect(within(drawer).getByRole('textbox', { name: 'Übersetzung' })).toHaveFocus())
  await user.click(within(drawer).getByRole('button', { name: 'Schließen' }))
  await user.click(screen.getByRole('button', { name: 'Vokabeln' }))
  const again = await screen.findByRole('region', { name: 'Module' })
  await within(again).findByRole('list', { name: 'Wörter' })
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect(within(again).queryByRole('textbox', { name: 'Übersetzung' })).not.toBeInTheDocument()
})

test('the module button sits right before Notizen', async () => {
  const { setModule } = await import('../storage/modules')
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang')
  await setModule(book.id, 'vocabulary', true)
  renderAt(`/book/${book.id}/chapters/${chapter.id}`)
  const button = await screen.findByRole('button', { name: 'Vokabeln' })
  expect(button.nextElementSibling).toBe(screen.getByRole('button', { name: /^Notizblock/ }))
})

test('module off, even with data: no Anreden section in a wiki entry; on: there is one', async () => {
  const { setModule } = await import('../storage/modules')
  const { addRank } = await import('../storage/address')
  const book = await createBook('Sturmlied')
  const chars = await createFolder(book.id, 'Characters')
  const lea = await createEntry(book.id, 'Lea', chars.id)
  await addRank(book.id, 'Duchess')
  const first = renderAt(`/book/${book.id}/wiki/${lea.id}`)
  expect(await screen.findByRole('heading', { name: 'Sturmlied' })).toBeInTheDocument()
  await screen.findByLabelText('Name')
  expect(screen.queryByRole('region', { name: 'Anreden' })).not.toBeInTheDocument()
  first.unmount()
  await setModule(book.id, 'address', true)
  renderAt(`/book/${book.id}/wiki/${lea.id}`)
  expect(await screen.findByRole('region', { name: 'Anreden' })).toBeInTheDocument()
})

test('the Anreden tab on the wiki home appears only with the module on', async () => {
  const { setModule } = await import('../storage/modules')
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  await createEntry(book.id, 'Lea')
  localStorage.setItem('mw:wiki-view', 'address')
  const first = renderAt(`/book/${book.id}/wiki`)
  expect(await screen.findByRole('tab', { name: 'Übersicht' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.queryByRole('tab', { name: 'Anreden' })).not.toBeInTheDocument()
  first.unmount()
  await setModule(book.id, 'address', true)
  renderAt(`/book/${book.id}/wiki`)
  const tab = await screen.findByRole('tab', { name: 'Anreden' })
  await user.click(tab)
  expect(await screen.findByText('{Vorname} und {Nachname} werden mit den Namen der Figur gefüllt.')).toBeInTheDocument()
})

test('both modules on: the button says Module and the drawer has two tabs', async () => {
  const { setModule } = await import('../storage/modules')
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang')
  await setModule(book.id, 'vocabulary', true)
  await setModule(book.id, 'address', true)
  renderAt(`/book/${book.id}/chapters/${chapter.id}`)
  await user.click(await screen.findByRole('button', { name: 'Module' }))
  const drawer = screen.getByRole('region', { name: 'Module' })
  const tabs = within(drawer).getAllByRole('tab')
  expect(tabs.map((tab) => tab.textContent)).toEqual(['Vokabeln', 'Anreden'])
  await user.click(within(drawer).getByRole('tab', { name: 'Anreden' }))
  expect(await within(drawer).findByText('Wähle, wer spricht.')).toBeInTheDocument()
})

test('keeps the screen on while a chapter is open, not in the wiki', async () => {
  const release = vi.fn(async () => {})
  const request = vi.fn(async () => ({ released: false, release }))
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
  try {
    const user = userEvent.setup()
    const book = await createBook('Sturmlied')
    const chapter = await createChapter(book.id, 'Eins')
    renderAt(`/book/${book.id}/chapters/${chapter.id}`)
    await waitFor(() => expect(request).toHaveBeenCalledWith('screen'))
    await user.click(screen.getByRole('tab', { name: 'Wiki' }))
    await waitFor(() => expect(release).toHaveBeenCalled())
  } finally {
    delete (navigator as { wakeLock?: unknown }).wakeLock
  }
})

test('Strg+/ opens and closes the shortcut overview', async () => {
  const book = await createBook('Sturmlied')
  renderAt(`/book/${book.id}`)
  await screen.findByRole('heading', { name: 'Sturmlied' })
  // German keyboard: Ctrl+Shift+7 gives "/".
  fireEvent.keyDown(window, { key: '/', ctrlKey: true, shiftKey: true })
  expect(screen.getByRole('dialog', { name: 'Tastenkürzel' })).toBeInTheDocument()
  fireEvent.keyDown(window, { key: '/', ctrlKey: true, shiftKey: true })
  expect(screen.queryByRole('dialog', { name: 'Tastenkürzel' })).toBeNull()
})

test('the keyboard button opens the shortcut overview, Esc closes it', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  renderAt(`/book/${book.id}`)
  await user.click(await screen.findByRole('button', { name: 'Tastenkürzel' }))
  expect(screen.getByRole('dialog', { name: 'Tastenkürzel' })).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Tastenkürzel' })).toBeNull()
})

test('Strg+/ in the chapter opens the overview and leaves the text alone', async () => {
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Eins')
  await updateChapter(chapter.id, { content: 'Hallo' })
  renderAt(`/book/${book.id}/chapters/${chapter.id}`, true)
  const view = await waitFor(() => {
    const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.editor .cm-editor')!)
    if (!found) throw new Error('not mounted')
    return found
  })
  view.focus()
  fireEvent.keyDown(view.contentDOM, { key: '/', ctrlKey: true })
  expect(view.state.doc.toString()).toBe('Hallo')
  expect(screen.getByRole('dialog', { name: 'Tastenkürzel' })).toBeInTheDocument()
})

test('Strg+/ in a wiki text field leaves the text alone', async () => {
  const book = await createBook('Sturmlied')
  const entry = await createEntry(book.id, 'Pascal')
  renderAt(`/book/${book.id}/wiki/${entry.id}`)
  const field = await waitFor(() => {
    const found = document.querySelector<HTMLElement>('.wiki-entry .cm-editor')
    if (!found) throw new Error('not mounted')
    return EditorView.findFromDOM(found)!
  })
  field.dispatch({ changes: { from: 0, insert: 'Notiz' } })
  field.focus()
  fireEvent.keyDown(field.contentDOM, { key: '/', ctrlKey: true })
  expect(field.state.doc.toString()).toBe('Notiz')
  expect(screen.getByRole('dialog', { name: 'Tastenkürzel' })).toBeInTheDocument()
})

test('a deleted chapter waits in the trash and comes back, opened', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Eins')
  const b = await createChapter(book.id, 'Zwei')
  await createChapter(book.id, 'Drei')
  renderAt(`/book/${book.id}/chapters/${a.id}`)
  await screen.findByRole('link', { name: 'Zwei' })
  expect(screen.queryByRole('button', { name: /Papierkorb/ })).toBeNull()

  const item = screen.getByRole('link', { name: 'Zwei' }).closest('li')!
  await user.click(within(item).getByRole('button', { name: 'Kapitel löschen' }))
  await user.click(screen.getByRole('button', { name: 'In den Papierkorb' }))
  await waitFor(() => expect(screen.queryByRole('link', { name: 'Zwei' })).toBeNull())

  await user.click(await screen.findByRole('button', { name: 'Papierkorb · 1' }))
  const dialog = screen.getByRole('dialog', { name: 'Papierkorb' })
  await user.click(within(dialog).getByRole('button', { name: '„Zwei" wiederherstellen' }))
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/chapters/${b.id}`))
  expect(screen.queryByRole('dialog', { name: 'Papierkorb' })).toBeNull()
  expect((await listChapters(book.id)).map((c) => c.title)).toEqual(['Eins', 'Zwei', 'Drei'])
  await waitFor(() => expect(screen.queryByRole('button', { name: /Papierkorb/ })).toBeNull())
})

test('a restored wiki entry opens in the wiki', async () => {
  const user = userEvent.setup()
  const { trashEntry } = await import('../storage/trash')
  const book = await createBook('Sturmlied')
  const entry = await createEntry(book.id, 'Pascal')
  await trashEntry(entry.id)
  renderAt(`/book/${book.id}/wiki`)
  await user.click(await screen.findByRole('button', { name: 'Papierkorb · 1' }))
  await user.click(screen.getByRole('button', { name: '„Pascal" wiederherstellen' }))
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/wiki/${entry.id}`))
})

test('opening a book clears what has been in the trash for 30 days', async () => {
  const { listTrash, trashChapter } = await import('../storage/trash')
  const { db } = await import('../storage/connection')
  const book = await createBook('Sturmlied')
  const old = await createChapter(book.id, 'Alt')
  const item = await trashChapter(old.id)
  await (await db()).put('trash', { ...item!, deletedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 })
  renderAt(`/book/${book.id}`)
  await screen.findByRole('heading', { name: 'Sturmlied' })
  await waitFor(async () => expect(await listTrash(book.id)).toEqual([]))
  expect(screen.queryByRole('button', { name: /Papierkorb/ })).toBeNull()
})

test('Strg+O jumps to a chapter', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Anfang')
  const b = await createChapter(book.id, 'Der lange Winter')
  renderAt(`/book/${book.id}/chapters/${a.id}`)
  await screen.findByRole('link', { name: 'Der lange Winter' })
  fireEvent.keyDown(window, { key: 'o', ctrlKey: true })
  const dialog = screen.getByRole('dialog', { name: 'Schnellsprung' })
  await user.type(within(dialog).getByRole('combobox'), 'winter{Enter}')
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/chapters/${b.id}`))
  expect(screen.queryByRole('dialog', { name: 'Schnellsprung' })).toBeNull()
})

test('Strg+O in a chapter opens a wiki entry in the side panel', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Anfang')
  await createEntry(book.id, 'Pascal')
  renderAt(`/book/${book.id}/chapters/${a.id}`, true)
  const view = await waitFor(() => {
    const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.editor .cm-editor')!)
    if (!found) throw new Error('not mounted')
    return found
  })
  fireEvent.keyDown(view.contentDOM, { key: 'o', ctrlKey: true })
  await user.type(screen.getByRole('combobox', { name: 'Kapitel oder Wiki-Eintrag suchen' }), 'pas{Enter}')
  const panel = await screen.findByRole('complementary', { name: 'Wiki-Eintrag' })
  expect(await within(panel).findByLabelText('Name')).toHaveValue('Pascal')
  expect(screen.getByTestId('location')).toHaveTextContent(`/chapters/${a.id}`)
})

test('outside the chapters, a wiki entry from the jump opens in the wiki', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  await createChapter(book.id, 'Anfang')
  const entry = await createEntry(book.id, 'Pascal')
  renderAt(`/book/${book.id}/outline`)
  await screen.findByRole('heading', { name: 'Sturmlied' })
  fireEvent.keyDown(window, { key: 'o', ctrlKey: true })
  await user.type(screen.getByRole('combobox', { name: 'Kapitel oder Wiki-Eintrag suchen' }), 'pas{Enter}')
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/wiki/${entry.id}`))
})

test('the button in a ## line makes a new chapter from there and opens it', async () => {
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Anfang', 'Mira closed the door.\n\n## Der Winter\n\nSnow came early.')
  await createChapter(book.id, 'Ende', '')
  renderAt(`/book/${book.id}/chapters/${a.id}`, true)
  const view = await waitFor(() => {
    const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.editor .cm-editor')!)
    if (!found) throw new Error('not mounted')
    return found
  })
  view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf('Winter') } })
  const button = await waitFor(() => {
    const found = view.dom.querySelector<HTMLButtonElement>('.cm-mw-split')
    if (!found) throw new Error('no button')
    return found
  })
  button.click()
  await waitFor(async () => expect((await listChapters(book.id)).map((c) => c.title)).toEqual(['Anfang', 'Der Winter', 'Ende']))
  const created = (await listChapters(book.id))[1]
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/chapters/${created.id}`))
  expect(created.content).toBe('Snow came early.')
  expect((await getChapter(a.id))!.content).toBe('Mira closed the door.')
})

test('a chapter can be merged with the next from its window; the next goes to the trash', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Anfang', 'Mira closed the door.')
  await createChapter(book.id, 'Der Winter', 'Snow came early.')
  const last = await createChapter(book.id, 'Ende', '')
  renderAt(`/book/${book.id}/chapters/${a.id}`)
  const row = (await screen.findByRole('link', { name: 'Anfang' })).closest('li')!
  await user.click(within(row).getByRole('button', { name: 'Kapitel umbenennen' }))
  await user.click(screen.getByRole('button', { name: 'Mit „Der Winter" zusammenführen' }))
  expect(screen.getByText('„Der Winter" an „Anfang" anhängen?')).toBeInTheDocument()
  expect(screen.getByText('„Der Winter" wird zur Zwischenüberschrift in „Anfang". Das Kapitel „Der Winter" selbst kommt in den Papierkorb.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Zusammenführen' }))
  await waitFor(async () => expect((await listChapters(book.id)).map((c) => c.title)).toEqual(['Anfang', 'Ende']))
  expect((await getChapter(a.id))!.content).toBe('Mira closed the door.\n\n## Der Winter\n\nSnow came early.')
  expect(await screen.findByRole('button', { name: 'Papierkorb · 1' })).toBeInTheDocument()

  // The last chapter has no next one.
  const lastRow = screen.getByRole('link', { name: 'Ende' }).closest('li')!
  await user.click(within(lastRow).getByRole('button', { name: 'Kapitel umbenennen' }))
  expect(screen.queryByRole('button', { name: /zusammenführen/ })).toBeNull()
  void last
})

test('renaming a wiki entry can change the name in every chapter', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Eins', "Mira smiled. Mira's cup.")
  const b = await createChapter(book.id, 'Zwei', 'Miras plan. Lea and Mira.')
  const entry = await createEntry(book.id, 'Mira')
  renderAt(`/book/${book.id}/wiki/${entry.id}`)
  const name = await screen.findByLabelText('Name')
  await user.click(name)
  await user.type(name, 'bel')
  await user.tab()
  await user.click(await screen.findByRole('button', { name: 'Überall durch „Mirabel" ersetzen' }))
  await waitFor(async () => expect((await getChapter(a.id))!.content).toBe("Mirabel smiled. Mirabel's cup."))
  expect((await getChapter(b.id))!.content).toBe('Miras plan. Lea and Mirabel.')
  const { listVersions } = await import('../storage/versions')
  expect((await listVersions(a.id)).map((v) => v.label)).toEqual(['Vor dem Umbenennen'])
})

test('the side panel has a tab to read another chapter', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Anfang', 'Mira closed the door.')
  const b = await createChapter(book.id, 'Mitte', 'Lea laughed.')
  renderAt(`/book/${book.id}/chapters/${b.id}`)
  await screen.findByRole('link', { name: 'Anfang' })
  await user.click(screen.getByRole('button', { name: /^Notizblock/ }))
  await user.click(within(screen.getByRole('tablist', { name: 'Seitenleiste' })).getByRole('tab', { name: 'Kapitel' }))
  const panel = screen.getByRole('complementary', { name: 'Kapitel lesen' })
  expect(within(panel).getByText('Mira closed the door.')).toBeInTheDocument()
  await user.click(within(panel).getByRole('button', { name: 'Öffnen' }))
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/chapters/${a.id}`))
})

test('with four tabs, the side panel closes with a small ✕ so the tabs fit', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Anfang', '')
  renderAt(`/book/${book.id}/chapters/${a.id}`)
  await screen.findByRole('link', { name: 'Anfang' })
  await user.click(screen.getByRole('button', { name: /^Notizblock/ }))
  for (const tab of ['Notizen', 'Sammlung', 'Kommentare', 'Kapitel']) {
    await user.click(within(screen.getByRole('tablist', { name: 'Seitenleiste' })).getByRole('tab', { name: tab }))
    const panel = screen.getAllByRole('complementary').find((element) => element.classList.contains('notes-panel'))!
    expect(within(panel).getByRole('button', { name: 'Schließen' })).toHaveTextContent('✕')
  }
})

test('merging into the open chapter keeps its comments where they were', async () => {
  const user = userEvent.setup()
  const { addComment } = await import('../storage/comments')
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Anfang', 'Mira closed the door.')
  const next = await createChapter(book.id, 'Der Winter', 'Snow came early.')
  await addComment(a.id, { from: 5, to: 11, quote: 'closed', text: 'besser?' })
  await addComment(next.id, { from: 0, to: 4, quote: 'Snow', text: 'Schnee' })
  renderAt(`/book/${book.id}/chapters/${a.id}`, true)
  await waitFor(() => expect(document.querySelector('.editor .cm-content')?.textContent).toContain('Mira closed'))
  const row = screen.getByRole('link', { name: 'Anfang' }).closest('li')!
  await user.click(within(row).getByRole('button', { name: 'Kapitel umbenennen' }))
  await user.click(screen.getByRole('button', { name: 'Mit „Der Winter" zusammenführen' }))
  await user.click(screen.getByRole('button', { name: 'Zusammenführen' }))
  await waitFor(() => expect(document.querySelector('.editor .cm-content')?.textContent).toContain('Snow came early.'))
  // The editor stores comment places a little later; give it time to do so.
  await new Promise((resolve) => setTimeout(resolve, 1800))
  const stored = (await getChapter(a.id))!
  expect(stored.comments!.map((comment) => [comment.text, stored.content.slice(comment.from, comment.to)])).toEqual([
    ['besser?', 'closed'],
    ['Schnee', 'Snow'],
  ])
}, 10000)
