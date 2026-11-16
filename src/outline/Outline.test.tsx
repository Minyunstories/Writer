import { EditorView } from '@codemirror/view'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { createBook, createChapter, getBook, getChapter, listChapters, resetDatabaseForTests, updateChapter } from '../storage/db'
import type { Book } from '../types'
import { Outline } from './Outline'

async function setup(titles = ['Anfang', 'Sturm', 'Ende']) {
  const created = await createBook('Sturmlied')
  for (const title of titles) await createChapter(created.id, title)
  const onError = vi.fn()
  const onCreateChapter = vi.fn()

  const load = async () => ({ book: (await getBook(created.id)) as Book, chapters: await listChapters(created.id) })
  let state = await load()
  const ui = () => (
    <MemoryRouter>
      <Outline
        book={state.book}
        chapters={state.chapters}
        onChanged={refresh}
        onError={onError}
        onCreateChapter={onCreateChapter}
      />
    </MemoryRouter>
  )
  async function refresh() {
    state = await load()
    if (utils.container.isConnected) utils.rerender(ui())
  }
  const utils = render(ui())
  for (const title of titles) await screen.findByLabelText(`Notizen zu ${title}`)
  return { book: created, chapters: state.chapters, onError, onCreateChapter, refresh, user: userEvent.setup(), ...utils }
}

function noteView(title: string): EditorView {
  const content = screen.getByLabelText(`Notizen zu ${title}`)
  const view = EditorView.findFromDOM(content.closest<HTMLElement>('.cm-editor')!)
  if (!view) throw new Error('note editor not mounted')
  return view
}

const type = (title: string, text: string) => {
  const view = noteView(title)
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
}

const order = () => screen.getAllByRole('listitem').map((item) => within(item).getByRole('link').textContent)

beforeEach(async () => {
  await resetDatabaseForTests()
  localStorage.clear()
})

test('cards appear in order with links and word counts', async () => {
  const book = await createBook('Sturmlied')
  const a = await createChapter(book.id, 'Anfang', 'eins zwei drei')
  const b = await createChapter(book.id, 'Sturm')
  render(
    <MemoryRouter>
      <Outline
        book={(await getBook(book.id))!}
        chapters={await listChapters(book.id)}
        onChanged={() => {}}
        onError={() => {}}
        onCreateChapter={() => {}}
      />
    </MemoryRouter>,
  )
  await screen.findByLabelText('Notizen zu Sturm')
  expect(order()).toEqual(['Anfang', 'Sturm'])
  expect(screen.getByRole('link', { name: 'Anfang' })).toHaveAttribute('href', `/book/${book.id}/chapters/${a.id}`)
  expect(screen.getByRole('link', { name: 'Sturm' })).toHaveAttribute('href', `/book/${book.id}/chapters/${b.id}`)
  const [first, second] = screen.getAllByRole('listitem')
  expect(within(first).getByText('3 Wörter')).toBeInTheDocument()
  expect(within(second).getByText('0 Wörter')).toBeInTheDocument()
})

test('a note is stored on its chapter only', async () => {
  const { chapters } = await setup()
  type('Sturm', 'Es regnet. **Kalt.**')
  await waitFor(async () => expect((await getChapter(chapters[1].id))!.outline).toBe('Es regnet. **Kalt.**'))
  expect((await getChapter(chapters[0].id))!.outline).toBe('')
  expect((await getChapter(chapters[1].id))!.content).toBe('')
})

test('existing notes are shown', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, 'Anfang')
  await updateChapter(a.id, { outline: 'Nebel am Morgen' })
  render(
    <MemoryRouter>
      <Outline
        book={(await getBook(book.id))!}
        chapters={await listChapters(book.id)}
        onChanged={() => {}}
        onError={() => {}}
        onCreateChapter={() => {}}
      />
    </MemoryRouter>,
  )
  await screen.findByLabelText('Notizen zu Anfang')
  expect(noteView('Anfang').state.doc.toString()).toBe('Nebel am Morgen')
})

test('buttons move chapters; the ends are disabled', async () => {
  const { book, chapters, user } = await setup()
  expect(screen.getByRole('button', { name: 'Anfang nach oben' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Ende nach unten' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Anfang nach unten' }))
  await waitFor(() => expect(order()).toEqual(['Sturm', 'Anfang', 'Ende']))
  expect((await getBook(book.id))!.chapterOrder).toEqual([chapters[1].id, chapters[0].id, chapters[2].id])
  await user.click(screen.getByRole('button', { name: 'Ende nach oben' }))
  await waitFor(() => expect(order()).toEqual(['Sturm', 'Ende', 'Anfang']))
})

test('a note typed just before reordering stays with its chapter', async () => {
  const { chapters, user } = await setup()
  type('Anfang', 'frisch getippt')
  await user.click(screen.getByRole('button', { name: 'Anfang nach unten' }))
  await waitFor(() => expect(order()).toEqual(['Sturm', 'Anfang', 'Ende']))
  await waitFor(async () => expect((await getChapter(chapters[0].id))!.outline).toBe('frisch getippt'))
  expect(noteView('Anfang').state.doc.toString()).toBe('frisch getippt')
  expect(noteView('Sturm').state.doc.toString()).toBe('')
})

test('a reload from the parent does not reset a note being typed', async () => {
  const { refresh } = await setup()
  type('Sturm', 'mitten im Satz')
  await refresh()
  expect(noteView('Sturm').state.doc.toString()).toBe('mitten im Satz')
})

test('dragging a card onto another moves it there', async () => {
  const { book, chapters } = await setup()
  const items = screen.getAllByRole('listitem')
  fireEvent.dragStart(within(items[2]).getByTitle('Ziehen zum Umsortieren'))
  fireEvent.dragOver(items[0])
  fireEvent.drop(items[0])
  await waitFor(() => expect(order()).toEqual(['Ende', 'Anfang', 'Sturm']))
  expect((await getBook(book.id))!.chapterOrder).toEqual([chapters[2].id, chapters[0].id, chapters[1].id])
})

test('an empty book offers to create the first chapter', async () => {
  const { user, onCreateChapter } = await setup([])
  expect(screen.getByText('Noch keine Kapitel')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Erstes Kapitel anlegen' }))
  expect(onCreateChapter).toHaveBeenCalled()
})

test('dropping a card on a note field reorders without inserting text into the note', async () => {
  await setup()
  const items = screen.getAllByRole('listitem')
  const store = new Map<string, string>()
  const dataTransfer = {
    setData: (type: string, value: string) => void store.set(type, value),
    getData: (type: string) => store.get(type === 'Text' ? 'text/plain' : type) ?? '',
    get types() {
      return [...store.keys()]
    },
    files: [],
    dropEffect: 'move',
    effectAllowed: 'all',
  }
  fireEvent.dragStart(within(items[2]).getByTitle('Ziehen zum Umsortieren'), { dataTransfer })
  expect(store.has('text/plain')).toBe(false)
  const target = screen.getByLabelText('Notizen zu Anfang')
  fireEvent.dragOver(target, { dataTransfer })
  const notPrevented = fireEvent.drop(target, { dataTransfer })
  expect(notPrevented).toBe(false)
  await waitFor(() => expect(order()).toEqual(['Ende', 'Anfang', 'Sturm']))
  expect(noteView('Anfang').state.doc.toString()).toBe('')
})

test('a card shows the stored note even when the list it was given is outdated', async () => {
  const book = await createBook('B')
  const a = await createChapter(book.id, 'Anfang')
  const outdated = await listChapters(book.id)
  await updateChapter(a.id, { outline: 'Regen' })
  render(
    <MemoryRouter>
      <Outline book={(await getBook(book.id))!} chapters={outdated} onChanged={() => {}} onError={() => {}} onCreateChapter={() => {}} />
    </MemoryRouter>,
  )
  await screen.findByLabelText('Notizen zu Anfang')
  expect(noteView('Anfang').state.doc.toString()).toBe('Regen')
})

test('a note changed in another tab is never overwritten silently', async () => {
  const { chapters, user } = await setup(['Anfang'])
  await updateChapter(chapters[0].id, { outline: 'aus Tab B' })
  type('Anfang', 'aus Tab A')
  expect(await screen.findByText('Diese Notiz wurde an anderer Stelle geändert.')).toBeInTheDocument()
  expect((await getChapter(chapters[0].id))!.outline).toBe('aus Tab B')
  await user.click(screen.getByRole('button', { name: 'Andere Fassung laden' }))
  await waitFor(() => expect(noteView('Anfang').state.doc.toString()).toBe('aus Tab B'))
  expect(screen.queryByText('Diese Notiz wurde an anderer Stelle geändert.')).not.toBeInTheDocument()
})

test('keeping my note after a conflict stores it', async () => {
  const { chapters, user } = await setup(['Anfang'])
  await updateChapter(chapters[0].id, { outline: 'aus Tab B' })
  type('Anfang', 'aus Tab A')
  await user.click(await screen.findByRole('button', { name: 'Meine Fassung behalten' }))
  await waitFor(async () => expect((await getChapter(chapters[0].id))!.outline).toBe('aus Tab A'))
  type('Anfang', 'aus Tab A und mehr')
  await waitFor(async () => expect((await getChapter(chapters[0].id))!.outline).toBe('aus Tab A und mehr'))
})

test('a note changed elsewhere is picked up when the tab gets focus again', async () => {
  const { chapters } = await setup(['Anfang'])
  await updateChapter(chapters[0].id, { outline: 'neu von woanders' })
  window.dispatchEvent(new Event('focus'))
  await waitFor(() => expect(noteView('Anfang').state.doc.toString()).toBe('neu von woanders'))
})

test('move buttons are locked while a move is running, and screen and storage agree afterwards', async () => {
  const { book, user } = await setup()
  const down = screen.getByRole('button', { name: 'Anfang nach unten' })
  const up = screen.getByRole('button', { name: 'Ende nach oben' })
  const first = user.click(down)
  await waitFor(() => expect(up).toBeDisabled())
  await first
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ende nach oben' })).toBeEnabled())
  const stored = (await listChapters(book.id)).map((c) => c.title)
  expect(order()).toEqual(stored)
  expect(stored).toEqual(['Sturm', 'Anfang', 'Ende'])
})
