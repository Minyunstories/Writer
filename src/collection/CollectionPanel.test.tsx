import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { Collection } from '../types'
import { AddToCollectionDialog } from './AddToCollectionDialog'
import { CollectionPanel } from './CollectionPanel'
import { favoriteKey } from './favoritesFile'

const collection: Collection = {
  guide: { title: 'Reaction-Beat-Katalog', rules: ['**Cut** before you swap.'], selfcheck: ['Can I cut it?'], notes: { '1. Nod': 'the nod family' } },
  items: [
    { id: '1', text: 'She set down the cup.', category: '1. Nod', group: 'Cut', createdAt: 1, updatedAt: 1 },
    { id: '3', text: 'She dipped her head.', category: '1. Nod', createdAt: 3, updatedAt: 3 },
    { id: '2', text: 'He grinned.', category: '2. Smile', note: 'sparsam', createdAt: 2, updatedAt: 2, source: { bookId: 'b', bookTitle: 'Buch', chapterId: 'c', offset: 3 } },
  ],
}

function setup(extra: Partial<React.ComponentProps<typeof CollectionPanel>> = {}) {
  const props = {
    collection,
    onInsert: vi.fn(),
    onAddSelection: vi.fn(),
    onDelete: vi.fn(),
    onDeleteCategory: vi.fn(),
    onImport: vi.fn(async () => ({ added: 3, known: 1 })),
    onOpenSource: vi.fn(),
    onClose: vi.fn(),
    ...extra,
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
  await user.click(within(panel).getAllByRole('button', { name: 'Kopieren' })[2])
  expect(writeText).toHaveBeenCalledWith('He grinned.')
  await user.click(within(panel).getByRole('button', { name: 'aus: Buch' }))
  expect(props.onOpenSource).toHaveBeenCalledWith(collection.items[2].source)
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

test('a whole category can be deleted after asking in its heading; cancel keeps it', async () => {
  const user = userEvent.setup()
  const props = setup()
  await user.click(screen.getByRole('button', { name: 'Bereich „1. Nod“ löschen' }))
  // The question names the whole category, even when the search shows only part of it.
  expect(screen.getByText('Alle 2 Einträge löschen?')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Abbrechen' })).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'Abbrechen' }))
  expect(props.onDeleteCategory).not.toHaveBeenCalled()
  expect(screen.queryByText('Alle 2 Einträge löschen?')).not.toBeInTheDocument()

  await user.type(screen.getByRole('searchbox', { name: 'Sammlung durchsuchen' }), 'cup')
  await user.click(screen.getByRole('button', { name: 'Bereich „1. Nod“ löschen' }))
  expect(screen.getByText('Alle 2 Einträge löschen?')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Ja, löschen' }))
  expect(props.onDeleteCategory).toHaveBeenCalledWith('1. Nod')
  expect(screen.queryByText('Alle 2 Einträge löschen?')).not.toBeInTheDocument()
})

test('a category with a single entry asks in the singular', async () => {
  const user = userEvent.setup()
  setup()
  await user.click(screen.getByRole('button', { name: 'Bereich „2. Smile“ löschen' }))
  expect(screen.getByText('Den einen Eintrag löschen?')).toBeInTheDocument()
})

test('each entry has a star: marked words show ★, a click toggles', async () => {
  const user = userEvent.setup()
  const onToggleFavorite = vi.fn()
  const props = setup({ favorites: new Set([favoriteKey('1. Nod', 'She set down the cup.')]), onToggleFavorite })
  void props
  const marked = screen.getByRole('button', { name: '„She set down the cup.“ als Favorit' })
  expect(marked).toHaveTextContent('★')
  expect(marked).toHaveAttribute('aria-pressed', 'true')
  const plain = screen.getByRole('button', { name: '„He grinned.“ als Favorit' })
  expect(plain).toHaveTextContent('☆')
  await user.click(plain)
  expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ text: 'He grinned.' }), true)
})
