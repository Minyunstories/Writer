import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { createBook, createChapter, listChapters, resetDatabaseForTests } from '../storage/db'
import { createEntry, createFolder, getEntry, listEntries, listFolders, setFolderTemplate, updateEntry } from '../storage/wiki'
import type { WikiEntry } from '../types'
import { WikiEntryEditor } from './WikiEntryEditor'

async function setup(prepareEntry?: (ids: { pascal: WikiEntry; elena: WikiEntry }) => Promise<void>, which: 'pascal' | 'ghost' = 'pascal') {
  const book = await createBook('B')
  const chars = await createFolder(book.id, 'Characters')
  await setFolderTemplate(chars.id, ['Augenfarbe', 'Alter'])
  const royals = await createFolder(book.id, 'Royals', chars.id)
  const pascal = await createEntry(book.id, 'Pascal', royals.id)
  const elena = await createEntry(book.id, 'Elena', chars.id)
  const ghost = await createEntry(book.id, 'Geist')
  await prepareEntry?.({ pascal, elena })
  const c1 = await createChapter(book.id, 'Anfang', 'Pascal sah Elena.')
  await createChapter(book.id, 'Sturm', 'Nichts.')
  const c3 = await createChapter(book.id, 'Ende', 'Wieder Pascal. Und Pascal.')
  const onOpenEntry = vi.fn()
  const onOpenChapter = vi.fn()
  const load = async () => ({ folders: await listFolders(book.id), entries: await listEntries(book.id), chapters: await listChapters(book.id) })
  let state = await load()
  const ui = () => (
    <WikiEntryEditor
      entryId={which === 'pascal' ? pascal.id : ghost.id}
      folders={state.folders}
      entries={state.entries}
      chapters={state.chapters}
      zoomArea="wiki"
      onChanged={() => void refresh()}
      onDeleted={() => {}}
      onOpenEntry={onOpenEntry}
      onOpenChapter={onOpenChapter}
    />
  )
  async function refresh() {
    state = await load()
    utils.rerender(ui())
  }
  const utils = render(ui())
  await screen.findByLabelText('Name')
  return { book, chars, pascal, elena, c1, c3, onOpenEntry, onOpenChapter, user: userEvent.setup() }
}

beforeEach(async () => {
  await resetDatabaseForTests()
  localStorage.clear()
})

test('template fields of the top-level folder appear and store a value when typed', async () => {
  const { pascal, user } = await setup()
  const eyes = screen.getByLabelText('Augenfarbe')
  expect(eyes).toHaveValue('')
  expect(screen.getByLabelText('Alter')).toHaveValue('')
  expect((await getEntry(pascal.id))!.properties).toEqual([])
  await user.type(eyes, 'grün')
  await waitFor(async () => expect((await getEntry(pascal.id))!.properties.map((p) => [p.key, p.value])).toEqual([['Augenfarbe', 'grün']]))
})

test('pinning an own field adds it to the folder template; unpinning keeps the value', async () => {
  const { chars, pascal, user } = await setup()
  await user.click(screen.getByRole('button', { name: 'Eigenschaft hinzufügen' }))
  await user.type(screen.getByLabelText('Eigenschaft'), 'Größe')
  await user.type(screen.getByLabelText('Wert'), '1,80')
  const pin = screen.getByRole('button', { name: 'Feld für alle Einträge in „Characters"', pressed: false })
  await user.click(pin)
  await waitFor(async () => expect((await listFolders(chars.bookId)).find((f) => f.id === chars.id)!.template).toEqual(['Augenfarbe', 'Alter', 'Größe']))
  await waitFor(() => expect(screen.getByLabelText('Größe')).toHaveValue('1,80'))

  const row = screen.getByLabelText('Größe').closest('li')!
  await user.click(within(row).getByRole('button', { name: 'Feld für alle Einträge in „Characters"', pressed: true }))
  await waitFor(async () => expect((await listFolders(chars.bookId)).find((f) => f.id === chars.id)!.template).toEqual(['Augenfarbe', 'Alter']))
  await waitFor(() => expect(screen.getByLabelText('Eigenschaft')).toHaveValue('Größe'))
  await waitFor(async () => expect((await getEntry(pascal.id))!.properties.map((p) => [p.key, p.value])).toEqual([['Größe', '1,80']]))
})

test('names of other entries in the notes are links; the own name is not', async () => {
  const { elena, onOpenEntry } = await setup(async ({ pascal }) => {
    await updateEntry(pascal.id, { body: 'Pascal ist der Sohn von Elena.' })
  })
  const links = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('.markdown-field .cm-mw-link')]
    if (found.length === 0) throw new Error('no links yet')
    return found
  })
  expect(links.map((link) => link.textContent)).toEqual(['Elena'])
  fireEvent.click(links[0])
  expect(onOpenEntry).toHaveBeenCalledWith(elena.id)
})

test('a property value naming another entry shows a link until it is edited', async () => {
  const { elena, onOpenEntry, user } = await setup(async ({ pascal }) => {
    await updateEntry(pascal.id, { properties: [{ id: 'p1', key: 'Mutter', value: 'Königin Elena' }] })
  })
  await user.click(screen.getByRole('button', { name: 'Elena' }))
  expect(onOpenEntry).toHaveBeenCalledWith(elena.id)
  await user.click(screen.getByText('Königin', { exact: false }))
  expect(screen.getByLabelText('Wert')).toHaveValue('Königin Elena')
  expect(screen.getByLabelText('Wert')).toHaveFocus()
})

test('"Erwähnt in" lists chapters with counts; a click jumps to the first mention', async () => {
  const { c1, c3, onOpenChapter, user } = await setup()
  const list = screen.getByRole('list', { name: 'Erwähnt in' })
  expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual(['1Anfang1×', '3Ende2×'])
  await user.click(within(list).getByRole('button', { name: /Ende/ }))
  expect(onOpenChapter).toHaveBeenCalledWith(c3.id, { from: 7, to: 13 })
  void c1
})

test('an entry mentioned nowhere says so', async () => {
  await setup(undefined, 'ghost')
  expect(screen.getByText('Noch in keinem Kapitel erwähnt')).toBeInTheDocument()
})

test('typing a value that turns into a link keeps every keystroke', async () => {
  const { pascal, user } = await setup()
  await user.click(screen.getByRole('button', { name: 'Eigenschaft hinzufügen' }))
  await user.type(screen.getByLabelText('Eigenschaft'), 'Schwester')
  await user.type(screen.getByLabelText('Wert'), 'wie Elenas Mutter')
  await waitFor(async () => expect((await getEntry(pascal.id))!.properties.map((p) => p.value)).toEqual(['wie Elenas Mutter']))
  expect(screen.getByLabelText('Wert')).toHaveFocus()
})

test('typing an own field name that starts like a template field keeps the row and every keystroke', async () => {
  const { pascal, user } = await setup()
  await user.click(screen.getByRole('button', { name: 'Eigenschaft hinzufügen' }))
  await user.type(screen.getByLabelText('Eigenschaft'), 'Alter beim Tod')
  await waitFor(async () => expect((await getEntry(pascal.id))!.properties.map((p) => p.key)).toEqual(['Alter beim Tod']))
  expect(screen.getByLabelText('Eigenschaft')).toHaveFocus()
})

test('a second property with a template name is shown, not hidden', async () => {
  await setup(async ({ pascal }) => {
    await updateEntry(pascal.id, {
      properties: [
        { id: 'p1', key: 'Alter', value: '27' },
        { id: 'p2', key: ' Alter ', value: 'zweiter Wert' },
      ],
    })
  })
  expect(screen.getByLabelText('Alter')).toHaveValue('27')
  expect(screen.getByDisplayValue('zweiter Wert')).toBeInTheDocument()
})
