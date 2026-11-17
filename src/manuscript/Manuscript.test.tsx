import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { Chapter } from '../types'
import { Manuscript } from './Manuscript'

const chapter = (id: string, title: string, content: string): Chapter => ({ id, bookId: 'b', title, content, updatedAt: 0 })

test('all chapters as one document; a click on a paragraph opens it there', async () => {
  const onOpen = vi.fn()
  render(
    <Manuscript
      title="Sturmlied"
      chapters={[chapter('a', 'Anfang', 'Erster **fetter** Satz.\n\nZweiter *kursiver* und ==markierter== Satz.'), chapter('b', 'Sturm', '# Teil\nRegen.')]}
      onOpen={onOpen}
    />,
  )
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Anfang', 'Sturm'])
  expect(screen.getByText('fetter').tagName).toBe('STRONG')
  expect(screen.getByText('kursiver').tagName).toBe('EM')
  expect(screen.getByText('markierter').tagName).toBe('MARK')
  expect(screen.getByRole('heading', { level: 3, name: 'Teil' })).toBeInTheDocument()
  await userEvent.setup().click(screen.getByText(/Zweiter/))
  expect(onOpen).toHaveBeenCalledWith('a', 25)
})
