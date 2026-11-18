import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, expect, test } from 'vitest'
import { currentParagraph, isFocusMode, setFocusMode } from './focusMode'

let view: EditorView | null = null
afterEach(() => {
  view?.destroy()
  view = null
  setFocusMode(false)
})

test('the lines of the paragraph with the cursor are marked', () => {
  view = new EditorView({
    state: EditorState.create({
      doc: 'One.\n\nTwo a.\nTwo b.\n\nThree.',
      selection: EditorSelection.cursor(9),
      extensions: currentParagraph,
    }),
    parent: document.body,
  })
  const marked = [...view.dom.querySelectorAll('.cm-line.cm-mw-current')].map((line) => line.textContent)
  expect(marked).toEqual(['Two a.', 'Two b.'])
  view.dispatch({ selection: { anchor: view.state.doc.length } })
  expect([...view.dom.querySelectorAll('.cm-line.cm-mw-current')].map((line) => line.textContent)).toEqual(['Three.'])
})

test('focus mode is a page-wide switch that tells everyone', () => {
  const seen: boolean[] = []
  window.addEventListener('mw:focus', () => seen.push(isFocusMode()))
  setFocusMode(true)
  expect(document.body.classList.contains('focus-mode')).toBe(true)
  setFocusMode(false)
  expect(document.body.classList.contains('focus-mode')).toBe(false)
  expect(seen).toEqual([true, false])
})
