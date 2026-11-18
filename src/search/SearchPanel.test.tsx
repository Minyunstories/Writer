import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { SearchPanel } from './SearchPanel'

test('typography for the whole book: counted, confirmed, reported', async () => {
  const user = userEvent.setup()
  const onTypography = vi.fn(async () => 1)
  render(
    <SearchPanel
      chapters={[
        { id: 'a', bookId: 'b', title: 'A', content: '"Hi," she said.', updatedAt: 0 },
        { id: 'b', bookId: 'b', title: 'B', content: '“Fine.”', updatedAt: 0 },
      ]}
      onOpen={() => {}}
      onReplaceAll={async () => 0}
      onTypography={onTypography}
      onClose={() => {}}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Anführungszeichen und Striche umwandeln' }))
  expect(screen.getByText('1 Kapitel umwandeln? Vorher wird jeweils eine Fassung gesichert.')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Ja, umwandeln' }))
  expect(onTypography).toHaveBeenCalled()
  expect(await screen.findByText('1 Kapitel umgewandelt.')).toBeInTheDocument()
})
