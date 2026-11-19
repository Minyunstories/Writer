import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import type { Chapter } from '../types'
import { CHANGED_EVENT, resetDatabaseForTests } from '../storage/connection'
import { createBook, createChapter, updateChapter } from '../storage/db'
import { ChapterReader } from './ChapterReader'

const chapter = (id: string, title: string, content: string): Chapter => ({ id, bookId: 'b1', title, content, updatedAt: 1 })
const chapters = [
  chapter('c1', 'Anfang', 'Mira **closed** the door.\n\n## Draußen\n\nIt was ==cold==.\n\n***\n\nLater.'),
  chapter('c2', 'Mitte', 'Lea laughed.'),
  chapter('c3', 'Ende', 'Tom left.'),
]

beforeEach(async () => {
  localStorage.clear()
  await resetDatabaseForTests()
})

function open(currentId: string | null, list = chapters) {
  const onOpen = vi.fn()
  render(<ChapterReader bookId="b1" chapters={list} currentId={currentId} onOpen={onOpen} onClose={() => {}} />)
  return { onOpen, user: userEvent.setup(), panel: screen.getByRole('complementary', { name: 'Kapitel lesen' }) }
}

test('starts with the chapter before the open one and shows its text like the manuscript', () => {
  const { panel } = open('c2')
  expect(within(panel).getByRole('combobox', { name: 'Kapitel' })).toHaveValue('c1')
  expect(within(panel).getByRole('heading', { name: 'Draußen' })).toBeInTheDocument()
  expect(within(panel).getByText('closed').tagName).toBe('STRONG')
  expect(within(panel).getByText('cold').tagName).toBe('MARK')
  // The open chapter itself is not offered.
  expect(within(panel).queryByRole('option', { name: '2 · Mitte' })).toBeNull()
})

test('in the first chapter it starts with the next one', () => {
  const { panel } = open('c1')
  expect(within(panel).getByRole('combobox', { name: 'Kapitel' })).toHaveValue('c2')
  expect(within(panel).getByText('Lea laughed.')).toBeInTheDocument()
})

test('another choice shows its text and is remembered on this device', async () => {
  const { panel, user } = open('c2')
  await user.selectOptions(within(panel).getByRole('combobox', { name: 'Kapitel' }), 'c3')
  expect(within(panel).getByText('Tom left.')).toBeInTheDocument()
  expect(localStorage.getItem('mw:reader:b1')).toBe('c3')
})

test('a remembered choice comes back', () => {
  localStorage.setItem('mw:reader:b1', 'c3')
  const { panel } = open('c1')
  expect(within(panel).getByRole('combobox', { name: 'Kapitel' })).toHaveValue('c3')
})

test('"Öffnen" switches to that chapter', async () => {
  const { panel, user, onOpen } = open('c2')
  await user.click(within(panel).getByRole('button', { name: 'Öffnen' }))
  expect(onOpen).toHaveBeenCalledWith('c1')
})

test('with only one chapter it says so', () => {
  const { panel } = open('c1', [chapters[0]])
  expect(within(panel).getByText('Es gibt noch kein anderes Kapitel zum Lesen.')).toBeInTheDocument()
})

test('shows the stored text, not an older copy, and follows later saves', async () => {
  const book = await createBook('Sturmlied')
  const one = await createChapter(book.id, 'Eins', 'Mira closed the door. NEW WORDS')
  const two = await createChapter(book.id, 'Zwei', 'Lea laughed.')
  // The list handed in is older than what is stored.
  const stale = [{ ...one, content: 'Mira closed the door.' }, two]
  render(<ChapterReader bookId={book.id} chapters={stale} currentId={two.id} onOpen={() => {}} onClose={() => {}} />)
  expect(await screen.findByText('Mira closed the door. NEW WORDS')).toBeInTheDocument()
  await updateChapter(one.id, { content: 'Even newer.' })
  act(() => {
    window.dispatchEvent(new Event(CHANGED_EVENT))
  })
  expect(await screen.findByText('Even newer.')).toBeInTheDocument()
})
