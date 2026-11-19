import { render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, expect, test } from 'vitest'
import { resetDatabaseForTests } from '../storage/connection'
import { ShortcutsDialog } from '../help/ShortcutsDialog'
import { JumpDialog } from '../jump/JumpDialog'
import { TrashDialog } from '../trash/TrashDialog'

let before: HTMLButtonElement

beforeEach(async () => {
  await resetDatabaseForTests()
  before = document.createElement('button')
  document.body.append(before)
  before.focus()
  return () => before.remove()
})

// StrictMode runs every effect, its cleanup and the effect again right after mounting.
// The focus must stay in the window, not go back to where it was before.
test('the shortcut overview keeps the focus under StrictMode, and gives it back when closed', () => {
  const { unmount } = render(
    <StrictMode>
      <ShortcutsDialog onClose={() => {}} />
    </StrictMode>,
  )
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Schließen' }))
  unmount()
  expect(document.activeElement).toBe(before)
})

test('the quick jump keeps the focus in its field under StrictMode', () => {
  render(
    <StrictMode>
      <JumpDialog chapters={[]} entries={[]} folders={[]} onPick={() => {}} onClose={() => {}} />
    </StrictMode>,
  )
  expect(document.activeElement).toBe(screen.getByRole('combobox'))
})

test('the trash keeps the focus under StrictMode', () => {
  render(
    <StrictMode>
      <TrashDialog bookId="b" onRestored={() => {}} onClose={() => {}} />
    </StrictMode>,
  )
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Schließen' }))
})
