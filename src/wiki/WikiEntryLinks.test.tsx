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
    if (utils.container.isConnected) utils.rerender(ui())
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

test('properties can be arranged: own fields within the entry, template fields for the folder', async () => {
  const { chars, pascal, user } = await setup(async ({ pascal }) => {
    await updateEntry(pascal.id, {
      properties: [
        { id: 'p1', key: 'Größe', value: '1,80' },
        { id: 'p2', key: 'Alter', value: '27' },
        { id: 'p3', key: 'Beruf', value: 'Schmied' },
      ],
    })
  })
  expect(screen.queryByRole('button', { name: 'Größe nach unten' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Eigenschaften anordnen' }))
  expect(screen.getByRole('button', { name: 'Größe nach oben' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Größe nach unten' }))
  // Own fields in their new order; where the template field's value sits in the list does not matter.
  await waitFor(async () => expect((await getEntry(pascal.id))!.properties.map((p) => p.key).filter((key) => key !== 'Alter')).toEqual(['Beruf', 'Größe']))
  await user.click(screen.getByRole('button', { name: 'Alter nach oben' }))
  await waitFor(async () => expect((await listFolders(chars.bookId)).find((f) => f.id === chars.id)!.template).toEqual(['Alter', 'Augenfarbe']))
  await user.click(screen.getByRole('button', { name: 'Fertig' }))
  expect(screen.queryByRole('button', { name: 'Alter nach oben' })).not.toBeInTheDocument()
})

test('a value can have several lines', async () => {
  const { pascal, user } = await setup()
  await user.click(screen.getByRole('button', { name: 'Eigenschaft hinzufügen' }))
  await user.type(screen.getByLabelText('Eigenschaft'), 'Beruf')
  const value = screen.getByLabelText('Wert')
  expect(value.tagName).toBe('TEXTAREA')
  await user.type(value, 'Erster Hofschmied{Enter}des Nordens')
  await waitFor(async () => expect((await getEntry(pascal.id))!.properties[0].value).toBe('Erster Hofschmied\ndes Nordens'))
  expect(screen.getByLabelText('Augenfarbe').tagName).toBe('TEXTAREA')
})

function dragOnto(source: Element, target: Element) {
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

test('blocks: named by hand, filled, and starred for every entry of the folder', async () => {
  const { chars, pascal, user } = await setup(async ({ pascal }) => {
    await updateEntry(pascal.id, { properties: [{ id: 'p1', key: 'Größe', value: '1,80' }] })
  })
  await user.click(screen.getByRole('button', { name: '+ Block' }))
  const name = screen.getByRole('textbox', { name: 'Name des Blocks „Neuer Block"' })
  await waitFor(() => expect(name).toHaveFocus())
  await user.keyboard('Aussehen{Enter}')
  const block = await screen.findByRole('region', { name: 'Block Aussehen' })
  // Drag "Größe" into the block.
  const grip = screen.getByDisplayValue('Größe').closest('li')!.querySelector('.wiki-grip')!
  dragOnto(grip, block)
  await waitFor(async () => expect((await getEntry(pascal.id))!.properties[0].group).toBe('Aussehen'))
  await user.click(within(block).getByRole('button', { name: 'Block „Aussehen" für alle Einträge in „Characters"' }))
  await waitFor(async () => {
    const folder = (await listFolders(chars.bookId)).find((f) => f.id === chars.id)!
    expect(folder.templateBlocks).toEqual(['Aussehen'])
    expect(folder.template).toEqual(['Augenfarbe', 'Alter', 'Größe'])
    expect(folder.templateGroups).toEqual({ Größe: 'Aussehen' })
  })
  // A template field is dragged into the starred block too.
  const starred = await screen.findByRole('region', { name: 'Block Aussehen' })
  dragOnto(screen.getByText('Augenfarbe').closest('li')!.querySelector('.wiki-grip')!, starred)
  await waitFor(async () => expect((await listFolders(chars.bookId)).find((f) => f.id === chars.id)!.templateGroups).toEqual({ Größe: 'Aussehen', Augenfarbe: 'Aussehen' }))
  // Unstarred: gone from the folder, kept in this entry.
  await user.click(within(await screen.findByRole('region', { name: 'Block Aussehen' })).getByRole('button', { name: /^Block „Aussehen" für alle/ }))
  await waitFor(async () => {
    const folder = (await listFolders(chars.bookId)).find((f) => f.id === chars.id)!
    expect(folder.templateBlocks).toBeUndefined()
    expect(folder.template).toEqual(['Alter'])
  })
  await waitFor(async () => expect((await getEntry(pascal.id))!.blocks).toEqual(['Aussehen']))
})

test('fields are dragged into order on a computer', async () => {
  const { pascal } = await setup(async ({ pascal }) => {
    await updateEntry(pascal.id, { properties: [{ id: 'a', key: 'Eins', value: '' }, { id: 'b', key: 'Zwei', value: '' }] })
  })
  const row = (key: string) => screen.getByDisplayValue(key).closest('li')!
  dragOnto(row('Zwei').querySelector('.wiki-grip')!, row('Eins'))
  await waitFor(async () => expect((await getEntry(pascal.id))!.properties.map((p) => p.key)).toEqual(['Zwei', 'Eins']))
})
