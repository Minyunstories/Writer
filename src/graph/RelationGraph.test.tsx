import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { Book, WikiEntry, WikiFolder } from '../types'
import { RelationGraph } from './RelationGraph'

const entry = (id: string, name: string, folderId: string | null = 'people'): WikiEntry =>
  ({ id, bookId: 'b', name, aliases: [], folderId, autoLink: true, properties: [], body: '', imageIds: [], createdAt: 0, updatedAt: 0 }) as WikiEntry
const entries = [entry('mira', 'Mira'), entry('lea', 'Lea'), entry('tom', 'Tom'), entry('hafen', 'Hafen', 'places'), entry('ida', 'Ida')]
const folders: WikiFolder[] = [
  { id: 'people', bookId: 'b', name: 'Personen', parentId: null } as WikiFolder,
  { id: 'places', bookId: 'b', name: 'Orte', parentId: null } as WikiFolder,
]
const book = {
  id: 'b',
  wikiStars: ['mira'],
  relations: {
    types: [
      { id: 't1', forward: 'Lehrerin von', backward: 'Schülerin von' },
      { id: 't2', forward: 'befreundet mit' },
      { id: 't3', forward: 'wohnt in', backward: 'Wohnort von' },
    ],
    relations: [
      { id: 'r1', from: 'mira', to: 'lea', typeId: 't1', createdAt: 1, updatedAt: 1 },
      { id: 'r2', from: 'lea', to: 'tom', typeId: 't2', createdAt: 2, updatedAt: 2 },
      { id: 'r3', from: 'tom', to: 'hafen', typeId: 't3', createdAt: 3, updatedAt: 3 },
    ],
  },
} as unknown as Book

function setup() {
  const onOpenEntry = vi.fn()
  render(<RelationGraph book={book} entries={entries} folders={folders} onOpenEntry={onOpenEntry} />)
  const graph = screen.getByRole('group', { name: 'Beziehungsnetz' })
  return { onOpenEntry, graph, user: userEvent.setup() }
}

test('entries with relationships are drawn with their connections; the rest are listed below', () => {
  const { graph } = setup()
  expect(within(graph).getAllByRole('button').map((node) => node.getAttribute('aria-label')).sort()).toEqual(['Hafen', 'Lea', 'Mira', 'Tom'])
  expect(within(graph).getByText('Lehrerin von →')).toBeInTheDocument()
  expect(within(graph).getByText('befreundet mit')).toBeInTheDocument()
  const rest = screen.getByRole('list', { name: 'Ohne Beziehung' })
  expect(within(rest).getByRole('button', { name: 'Ida' })).toBeInTheDocument()
})

test('a tap opens the entry; Enter does too', () => {
  const { graph, onOpenEntry } = setup()
  const lea = within(graph).getByRole('button', { name: 'Lea' })
  fireEvent.pointerDown(lea, { pointerId: 1, clientX: 10, clientY: 10 })
  fireEvent.pointerUp(lea, { pointerId: 1, clientX: 10, clientY: 10 })
  expect(onOpenEntry).toHaveBeenCalledWith('lea')
  fireEvent.keyDown(within(graph).getByRole('button', { name: 'Tom' }), { key: 'Enter' })
  expect(onOpenEntry).toHaveBeenCalledWith('tom')
})

test('kinds can be hidden and the network narrowed to a folder', async () => {
  const { graph, user } = setup()
  await user.click(screen.getByRole('button', { name: 'wohnt in' }))
  expect(within(graph).queryByRole('button', { name: 'Hafen' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'wohnt in' }))
  await user.selectOptions(screen.getByLabelText('Ordner'), 'Personen')
  expect(within(graph).getAllByRole('button').map((node) => node.getAttribute('aria-label')).sort()).toEqual(['Lea', 'Mira', 'Tom'])
})

test('"Alles zeigen" and "Neu anordnen" stay together in one group', () => {
  render(<RelationGraph book={{ ...book, graph: { mira: { x: 0, y: 0 } } } as unknown as Book} entries={entries} folders={folders} onOpenEntry={vi.fn()} />)
  const actions = screen.getByRole('button', { name: 'Alles zeigen' }).parentElement!
  expect(actions).toHaveClass('relation-graph-actions')
  expect(within(actions).getByRole('button', { name: 'Neu anordnen' })).toBeInTheDocument()
})
