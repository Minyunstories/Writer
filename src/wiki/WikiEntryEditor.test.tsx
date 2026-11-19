import { EditorView } from '@codemirror/view'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { createBook, resetDatabaseForTests } from '../storage/db'
import * as wikiStorage from '../storage/wiki'
import { createEntry, createFolder, getEntry, getImage, listFolders, updateEntry } from '../storage/wiki'
import { WikiEntryEditor } from './WikiEntryEditor'

const prepare = vi.fn(async () => ({ type: 'image/webp', data: new Uint8Array([1, 2, 3]).buffer, width: 4, height: 2 }))

async function setup(name = 'Pascal') {
  const book = await createBook('B')
  const folder = await createFolder(book.id, 'Personen')
  const entry = await createEntry(book.id, name)
  const onChanged = vi.fn()
  const onDeleted = vi.fn()
  const onSaveFailed = vi.fn()
  const utils = render(
    <WikiEntryEditor
      entryId={entry.id}
      folders={await listFolders(book.id)}
      zoomArea="wiki"
      onChanged={onChanged}
      onDeleted={onDeleted}
      onSaveFailed={onSaveFailed}
      prepare={prepare}
    />,
  )
  await screen.findByLabelText('Name')
  return { book, folder, entry, onChanged, onDeleted, onSaveFailed, user: userEvent.setup(), ...utils }
}

beforeEach(async () => {
  await resetDatabaseForTests()
  localStorage.clear()
  prepare.mockClear()
})

test('typing a name saves it and reports the change', async () => {
  const { entry, user, onChanged } = await setup()
  const name = screen.getByLabelText('Name')
  expect(name).toHaveValue('Pascal')
  await user.clear(name)
  await user.type(name, 'Prinz')
  await waitFor(async () => expect((await getEntry(entry.id))!.name).toBe('Prinz'))
  await waitFor(() => expect(onChanged).toHaveBeenCalled())
})

test('aliases are added with Enter and can be removed', async () => {
  const { entry, user } = await setup()
  await user.type(screen.getByLabelText('Auch bekannt als'), 'Nys{Enter}the Heir{Enter}')
  await waitFor(async () => expect((await getEntry(entry.id))!.aliases).toEqual(['Nys', 'the Heir']))
  await user.click(screen.getByRole('button', { name: '„Nys" entfernen' }))
  await waitFor(async () => expect((await getEntry(entry.id))!.aliases).toEqual(['the Heir']))
})

test('properties can be added, edited and removed', async () => {
  const { entry, user } = await setup()
  await user.click(screen.getByRole('button', { name: 'Eigenschaft hinzufügen' }))
  await user.type(screen.getByLabelText('Eigenschaft'), 'Augenfarbe')
  await user.type(screen.getByLabelText('Wert'), 'grün')
  await waitFor(async () =>
    expect((await getEntry(entry.id))!.properties.map((p) => [p.key, p.value])).toEqual([['Augenfarbe', 'grün']]),
  )
  await user.click(screen.getByRole('button', { name: 'Eigenschaft entfernen' }))
  await waitFor(async () => expect((await getEntry(entry.id))!.properties).toEqual([]))
})

test('the auto-link switch and the folder are stored', async () => {
  const { entry, folder, user } = await setup()
  const box = screen.getByLabelText('Im Text automatisch verlinken')
  expect(box).toBeChecked()
  await user.click(box)
  await user.selectOptions(screen.getByLabelText('Ordner'), 'Personen')
  await waitFor(async () => {
    const stored = (await getEntry(entry.id))!
    expect(stored.autoLink).toBe(false)
    expect(stored.folderId).toBe(folder.id)
  })
})

test('notes are stored', async () => {
  const { entry } = await setup()
  const view = await waitFor(() => {
    const found = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-editor')!)
    if (!found) throw new Error('not mounted')
    return found
  })
  view.dispatch({ changes: { from: 0, insert: 'Trägt immer **Grün**.' } })
  await waitFor(async () => expect((await getEntry(entry.id))!.body).toBe('Trägt immer **Grün**.'))
})

test('images can be attached and removed', async () => {
  const { entry, user } = await setup()
  const file = new File(['x'], 'pascal.png', { type: 'image/png' })
  await user.upload(screen.getByLabelText('Bild hinzufügen'), file)
  const figure = await screen.findByRole('img', { name: 'Bild 1 von Pascal' })
  expect(prepare).toHaveBeenCalledWith(file)
  const [imageId] = (await getEntry(entry.id))!.imageIds
  expect((await getImage(imageId))!.width).toBe(4)
  await user.click(within(figure.closest('li')!).getByRole('button', { name: 'Bild entfernen' }))
  expect(screen.getByText('Bild wirklich löschen?')).toBeInTheDocument()
  expect((await getEntry(entry.id))!.imageIds).toEqual([imageId])
  await user.click(screen.getByRole('button', { name: 'Bild löschen' }))
  await waitFor(async () => expect((await getEntry(entry.id))!.imageIds).toEqual([]))
  expect(await getImage(imageId)).toBeUndefined()
})

test('an unreadable image is reported', async () => {
  const { user } = await setup()
  prepare.mockRejectedValueOnce(new Error('decode'))
  await user.upload(screen.getByLabelText('Bild hinzufügen'), new File(['x'], 'kaputt.png', { type: 'image/png' }))
  expect(await screen.findByText('Das Bild konnte nicht gelesen werden.')).toBeInTheDocument()
})

test('deleting asks first and puts the entry in the trash', async () => {
  const { listTrash } = await import('../storage/trash')
  const { entry, user, onDeleted } = await setup()
  await user.click(screen.getByRole('button', { name: 'Eintrag löschen' }))
  expect(screen.getByText('Eintrag „Pascal" in den Papierkorb legen?')).toBeInTheDocument()
  expect(screen.getByText('Dort kannst du ihn 30 Tage lang wiederherstellen.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'In den Papierkorb' }))
  await waitFor(() => expect(onDeleted).toHaveBeenCalled())
  expect(await getEntry(entry.id)).toBeUndefined()
  expect((await listTrash(entry.bookId)).map((item) => item.title)).toEqual(['Pascal'])
})

test('unmounting right after typing still saves', async () => {
  const { entry, user, unmount } = await setup()
  await user.type(screen.getByLabelText('Name'), 'ssin')
  unmount()
  await waitFor(async () => expect((await getEntry(entry.id))!.name).toBe('Pascalssin'), { timeout: 200 })
})

test('an empty name shows Unbenannt after leaving the field', async () => {
  const { user } = await setup()
  const name = screen.getByLabelText('Name')
  await user.clear(name)
  await user.tab()
  await waitFor(() => expect(name).toHaveValue('Unbenannt'))
})

test('a slow failing save never overwrites newer text', async () => {
  const { entry, user } = await setup()
  const real = updateEntry
  let calls = 0
  const spy = vi.spyOn(wikiStorage, 'updateEntry').mockImplementation(async (...args) => {
    if (++calls === 1) {
      await new Promise((resolve) => setTimeout(resolve, 600))
      throw new Error('slow failure')
    }
    return real(...args)
  })
  const name = screen.getByLabelText('Name')
  await user.clear(name)
  await user.type(name, 'Erste')
  await waitFor(() => expect(calls).toBe(1), { timeout: 1000 })
  await user.clear(name)
  await user.type(name, 'Zweite')
  await waitFor(async () => expect((await getEntry(entry.id))!.name).toBe('Zweite'), { timeout: 3000 })
  await new Promise((resolve) => setTimeout(resolve, 2300))
  expect((await getEntry(entry.id))!.name).toBe('Zweite')
  spy.mockRestore()
}, 10000)

test('a save that fails after closing is reported to the parent', async () => {
  const { user, unmount, onSaveFailed } = await setup()
  const spy = vi.spyOn(wikiStorage, 'updateEntry').mockRejectedValueOnce(new Error('quota'))
  await user.type(screen.getByLabelText('Name'), 'x')
  unmount()
  await waitFor(() => expect(onSaveFailed).toHaveBeenCalled())
  spy.mockRestore()
})

test('Backspace in the empty alias field does not delete aliases', async () => {
  const { entry, user } = await setup()
  const field = screen.getByLabelText('Auch bekannt als')
  await user.type(field, 'Nys{Enter}')
  await user.type(field, '{Backspace}{Backspace}')
  await new Promise((resolve) => setTimeout(resolve, 600))
  expect((await getEntry(entry.id))!.aliases).toEqual(['Nys'])
})

test('after a sync run the entry shows what was pulled, notes included', async () => {
  const { entry } = await setup()
  await updateEntry(entry.id, { name: 'Prinz', body: 'vom anderen Gerät' })
  window.dispatchEvent(new Event('mw:synced'))
  await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Prinz'))
  await waitFor(() => expect(screen.getByLabelText('Notizen')).toHaveTextContent('vom anderen Gerät'))
})

test('an entry changed elsewhere while typing here is not overwritten; my version becomes its own entry', async () => {
  const { book, entry, user } = await setup()
  const name = screen.getByLabelText('Name')
  await updateEntry(entry.id, { body: 'vom anderen Gerät', aliases: ['Nys'] })
  await user.type(name, 'ss')
  expect(await screen.findByText(/an anderer Stelle geändert/)).toBeInTheDocument()
  const all = await wikiStorage.listEntries(book.id)
  expect(all.map((e) => [e.name, e.body, e.aliases, e.autoLink])).toEqual([
    ['Pascal', 'vom anderen Gerät', ['Nys'], true],
    ['Pascalss (meine Fassung)', '', [], false],
  ])
  await waitFor(() => expect(name).toHaveValue('Pascal'))
  await waitFor(() => expect(screen.getByLabelText('Notizen')).toHaveTextContent('vom anderen Gerät'))
})

test('the first image is the portrait beside the name; another image can take its place', async () => {
  const { entry, user } = await setup()
  await user.upload(screen.getByLabelText('Bild hinzufügen'), [new File(['x'], 'a.png', { type: 'image/png' }), new File(['y'], 'b.png', { type: 'image/png' })])
  await screen.findByRole('img', { name: 'Bild 2 von Pascal' })
  expect(screen.getByRole('img', { name: 'Porträt von Pascal' })).toBeInTheDocument()
  const [first, second] = (await getEntry(entry.id))!.imageIds
  const secondItem = screen.getByRole('img', { name: 'Bild 2 von Pascal' }).closest('li')!
  await user.click(within(secondItem).getByRole('button', { name: 'Als Porträt' }))
  await waitFor(async () => expect((await getEntry(entry.id))!.imageIds).toEqual([second, first]))
  expect(within(screen.getByRole('img', { name: 'Bild 1 von Pascal' }).closest('li')!).getByText('Porträt')).toBeInTheDocument()
})
