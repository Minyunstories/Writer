import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, expect, test, vi } from 'vitest'
import { buildMatcher } from './linker'
import { buildLinkDecorations, createWikiLinks } from './wikiLinks'

const entry = (id: string, name: string) => ({ id, name, aliases: [], autoLink: true, createdAt: 1 })
const matcher = buildMatcher([entry('prince', 'Prince'), entry('rose', 'Rose')])

let view: EditorView | undefined
afterEach(() => {
  view?.destroy()
  view = undefined
})

function collect(doc: string, ranges: { from: number; to: number }[]) {
  const state = EditorState.create({ doc })
  const found: { text: string; id: string }[] = []
  const cursor = buildLinkDecorations(state, ranges, matcher).iter()
  while (cursor.value) {
    found.push({ text: doc.slice(cursor.from, cursor.to), id: cursor.value.spec.attributes['data-entry-id'] })
    cursor.next()
  }
  return found
}

test('names in range are decorated with their entry id', () => {
  const doc = 'Prince met Rose.\nRose left.'
  expect(collect(doc, [{ from: 0, to: doc.length }])).toEqual([
    { text: 'Prince', id: 'prince' },
    { text: 'Rose', id: 'rose' },
    { text: 'Rose', id: 'rose' },
  ])
})

test('nothing outside the given range is decorated', () => {
  const doc = 'Prince met Rose.\nRose left.'
  expect(collect(doc, [{ from: 17, to: doc.length }])).toEqual([{ text: 'Rose', id: 'rose' }])
})

test('a new matcher updates an open editor without a text change', () => {
  const links = createWikiLinks({ onOpen: () => {} })
  view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'Prince met Rose.', extensions: [links.extension] }) })
  expect(view.dom.querySelectorAll('.cm-mw-link')).toHaveLength(0)
  links.setMatcher(matcher)
  expect([...view.dom.querySelectorAll('.cm-mw-link')].map((el) => el.textContent)).toEqual(['Prince', 'Rose'])
  links.setMatcher(buildMatcher([]))
  expect(view.dom.querySelectorAll('.cm-mw-link')).toHaveLength(0)
})

test('a matcher set before the editor exists is used when it opens', () => {
  const links = createWikiLinks({ onOpen: () => {} })
  links.setMatcher(matcher)
  view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'Rose', extensions: [links.extension] }) })
  expect(view.dom.querySelectorAll('.cm-mw-link')).toHaveLength(1)
})

test('clicking a link opens its entry', () => {
  const onOpen = vi.fn()
  const links = createWikiLinks({ onOpen })
  links.setMatcher(matcher)
  view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'Prince met Rose.', extensions: [links.extension] }) })
  const link = [...view.dom.querySelectorAll<HTMLElement>('.cm-mw-link')].find((el) => el.textContent === 'Rose')!
  link.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(onOpen).toHaveBeenCalledWith('rose')
  view.contentDOM.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  expect(onOpen).toHaveBeenCalledTimes(1)
})

test('on touch a tap opens the entry without focusing the text; a scroll gesture does not', () => {
  const onOpen = vi.fn()
  const links = createWikiLinks({ onOpen })
  links.setMatcher(matcher)
  view = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'Prince met Rose.', extensions: [links.extension] }) })
  const link = view.dom.querySelector<HTMLElement>('.cm-mw-link')!
  const fire = (type: string) => {
    const event = new Event(type, { bubbles: true, cancelable: true })
    const point = { clientX: 1, clientY: 1, identifier: 0, target: link }
    const active = type === 'touchend' ? [] : [point]
    Object.assign(event, { touches: active, targetTouches: active, changedTouches: [point] })
    link.dispatchEvent(event)
    return event
  }
  fire('touchstart')
  fire('touchmove')
  expect(fire('touchend').defaultPrevented).toBe(false)
  expect(onOpen).not.toHaveBeenCalled()

  fire('touchstart')
  expect(fire('touchend').defaultPrevented).toBe(true)
  expect(onOpen).toHaveBeenCalledWith('prince')
})
