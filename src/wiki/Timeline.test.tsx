import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { Chapter } from '../types'
import { Timeline } from './Timeline'

const chapter = (content: string): Chapter => ({ id: 'c', bookId: 'b', title: 'Anfang', content, updatedAt: 0 })

test('a mention in a scene name counts for the scene it names', () => {
  const content = '*** Mira kommt\n\nThe storm came.\n\n*** Lea geht\n\nMorning came.'
  const { rerender } = render(<Timeline name="Mira" chapters={[chapter(content)]} mentions={[{ chapterId: 'c', count: 1, first: { from: 4, to: 8 } }]} />)
  expect(screen.getByText(/Szene/).textContent).toBe('ab „Mira kommt“ · Szene 1 von 2')
  const lea = content.indexOf('Lea')
  rerender(<Timeline name="Lea" chapters={[chapter(content)]} mentions={[{ chapterId: 'c', count: 1, first: { from: lea, to: lea + 3 } }]} />)
  expect(screen.getByText(/Szene/).textContent).toBe('ab „Lea geht“ · Szene 2 von 2')
})

test('a named scene shows its name first, an unnamed one only its number', () => {
  const content = 'Rain fell.\n\n*** Am Hafen\n\nMira waited.\n\n***\n\nMira slept.'
  const at = (word: string, from = 0) => content.indexOf(word, from)
  const named = at('Mira')
  const { rerender } = render(<Timeline name="Mira" chapters={[{ ...chapter(content), status: 'draft' }]} mentions={[{ chapterId: 'c', count: 2, first: { from: named, to: named + 4 } }]} />)
  expect(screen.getByText(/Szene/).textContent).toBe('ab „Am Hafen“ · Szene 2 von 3 · Entwurf')
  const unnamed = at('Mira', named + 1)
  rerender(<Timeline name="Mira" chapters={[chapter(content)]} mentions={[{ chapterId: 'c', count: 1, first: { from: unnamed, to: unnamed + 4 } }]} />)
  expect(screen.getByText(/Szene/).textContent).toBe('ab Szene 3 von 3')
})
