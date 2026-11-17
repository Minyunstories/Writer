import { EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test } from 'vitest'
import {
  createBook,
  createChapter,
  getBook,
  getChapter,
  listChapters,
  resetDatabaseForTests,
  updateChapter,
} from '../storage/db'
import { Editor } from './Editor'

async function setup(content: string) {
  const book = await createBook('Sturmlied')
  const created = await createChapter(book.id, 'Anfang')
  const chapter = await updateChapter(created.id, { content })
  render(<Editor book={book} chapter={chapter} onChanged={() => {}} />)
  const view = await waitFor(() => {
    const dom = document.querySelector<HTMLElement>('.cm-editor')
    const found = dom && EditorView.findFromDOM(dom)
    if (!found) throw new Error('editor not mounted')
    return found
  })
  return { book, chapter, view }
}

function replaceAll(view: EditorView, text: string) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
}

beforeEach(async () => {
  await resetDatabaseForTests()
  localStorage.clear()
})

test('shows the stored content', async () => {
  const { view } = await setup('Es war einmal')
  expect(view.state.doc.toString()).toBe('Es war einmal')
})

test('loads fresh content from storage, not the stale prop', async () => {
  const book = await createBook('B')
  const stale = await createChapter(book.id, 'A')
  await updateChapter(stale.id, { content: 'neuer Stand' })
  render(<Editor book={book} chapter={stale} onChanged={() => {}} />)
  await waitFor(() => expect(document.querySelector('.cm-content')?.textContent).toBe('neuer Stand'))
})

test('saves a change within 600 ms', async () => {
  const { chapter, view } = await setup('alt')
  replaceAll(view, 'ganz neu')
  await waitFor(async () => expect((await getChapter(chapter.id))!.content).toBe('ganz neu'), { timeout: 600 })
})

test('pagehide saves at once', async () => {
  const { chapter, view } = await setup('alt')
  replaceAll(view, 'schnell weg')
  window.dispatchEvent(new Event('pagehide'))
  await waitFor(async () => expect((await getChapter(chapter.id))!.content).toBe('schnell weg'), { timeout: 150 })
})

test('unmounting saves pending text', async () => {
  const book = await createBook('B')
  const chapter = await createChapter(book.id, 'A')
  const { unmount } = render(<Editor book={book} chapter={chapter} onChanged={() => {}} />)
  const view = await waitFor(() => {
    const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)
    if (!found) throw new Error('not mounted')
    return found
  })
  replaceAll(view, 'vor dem Wechsel')
  unmount()
  await waitFor(async () => expect((await getChapter(chapter.id))!.content).toBe('vor dem Wechsel'), { timeout: 150 })
})

test('status bar shows word count and save state', async () => {
  const { view } = await setup('Ein kurzer Satz hier')
  expect(await screen.findByText('4 Wörter')).toBeInTheDocument()
  expect(screen.getByText('Gespeichert')).toBeInTheDocument()
  replaceAll(view, 'Zwei Wörter')
  expect(await screen.findByText('Speichert …')).toBeInTheDocument()
  expect(await screen.findByText('Gespeichert')).toBeInTheDocument()
  expect(await screen.findByText('2 Wörter')).toBeInTheDocument()
})

test('choosing a font stores it on the book', async () => {
  const user = userEvent.setup()
  const { book } = await setup('Text')
  await user.selectOptions(screen.getByLabelText('Schrift'), 'Courier Prime')
  await waitFor(async () => expect((await getBook(book.id))!.font).toBe('courier-prime'))
})

test('editing the title saves it and falls back to Unbenannt', async () => {
  const user = userEvent.setup()
  const { chapter } = await setup('Text')
  const title = screen.getByLabelText('Kapiteltitel')
  await user.clear(title)
  await user.type(title, 'Prolog')
  await waitFor(async () => expect((await getChapter(chapter.id))!.title).toBe('Prolog'))
  await user.clear(title)
  await user.tab()
  await waitFor(async () => expect((await getChapter(chapter.id))!.title).toBe('Unbenannt'))
  await waitFor(() => expect(title).toHaveValue('Unbenannt'))
})

test('a second tab cannot be overwritten silently', async () => {
  const user = userEvent.setup()
  const { chapter, view } = await setup('alt')
  await updateChapter(chapter.id, { content: 'aus Tab B' })
  replaceAll(view, 'aus Tab A')
  expect(await screen.findByText('Dieses Kapitel wurde an anderer Stelle geändert.')).toBeInTheDocument()
  expect((await getChapter(chapter.id))!.content).toBe('aus Tab B')
  await user.click(screen.getByRole('button', { name: 'Andere Fassung laden' }))
  await waitFor(() => expect(view.state.doc.toString()).toBe('aus Tab B'))
  expect(screen.queryByText('Dieses Kapitel wurde an anderer Stelle geändert.')).not.toBeInTheDocument()
  expect((await getChapter(chapter.id))!.content).toBe('aus Tab B')
})

test('saving my version as a new chapter keeps both texts', async () => {
  const user = userEvent.setup()
  const { book, chapter, view } = await setup('alt')
  await updateChapter(chapter.id, { content: 'aus Tab B' })
  replaceAll(view, 'aus Tab A')
  await user.click(await screen.findByRole('button', { name: 'Meine als neues Kapitel sichern' }))
  await waitFor(async () => {
    const all = await listChapters(book.id)
    expect(all.map((c) => c.content).sort()).toEqual(['aus Tab A', 'aus Tab B'])
  })
  await waitFor(() => expect(view.state.doc.toString()).toBe('aus Tab B'))
})

test('picks up text changed elsewhere when the tab gets focus again', async () => {
  const { chapter, view } = await setup('alt')
  await updateChapter(chapter.id, { content: 'neu von woanders' })
  window.dispatchEvent(new Event('focus'))
  await waitFor(() => expect(view.state.doc.toString()).toBe('neu von woanders'))
  expect(screen.getByText('Gespeichert')).toBeInTheDocument()
})

test('follows a rename made in the sidebar', async () => {
  const book = await createBook('B')
  const chapter = await createChapter(book.id, 'Kapitel 1')
  const { rerender } = render(<Editor book={book} chapter={chapter} onChanged={() => {}} />)
  const renamed = await updateChapter(chapter.id, { title: 'Prolog' })
  rerender(<Editor book={book} chapter={renamed} onChanged={() => {}} />)
  await waitFor(() => expect(screen.getByLabelText('Kapiteltitel')).toHaveValue('Prolog'))
})

test('jumpTo selects and marks a range, also when it changes while open', async () => {
  const book = await createBook('B')
  const chapter = await createChapter(book.id, 'A', 'Eins Pascal zwei Pascal')
  const { rerender } = render(<Editor book={book} chapter={chapter} onChanged={() => {}} jumpTo={{ from: 5, to: 11, key: 1 }} />)
  const view = await waitFor(() => {
    const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)
    if (!found) throw new Error('not mounted')
    return found
  })
  // The cursor goes before the mention; the mention itself is only marked, so typing never replaces it.
  await waitFor(() => expect([view.state.selection.main.from, view.state.selection.main.to]).toEqual([5, 5]))
  expect(document.querySelector('.cm-mw-flash')?.textContent).toBe('Pascal')
  rerender(<Editor book={book} chapter={chapter} onChanged={() => {}} jumpTo={{ from: 17, to: 23, key: 2 }} />)
  await waitFor(() => expect([view.state.selection.main.from, view.state.selection.main.to]).toEqual([17, 17]))
  rerender(<Editor book={book} chapter={chapter} onChanged={() => {}} jumpTo={{ from: 900, to: 950, key: 3 }} />)
  await waitFor(() => expect(view.state.selection.main.from).toBe(view.state.doc.length))
})

test('Ctrl+Shift+H and the "Markieren" button highlight the selection and remove it again', async () => {
  const { view } = await setup('Ein Satz hier.')
  view.dispatch({ selection: { anchor: 4, head: 8 } })
  const handled = runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'H', code: 'KeyH', keyCode: 72, ctrlKey: true, shiftKey: true }), 'editor')
  expect(handled).toBe(true)
  expect(view.state.doc.toString()).toBe('Ein ==Satz== hier.')
  await userEvent.setup().click(screen.getByRole('button', { name: 'Markieren' }))
  expect(view.state.doc.toString()).toBe('Ein Satz hier.')
})

test('typing remembers the place in the book, also when the editor closes right away', async () => {
  const { book, chapter, view } = await setup('Ein Satz.')
  view.dispatch({ changes: { from: 9, insert: ' Noch einer.' }, selection: { anchor: 21 } })
  await waitFor(async () => expect((await getBook(book.id))!.place).toMatchObject({ chapterId: chapter.id, offset: 21 }), { timeout: 3000 })
})

test('the place is stored when the editor closes before the delay', async () => {
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang', 'abc')
  const { unmount } = render(<Editor book={book} chapter={chapter} onChanged={() => {}} />)
  const view = await waitFor(() => {
    const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)
    if (!found) throw new Error('not mounted')
    return found
  })
  view.dispatch({ changes: { from: 3, insert: 'd' }, selection: { anchor: 4 } })
  unmount()
  await waitFor(async () => expect((await getBook(book.id))!.place).toMatchObject({ chapterId: chapter.id, offset: 4 }))
})

test('the place is where text changed, not where the cursor went afterwards', async () => {
  const { book, chapter, view } = await setup('Ein Satz.')
  view.dispatch({ changes: { from: 9, insert: ' Noch einer.' }, selection: { anchor: 21 } })
  view.dispatch({ selection: { anchor: 0 } })
  await waitFor(async () => expect((await getBook(book.id))!.place).toMatchObject({ chapterId: chapter.id, offset: 21 }), { timeout: 3000 })
})

test('three typed dots become an ellipsis', async () => {
  const { view } = await setup('Und dann')
  view.dispatch({ selection: { anchor: 8 } })
  for (const dot of ['.', '.', '.']) {
    const { from, to } = view.state.selection.main
    const handled = view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, dot, () => view.state.update({ changes: { from, to, insert: dot } })))
    if (!handled) view.dispatch({ changes: { from, to, insert: dot }, selection: { anchor: from + 1 } })
  }
  expect(view.state.doc.toString()).toBe('Und dann…')
  expect(view.state.selection.main.head).toBe(9)
})

test('while typing, the line being written is kept in the middle of the screen', async () => {
  const { typewriter } = await import('./markdownSetup')
  const state = EditorState.create({ doc: 'abc', extensions: typewriter })
  const typed = state.update({ changes: { from: 3, insert: 'd' }, userEvent: 'input.type' })
  expect(typed.effects.length).toBe(1)
  const moved = state.update({ selection: { anchor: 1 }, userEvent: 'select.pointer' })
  expect(moved.effects.length).toBe(0)
})
