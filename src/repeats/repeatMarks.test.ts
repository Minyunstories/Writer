import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { GRAMMAR_EVENT, isRepeatsOn, setRepeatsOn } from '../grammar/grammarSetting'
import { repeatMarks } from './repeatMarks'

let view: EditorView | null = null
beforeEach(() => localStorage.clear())
afterEach(() => {
  view?.destroy()
  view = null
})

function setup(doc: string, options: { names?: string[]; delay?: number; on?: boolean } = {}) {
  let enabled = options.on ?? true
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: repeatMarks({ enabled: () => enabled, names: () => options.names ?? [], recheckEvent: GRAMMAR_EVENT, delay: options.delay ?? 0 }),
    }),
    parent: document.body,
  })
  return { view, setEnabled: (on: boolean) => (enabled = on) }
}

const marked = (view: EditorView) => [...view.dom.querySelectorAll('.cm-mw-repeat')].map((mark) => mark.textContent)
const active = (view: EditorView) => [...view.dom.querySelectorAll('.cm-mw-repeat-active')].map((mark) => mark.textContent)

test('the setting is off until switched on, and switching checks again', () => {
  expect(isRepeatsOn()).toBe(false)
  let heard = 0
  const listen = () => heard++
  window.addEventListener(GRAMMAR_EVENT, listen)
  setRepeatsOn(true)
  window.removeEventListener(GRAMMAR_EVENT, listen)
  expect(isRepeatsOn()).toBe(true)
  expect(localStorage.getItem('mw:repeats')).toBe('on')
  expect(heard).toBe(1)
})

test('marks repeats when on, none when off', async () => {
  const { view } = setup('The door creaked. The door opened.')
  await waitFor(() => expect(marked(view)).toEqual(['door', 'door']))
  view.destroy()
  const off = setup('The door creaked. The door opened.', { on: false })
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(marked(off.view)).toEqual([])
})

test('switching on via the event marks without typing', async () => {
  const { view, setEnabled } = setup('The door creaked. The door opened.', { on: false })
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(marked(view)).toEqual([])
  setEnabled(true)
  window.dispatchEvent(new Event(GRAMMAR_EVENT))
  await waitFor(() => expect(marked(view)).toEqual(['door', 'door']))
  setEnabled(false)
  window.dispatchEvent(new Event(GRAMMAR_EVENT))
  await waitFor(() => expect(marked(view)).toEqual([]))
})

test('the group under the cursor is active', async () => {
  const text = 'A lamp, a door. The lamp lit the door.'
  const { view } = setup(text)
  await waitFor(() => expect(marked(view)).toEqual(['lamp', 'door', 'lamp', 'door']))
  expect(active(view)).toEqual([])
  view.dispatch({ selection: { anchor: text.lastIndexOf('door') + 2 } })
  expect(active(view)).toEqual(['door', 'door'])
})

test('marks follow typing, and a deleted word loses its mark at once', async () => {
  const text = 'The door creaked. The door opened.'
  const { view } = setup(text, { delay: 10_000 })
  // Opening marks at once; later changes wait for the (here very long) pause.
  await waitFor(() => expect(marked(view)).toEqual(['door', 'door']))
  view.dispatch({ changes: { from: 0, insert: 'Big. ' } })
  expect(marked(view)).toEqual(['door', 'door'])
  const second = view.state.doc.toString().lastIndexOf('door')
  view.dispatch({ changes: { from: second, to: second + 4 } })
  expect(marked(view)).toEqual(['door'])
})

test('names are never marked', async () => {
  const { view } = setup('Mira ran home. Mira ran back.', { names: ['Mira'] })
  await waitFor(() => expect(marked(view)).toEqual(['ran', 'ran']))
})

test('scene names are no part of the text: a word there is no repeat of the same word in the story', async () => {
  const { view } = setup('The harbour was quiet.\n\n*** Harbour\n\nThe door creaked. The door opened.')
  await waitFor(() => expect(marked(view)).toEqual(['door', 'door']))
})
