import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ShortcutsDialog } from './ShortcutsDialog'
import { isHelpKey } from './shortcuts'

test('shows the three groups', () => {
  render(<ShortcutsDialog onClose={() => {}} />)
  const dialog = screen.getByRole('dialog', { name: 'Tastenkürzel' })
  for (const name of ['Schreiben', 'Nachschlagen und sammeln', 'Leisten und Ansicht']) {
    expect(screen.getByRole('heading', { name })).toBeInTheDocument()
  }
  expect(dialog).toHaveTextContent('Strg+Alt+M')
})

test('lists the paragraph move and the help key itself', () => {
  render(<ShortcutsDialog onClose={() => {}} />)
  expect(screen.getByText('Alt+↑ / ↓')).toBeInTheDocument()
  expect(screen.getByText('Absatz verschieben (Leerzeilen zählen mit)')).toBeInTheDocument()
  expect(screen.getByText('Strg+/')).toBeInTheDocument()
})

test('closes with the button', async () => {
  const onClose = vi.fn()
  render(<ShortcutsDialog onClose={onClose} />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Schließen' }))
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('closes with Esc', () => {
  const onClose = vi.fn()
  render(<ShortcutsDialog onClose={onClose} />)
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
})

test('isHelpKey: Ctrl or Cmd with "/", also when Shift makes the "/" (German keyboard)', () => {
  expect(isHelpKey({ key: '/', ctrlKey: true, metaKey: false, altKey: false })).toBe(true)
  expect(isHelpKey({ key: '/', ctrlKey: false, metaKey: true, altKey: false })).toBe(true)
  expect(isHelpKey({ key: '/', ctrlKey: true, metaKey: false, altKey: true })).toBe(false)
  expect(isHelpKey({ key: '-', ctrlKey: true, metaKey: false, altKey: false })).toBe(false)
  expect(isHelpKey({ key: '/', ctrlKey: false, metaKey: false, altKey: false })).toBe(false)
})

test('gives the focus back to where it was when it closes', () => {
  const before = document.createElement('button')
  document.body.append(before)
  before.focus()
  const { unmount } = render(<ShortcutsDialog onClose={() => {}} />)
  expect(document.activeElement).not.toBe(before)
  unmount()
  expect(document.activeElement).toBe(before)
  before.remove()
})

test('Esc is used up by the overview, so focus mode stays on', () => {
  const later = vi.fn()
  window.addEventListener('keydown', later)
  try {
    render(<ShortcutsDialog onClose={() => {}} />)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(later).not.toHaveBeenCalled()
  } finally {
    window.removeEventListener('keydown', later)
  }
})
