import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { Chapter } from '../types'
import { Timeline } from './Timeline'

const chapter = (content: string): Chapter => ({ id: 'c', bookId: 'b', title: 'Anfang', content, updatedAt: 0 })

test('a mention in a scene name counts for the scene it names', () => {
  const content = '*** Mira kommt\n\nThe storm came.\n\n*** Lea geht\n\nMorning came.'
  const { rerender } = render(<Timeline name="Mira" chapters={[chapter(content)]} mentions={[{ chapterId: 'c', count: 1, first: { from: 4, to: 8 } }]} />)
  expect(screen.getByText(/ab Szene/).textContent).toBe('ab Szene 1 von 2')
  const lea = content.indexOf('Lea')
  rerender(<Timeline name="Lea" chapters={[chapter(content)]} mentions={[{ chapterId: 'c', count: 1, first: { from: lea, to: lea + 3 } }]} />)
  expect(screen.getByText(/ab Szene/).textContent).toBe('ab Szene 2 von 2')
})
