import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { Collection } from '../types'
import { AddToCollectionDialog } from './AddToCollectionDialog'
import { CollectionPanel } from './CollectionPanel'

const collection: Collection = {
  guide: { title: 'Reaction-Beat-Katalog', rules: ['**Cut** before you swap.'], selfcheck: ['Can I cut it?'], notes: { '1. Nod': 'the nod family' } },
  items: [
    { id: '1', text: 'She set down the cup.', category: '1. Nod', group: 'Cut', createdAt: 1, updatedAt: 1 },
    { id: '2', text: 'He grinned.', category: '2. Smile', note: 'sparsam', createdAt: 2, updatedAt: 2, source: { bookId: 'b', bookTitle: 'Buch', chapterId: 'c', offset: 3 } },
  ],
}

function setup() {
  const props = {
    collection,
    onInsert: vi.fn(),
    onAddSelection: vi.fn(),
    onDelete: vi.fn(),
    onImport: vi.fn(async () => ({ added: 3, known: 1 })),
    onOpenSource: vi.fn(),
    onClose: vi.fn(),
  }
  render(<CollectionPanel {...props} />)
  return props
}

test('items are shown by category and group; a click puts one at the cursor, the other button copies it', async () => {
  const user = userEvent.setup()
  const writeText = vi.fn(async () => {})
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const props = setup()
  const panel = screen.getByRole('complementary', { name: 'Sammlung' })
  expect(within(panel).getByRole('heading', { name: '1. Nod' })).toBeInTheDocument()
  expect(within(panel).getByText('the nod family')).toBeInTheDocument()
  expect(within(panel).getByText('Cut', { selector: '.collection-group-label' })).toBeInTheDocument()
  await user.click(within(panel).getByRole('button', { name: 'She set down the cup.' }))
  expect(props.onInsert).toHaveBeenCalledWith('She set down the cup.')
  await user.click(within(panel).getAllByRole('button', { name: 'Kopieren' })[1])
  expect(writeText).toHaveBeenCalledWith('He grinned.')
  await user.click(within(panel).getByRole('button', { name: 'aus: Buch' }))
  expect(props.onOpenSource).toHaveBeenCalledWith(collection.items[1].source)
})

test('the search narrows the list; the rules can be folded away', async () => {
  const user = userEvent.setup()
  setup()
  await user.type(screen.getByRole('searchbox', { name: 'Sammlung durchsuchen' }), 'grin')
  expect(screen.queryByRole('button', { name: 'She set down the cup.' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'He grinned.' })).toBeInTheDocument()
  expect(screen.getByText('Cut', { selector: 'strong' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /Regeln & Selbstcheck/ }))
  expect(screen.queryByText('Can I cut it?')).not.toBeInTheDocument()
})

test('a catalogue file is imported and the result reported', async () => {
  const user = userEvent.setup()
  const props = setup()
  const file = new File(['<script>const DATA = {"categories": []\n};</script>'], 'katalog.html', { type: 'text/html' })
  await user.upload(screen.getByLabelText('Katalog importieren'), file)
  expect(props.onImport).toHaveBeenCalledWith(expect.stringContaining('const DATA'))
  expect(await screen.findByText('3 neu, 1 schon vorhanden.')).toBeInTheDocument()
})

test('the dialog takes edited text, an existing or a new category, a group and a note', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  render(<AddToCollectionDialog initialText="She looked away" collection={collection} onSave={onSave} onCancel={() => {}} />)
  const dialog = screen.getByRole('dialog', { name: 'In die Sammlung' })
  await user.type(within(dialog).getByLabelText('Text'), '.')
  await user.selectOptions(within(dialog).getByLabelText('Kategorie'), '1. Nod')
  await user.type(within(dialog).getByLabelText('Gruppe'), 'Cut')
  await user.type(within(dialog).getByLabelText('Notiz'), 'gut')
  await user.click(within(dialog).getByRole('button', { name: 'Aufnehmen' }))
  expect(onSave).toHaveBeenCalledWith({ text: 'She looked away.', category: '1. Nod', group: 'Cut', note: 'gut' })

  await user.selectOptions(within(dialog).getByLabelText('Kategorie'), '__new')
  await user.type(within(dialog).getByLabelText('Neue Kategorie'), 'Blicke')
  await user.click(within(dialog).getByRole('button', { name: 'Aufnehmen' }))
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'Blicke' }))
})
