import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, expect, test, vi } from 'vitest'
import type { ChapterComment } from '../types'
import { addCommentAtSelection, commentMarks, currentPlaces, refreshComments } from './commentMarks'

let view: EditorView | null = null
afterEach(() => {
  view?.destroy()
  view = null
})
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

const comment = (id: string, from: number, to: number, text: string, done = false): ChapterComment => ({ id, from, to, quote: '', text, done, createdAt: 1, updatedAt: 1 })

function setup(doc: string, comments: ChapterComment[], anchor = 0, head = anchor) {
  const options = {
    onAdd: vi.fn(async (place: { from: number; to: number; quote: string }) => ({ ...comment('new', place.from, place.to, ''), quote: place.quote })),
    onUpdate: vi.fn(),
    onDelete: vi.fn(),
    onPlace: vi.fn(),
    placeDelay: 0,
  }
  view = new EditorView({
    state: EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: commentMarks(comments, options) }),
    parent: document.body,
  })
  return { view, options }
}

test('open comments mark their words; done ones do not; marks move with the text', async () => {
  const { view, options } = setup('The storm came late.', [comment('a', 4, 9, 'Zu laut?'), comment('b', 10, 14, 'ok', true)])
  expect([...view.dom.querySelectorAll('.cm-mw-comment')].map((m) => m.textContent)).toEqual(['storm'])
  view.dispatch({ changes: { from: 0, insert: 'And ' } })
  expect(currentPlaces(view.state)).toEqual([
    { id: 'a', from: 8, to: 13, quote: 'storm' },
    { id: 'b', from: 14, to: 18, quote: 'came' },
  ])
  await wait()
  expect(options.onPlace).toHaveBeenCalledWith(currentPlaces(view.state))
})

test('with the cursor inside, a box shows the comment and can mark it done or delete it', async () => {
  const { view, options } = setup('The storm came late.', [comment('a', 4, 9, 'Zu laut?')], 6)
  await wait()
  const box = document.querySelector('.cm-mw-comment-box')!
  expect(box.textContent).toContain('Zu laut?')
  ;(box.querySelector('button[data-action="done"]') as HTMLButtonElement).click()
  expect(options.onUpdate).toHaveBeenCalledWith('a', { done: true })
  refreshComments(view, [comment('a', 4, 9, 'Zu laut?', true)])
  expect(view.dom.querySelector('.cm-mw-comment')).toBeNull()
  refreshComments(view, [comment('a', 4, 9, 'Zu laut?')])
  view.dispatch({ selection: { anchor: 5 } })
  await wait()
  ;(document.querySelector('.cm-mw-comment-box button[data-action="delete"]') as HTMLButtonElement).click()
  expect(options.onDelete).toHaveBeenCalledWith('a')
  expect(view.dom.querySelector('.cm-mw-comment')).toBeNull()
})

test('a new comment on the selection opens for writing; Enter saves, an empty one is dropped', async () => {
  const { view, options } = setup('The storm came late.', [], 4, 9)
  expect(addCommentAtSelection(view)).toBe(true)
  await wait()
  expect(options.onAdd).toHaveBeenCalledWith({ from: 4, to: 9, quote: 'storm' })
  const field = document.querySelector('.cm-mw-comment-box textarea') as HTMLTextAreaElement
  field.value = 'Stärker?'
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  expect(options.onUpdate).toHaveBeenCalledWith('new', { text: 'Stärker?' })

  const second = setup('Rain.', [], 0, 4)
  addCommentAtSelection(second.view)
  await wait()
  const empty = document.querySelectorAll('.cm-mw-comment-box textarea')
  ;(empty[empty.length - 1] as HTMLTextAreaElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(second.options.onDelete).toHaveBeenCalledWith('new')
})
