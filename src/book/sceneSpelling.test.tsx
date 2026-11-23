import { render, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'
import { Editor } from '../editor/Editor'
import { createBook, createChapter, resetDatabaseForTests } from '../storage/db'
import { BookView } from './BookView'

const checked = vi.hoisted(() => [] as string[])
vi.mock('../grammar/harper', () => ({
  knownWords: () => [],
  checkText: async (text: string) => {
    checked.push(text)
    return []
  },
}))

beforeEach(async () => {
  await resetDatabaseForTests()
  localStorage.clear()
  checked.length = 0
})

test('the spell check does not see scene names, but every position stays where it was', async () => {
  const content = 'The storm came.\n\n*** Ankunft am Hafen\n\nMorning came.'
  const book = await createBook('Sturmlied')
  const chapter = await createChapter(book.id, 'Anfang', content)
  render(
    <MemoryRouter initialEntries={[`/book/${book.id}/chapters/${chapter.id}`]}>
      <Routes>
        <Route
          path="/book/:bookId/:section?/:itemId?"
          element={
            <BookView
              renderChapter={({ book, chapter, onChanged, extensions, jumpTo, onJumped }) => (
                <Editor key={chapter.id} book={book} chapter={chapter} onChanged={onChanged} extraExtensions={extensions} jumpTo={jumpTo} onJumped={onJumped} />
              )}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(checked.length).toBeGreaterThan(0), { timeout: 4000 })
  expect(checked[0]).toHaveLength(content.length)
  expect(checked[0]).not.toMatch(/Ankunft|Hafen/)
  expect(checked[0]).toContain('Morning came.')
})
