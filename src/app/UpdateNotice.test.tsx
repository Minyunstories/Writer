import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { announceUpdate, UpdateNotice } from './UpdateNotice'

test('nothing is shown until a new version is waiting; then one click applies it', async () => {
  const user = userEvent.setup()
  render(<UpdateNotice />)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  const apply = vi.fn()
  act(() => announceUpdate(apply))
  expect(screen.getByRole('status')).toHaveTextContent('Eine neue Version der App ist bereit.')
  await user.click(screen.getByRole('button', { name: 'Jetzt aktualisieren' }))
  expect(apply).toHaveBeenCalled()
})

test('the notice can be postponed', async () => {
  const user = userEvent.setup()
  render(<UpdateNotice />)
  act(() => announceUpdate(() => {}))
  await user.click(screen.getByRole('button', { name: 'Später' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

test('an update announced before the notice is on screen is not missed', () => {
  announceUpdate(() => {})
  render(<UpdateNotice />)
  expect(screen.getByRole('status')).toBeInTheDocument()
})
