import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ConfirmDialog } from './Dialogs'

let seen: boolean[] = []
const listener = (event: KeyboardEvent) => seen.push(event.defaultPrevented)

afterEach(() => {
  window.removeEventListener('keydown', listener)
  seen = []
})

test('Esc in a question closes only the question: listeners added earlier (focus mode) see it as used', () => {
  // Registered first, like the editor's focus mode, which ends on an Esc nobody used.
  window.addEventListener('keydown', listener)
  const onCancel = vi.fn()
  render(<ConfirmDialog message="Wirklich?" confirmLabel="Ja" onConfirm={() => {}} onCancel={onCancel} />)
  fireEvent.keyDown(screen.getByRole('button', { name: 'Abbrechen' }), { key: 'Escape' })
  expect(onCancel).toHaveBeenCalledTimes(1)
  expect(seen).toEqual([true])
})
