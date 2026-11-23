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

test('separators are centred; the text size can be changed and is kept', async () => {
  const user = userEvent.setup()
  const { unmount } = render(<Manuscript title="T" chapters={[chapter('a', 'A', 'Eins.\n***\nZwei.')]} onOpen={() => {}} />)
  expect(document.querySelector('.manuscript-separator')?.textContent).toBe('***')
  const article = screen.getByRole('article')
  const before = parseFloat(article.style.fontSize)
  await user.click(screen.getByRole('button', { name: 'Vergrößern' }))
  expect(parseFloat(article.style.fontSize)).toBeGreaterThan(before)
  const after = article.style.fontSize
  unmount()
  render(<Manuscript title="T" chapters={[]} onOpen={() => {}} />)
  expect(screen.getByRole('article').style.fontSize).toBe(after)
})

test('scene names stay out of the manuscript: a named break shows only its stars, the name line at the top nothing', () => {
  render(
    <Manuscript
      title="T"
      chapters={[chapter('a', 'A', '*** Abschied\n\nEins.\n\n*** Ankunft am Hafen\n\nZwei.'), chapter('b', 'B', '***\n\nDrei.')]}
      onOpen={() => {}}
    />,
  )
  expect([...document.querySelectorAll('.manuscript-separator')].map((node) => node.textContent)).toEqual(['***', '***'])
  expect(document.body.textContent).not.toMatch(/Abschied|Ankunft/)
  expect(screen.getByText('Eins.')).toBeInTheDocument()
})
