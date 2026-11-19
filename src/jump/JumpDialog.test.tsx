import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { JumpDialog } from './JumpDialog'

const chapters = [
  { id: 'c1', title: 'Anfang' },
  { id: 'c2', title: 'Der lange Winter' },
]
const entries = [{ id: 'e1', name: 'Mira', aliases: [], folderId: null }]

function setup() {
  const onPick = vi.fn()
  const onClose = vi.fn()
  render(<JumpDialog chapters={chapters} entries={entries} folders={[]} onPick={onPick} onClose={onClose} />)
  return { onPick, onClose, user: userEvent.setup(), input: screen.getByRole('combobox', { name: 'Kapitel oder Wiki-Eintrag suchen' }) }
}

test('typing filters the list', async () => {
  const { user, input } = setup()
  expect(screen.getAllByRole('option')).toHaveLength(3)
  await user.type(input, 'win')
  const options = screen.getAllByRole('option')
  expect(options).toHaveLength(1)
  expect(options[0]).toHaveTextContent('Der lange Winter')
  expect(options[0]).toHaveTextContent('Kapitel 2')
})

test('arrows and Enter pick, the first hit is chosen at the start', async () => {
  const { user, onPick } = setup()
  expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'entry', id: 'e1' }))
})

test('a click picks', async () => {
  const { user, onPick } = setup()
  await user.click(within(screen.getByRole('listbox')).getByText('Anfang'))
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ kind: 'chapter', id: 'c1' }))
})

test('Enter without hits does nothing', async () => {
  const { user, input, onPick } = setup()
  await user.type(input, 'xyz{Enter}')
  expect(screen.getByText('Nichts gefunden.')).toBeInTheDocument()
  expect(onPick).not.toHaveBeenCalled()
})

test('Esc closes', () => {
  const { onClose } = setup()
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
})
