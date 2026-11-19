import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { countName, RenameDialog } from './RenameDialog'

test('countName counts whole words with the exact spelling, as the links do', () => {
  expect(countName("Mira smiled. Mira's cup. Miras plan. mira.", 'Mira')).toBe(2)
  expect(countName('Lea and Lea', 'Lea')).toBe(2)
  expect(countName('', 'Lea')).toBe(0)
})

test('says what happened and offers both ways', async () => {
  const onReplace = vi.fn()
  const onKeepAlias = vi.fn()
  render(<RenameDialog oldName="Mira" newName="Mirabel" count={3} onReplace={onReplace} onKeepAlias={onKeepAlias} onClose={() => {}} />)
  expect(screen.getByRole('dialog', { name: '„Mira" heißt jetzt „Mirabel"' })).toBeInTheDocument()
  expect(screen.getByText('„Mira" kommt 3-mal in deinen Kapiteln vor.')).toBeInTheDocument()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Überall durch „Mirabel" ersetzen' }))
  expect(onReplace).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: '„Mira" als „auch bekannt als" behalten' }))
  expect(onKeepAlias).toHaveBeenCalledTimes(1)
})

test('once: "kommt einmal vor"', () => {
  render(<RenameDialog oldName="Mira" newName="Mirabel" count={1} onReplace={() => {}} onKeepAlias={() => {}} onClose={() => {}} />)
  expect(screen.getByText('„Mira" kommt einmal in deinen Kapiteln vor.')).toBeInTheDocument()
})

test('Esc and ✕ change nothing', async () => {
  const onClose = vi.fn()
  render(<RenameDialog oldName="Mira" newName="Mirabel" count={1} onReplace={() => {}} onKeepAlias={() => {}} onClose={onClose} />)
  fireEvent.keyDown(document.body, { key: 'Escape' })
  await userEvent.setup().click(screen.getByRole('button', { name: 'Schließen' }))
  expect(onClose).toHaveBeenCalledTimes(2)
})

test('the focus starts on ✕, so a quick Enter changes nothing', async () => {
  const onReplace = vi.fn()
  const onClose = vi.fn()
  render(<RenameDialog oldName="Mira" newName="Mirabel" count={2} onReplace={onReplace} onKeepAlias={() => {}} onClose={onClose} />)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Schließen' }))
  await userEvent.setup().keyboard('{Enter}')
  expect(onReplace).not.toHaveBeenCalled()
  expect(onClose).toHaveBeenCalledTimes(1)
})
