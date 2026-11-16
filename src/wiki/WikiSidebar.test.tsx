import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test } from 'vitest'
import { createBook, getBook, resetDatabaseForTests } from '../storage/db'
import { createEntry, createFolder, getEntry, listEntries, listFolders, moveWikiItem, stepWikiItem } from '../storage/wiki'
import { WikiSidebar } from './WikiSidebar'

async function setup() {
  const book = await createBook('B')
  const orte = await createFolder(book.id, 'Orte')
  const leute = await createFolder(book.id, 'Leute')
  const hafen = await createEntry(book.id, 'Hafen', orte.id)
  const anna = await createEntry(book.id, 'Anna')
  const ben = await createEntry(book.id, 'Ben')
  const load = async () => ({ book: (await getBook(book.id))!, folders: await listFolders(book.id), entries: await listEntries(book.id) })
  let state = await load()
  const ui = () => (
    <MemoryRouter>
      <WikiSidebar
        bookId={book.id}
        folders={state.folders}
        entries={state.entries}
        order={state.book.wikiOrder}
        onNavigate={() => {}}
        onCreateFolder={() => {}}
        onCreateEntry={() => {}}
        onRenameFolder={() => {}}
        onDeleteFolder={() => {}}
        onMove={async (item, target) => {
          await moveWikiItem(book.id, item, target)
          await refresh()
        }}
        onStep={async (item, direction) => {
          await stepWikiItem(book.id, item, direction)
          await refresh()
        }}
      />
    </MemoryRouter>
  )
  async function refresh() {
    state = await load()
    if (utils.container.isConnected) utils.rerender(ui())
  }
  const utils = render(ui())
  return { book, orte, leute, hafen, anna, ben, user: userEvent.setup() }
}

/** Names in the order shown, folders and entries alike. */
const shown = () => [...document.querySelectorAll('.wiki-tree-name, .wiki-tree-entry a')].map((node) => node.textContent)

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('the tree follows the stored order; "Anordnen" shows arrows that move items and are kept', async () => {
  const { anna, user } = await setup()
  expect(shown()).toEqual(['Orte', 'Hafen', 'Leute', 'Anna', 'Ben'])
  expect(screen.queryByRole('button', { name: 'Ben nach oben' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Anordnen' }))
  expect(screen.getByRole('button', { name: 'Anna nach oben' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Ben nach unten' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Ben nach oben' }))
  await waitFor(() => expect(shown()).toEqual(['Orte', 'Hafen', 'Leute', 'Ben', 'Anna']))
  await user.click(screen.getByRole('button', { name: 'Orte nach unten' }))
  await waitFor(() => expect(shown()).toEqual(['Leute', 'Orte', 'Hafen', 'Ben', 'Anna']))
  await user.click(screen.getByRole('button', { name: 'Fertig' }))
  expect(screen.queryByRole('button', { name: 'Anna nach oben' })).not.toBeInTheDocument()
  expect((await getEntry(anna.id))!.folderId).toBeNull()
})

function drag(source: Element, target: Element) {
  const data = new Map<string, string>()
  const dataTransfer = {
    setData: (type: string, value: string) => data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    get types() {
      return [...data.keys()]
    },
    effectAllowed: 'all',
    dropEffect: 'move',
  }
  fireEvent.dragStart(source, { dataTransfer })
  fireEvent.dragOver(target, { dataTransfer })
  fireEvent.drop(target, { dataTransfer })
  fireEvent.dragEnd(source, { dataTransfer })
}

test('dragging: onto a folder moves inside, onto an entry places before it; never into its own subfolder', async () => {
  const { orte, leute, anna, ben } = await setup()
  const row = (name: string) => screen.getByText(name).closest('[draggable]')!
  drag(row('Ben'), row('Leute'))
  await waitFor(async () => expect((await getEntry(ben.id))!.folderId).toBe(leute.id))
  await waitFor(() => expect(shown()).toEqual(['Orte', 'Hafen', 'Leute', 'Ben', 'Anna']))
  drag(row('Anna'), row('Hafen'))
  await waitFor(async () => expect((await getEntry(anna.id))!.folderId).toBe(orte.id))
  await waitFor(() => expect(shown()).toEqual(['Orte', 'Anna', 'Hafen', 'Leute', 'Ben']))
  drag(row('Leute'), row('Orte'))
  await waitFor(async () => expect((await listFolders(leute.bookId)).find((f) => f.id === leute.id)!.parentId).toBe(orte.id))
  drag(row('Orte'), row('Leute'))
  await new Promise((resolve) => setTimeout(resolve, 50))
  expect((await listFolders(orte.bookId)).find((f) => f.id === orte.id)!.parentId).toBeNull()
  expect(within(document.querySelector('.wiki-tree')!).getAllByText(/Orte|Leute/)).toHaveLength(2)
})
