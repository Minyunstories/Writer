import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BookView } from '../book/BookView'
import { drawerModules } from '../modules/modules'
import { createBook, createChapter, getBook, resetDatabaseForTests } from '../storage/db'
import { setModule } from '../storage/modules'
import { addStamp, createSketch } from '../storage/sketches'
import { createEntry } from '../storage/wiki'
import { sketchesOf } from './sketchesOf'

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>Dashboard</p>} />
        <Route path="/book/:bookId/:section?/:itemId?" element={<BookView />} />
      </Routes>
      <Location />
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  await resetDatabaseForTests()
  localStorage.clear()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('sketches have no drawer tab: alone they bring no module button', async () => {
  expect(drawerModules({ modules: { sketches: true, address: true } })).toEqual(['address'])
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang')
  await setModule(book.id, 'sketches', true)
  renderAt(`/book/${book.id}/chapters/${chapter.id}`)
  await screen.findByRole('button', { name: /^Notizblock/ })
  expect(screen.queryByRole('button', { name: 'Skizzen' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Module' })).not.toBeInTheDocument()
})

test('the Skizzen tab in the right panel appears only with the module; sketches are created, renamed and deleted there', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  const first = renderAt(`/book/${book.id}`)
  await user.click(await screen.findByRole('button', { name: /^Notizblock/ }))
  await screen.findByRole('tab', { name: 'Notizen' })
  expect(screen.queryByRole('tab', { name: 'Skizzen' })).not.toBeInTheDocument()
  first.unmount()

  await setModule(book.id, 'sketches', true)
  renderAt(`/book/${book.id}`)
  await user.click(await screen.findByRole('button', { name: /^Notizblock/ }))
  await user.click(await screen.findByRole('tab', { name: 'Skizzen' }))
  const panel = await screen.findByRole('complementary', { name: 'Skizzen' })
  await user.click(within(panel).getByRole('button', { name: 'Neue Skizze' }))
  await user.type(within(screen.getByRole('dialog', { name: 'Neue Skizze' })).getByRole('textbox'), 'Landkarte')
  await user.click(screen.getByRole('button', { name: 'Anlegen' }))
  await within(panel).findByRole('group', { name: 'Skizze Landkarte' })
  expect((await getBook(book.id))!.sketches!.map((sketch) => sketch.name)).toEqual(['Landkarte'])

  await user.click(within(panel).getByRole('button', { name: 'Umbenennen' }))
  const rename = screen.getByRole('dialog', { name: 'Skizze umbenennen' })
  await user.clear(within(rename).getByRole('textbox'))
  await user.type(within(rename).getByRole('textbox'), 'Burg')
  await user.click(within(rename).getByRole('button', { name: 'Umbenennen' }))
  await within(panel).findByRole('group', { name: 'Skizze Burg' })

  await user.click(within(panel).getByRole('button', { name: 'Löschen' }))
  expect(screen.getByText('Skizze löschen?')).toBeInTheDocument()
  await user.click(within(screen.getByRole('alertdialog', { name: 'Skizze löschen?' })).getByRole('button', { name: 'Löschen' }))
  await within(panel).findByText('Noch keine Skizzen.')
  expect((await getBook(book.id))!.sketches).toBeUndefined()
})

test('Vergrößern lays the panel over the whole book, Verkleinern puts it back', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  await setModule(book.id, 'sketches', true)
  await createSketch(book.id, 'Landkarte')
  renderAt(`/book/${book.id}`)
  await user.click(await screen.findByRole('button', { name: /^Notizblock/ }))
  await user.click(await screen.findByRole('tab', { name: 'Skizzen' }))
  const panel = await screen.findByRole('complementary', { name: 'Skizzen' })
  expect(panel).not.toHaveClass('wide')
  await user.click(within(panel).getByRole('button', { name: 'Vergrößern' }))
  expect(panel).toHaveClass('wide')
  await user.click(within(panel).getByRole('button', { name: 'Verkleinern' }))
  expect(panel).not.toHaveClass('wide')
})

test('the wiki home has a Skizzen tab with the module, showing the sketches', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  await createEntry(book.id, 'Lea')
  await createSketch(book.id, 'Landkarte')
  await createSketch(book.id, 'Burg')
  const first = renderAt(`/book/${book.id}/wiki`)
  await screen.findByRole('tab', { name: 'Übersicht' })
  expect(screen.queryByRole('tab', { name: 'Skizzen' })).not.toBeInTheDocument()
  first.unmount()
  await setModule(book.id, 'sketches', true)
  renderAt(`/book/${book.id}/wiki`)
  await user.click(await screen.findByRole('tab', { name: 'Skizzen' }))
  const choice = await screen.findByRole('combobox', { name: 'Skizze' })
  expect([...choice.querySelectorAll('option')].map((option) => option.textContent)).toEqual(['Landkarte', 'Burg'])
  fireEvent.change(choice, { target: { value: (await getBook(book.id))!.sketches![1].id } })
  await screen.findByRole('group', { name: 'Skizze Burg' })
})

test('a wiki entry lists the sketches it is stamped on; a click opens the sketch on the wiki page', async () => {
  const user = userEvent.setup()
  const book = await createBook('Sturmlied')
  await setModule(book.id, 'sketches', true)
  const lea = await createEntry(book.id, 'Lea')
  const tom = await createEntry(book.id, 'Tom')
  await createSketch(book.id, 'Leer')
  const map = await createSketch(book.id, 'Landkarte')
  await addStamp(book.id, map.id, { stamp: 'builtin:house', x: 300, y: 200, size: 2, color: '#fff', entryId: lea.id })
  // Far away, so "everything in view" would not put the linked stamp in the middle.
  await addStamp(book.id, map.id, { stamp: 'builtin:tree', x: 3000, y: 2000, size: 2, color: '#fff' })
  expect(sketchesOf((await getBook(book.id))!, lea.id).map((hit) => hit.sketch.name)).toEqual(['Landkarte'])
  expect(sketchesOf((await getBook(book.id))!, tom.id)).toEqual([])

  renderAt(`/book/${book.id}/wiki/${lea.id}`)
  const section = await screen.findByRole('region', { name: 'Auf Skizzen' })
  await user.click(within(section).getByRole('button', { name: 'Landkarte' }))
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/book/${book.id}/wiki`))
  expect(screen.getByTestId('location').textContent).toBe(`/book/${book.id}/wiki`)
  expect(await screen.findByRole('tab', { name: 'Skizzen' })).toHaveAttribute('aria-selected', 'true')
  const canvas = await screen.findByRole('group', { name: 'Skizze Landkarte' })
  // The stamp is in the middle of the 800 × 600 canvas.
  expect(canvas.querySelector('.sketch-world')!.getAttribute('transform')).toBe('translate(100 100) scale(1)')
})
