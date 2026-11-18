import { EditorState } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { afterEach, expect, test } from 'vitest'
import { smartTypography, typographic } from './typography'

let view: EditorView | null = null
afterEach(() => {
  view?.destroy()
  view = null
})

function setup(doc = '') {
  view = new EditorView({ state: EditorState.create({ doc, selection: { anchor: doc.length }, extensions: smartTypography }), parent: document.body })
  return view
}

/** Types like a person: each character through the input handlers. */
function type(view: EditorView, text: string) {
  for (const char of text) {
    const { from, to } = view.state.selection.main
    const handled = view.state.facet(EditorView.inputHandler).some((handler) => handler(view, from, to, char, () => view.state.update({ changes: { from, to, insert: char } })))
    if (!handled) view.dispatch({ changes: { from, to, insert: char }, selection: { anchor: from + char.length }, userEvent: 'input.type' })
  }
}

test('quotes curl the right way while typing', () => {
  const view = setup()
  type(view, `"It's late," she said. 'Go.'`)
  expect(view.state.doc.toString()).toBe('“It’s late,” she said. ‘Go.’')
})

test('dashes: two hyphens become a long dash; a hyphen between spaces a dash, spaces kept', () => {
  const view = setup()
  type(view, 'She waited -- then left. Rain - always rain. A well-known road.')
  expect(view.state.doc.toString()).toBe('She waited — then left. Rain – always rain. A well-known road.')
})

test('a list marker at the start of a line stays a hyphen', () => {
  const view = setup()
  type(view, '- first')
  expect(view.state.doc.toString()).toBe('- first')
})

test('Backspace right after a change brings back the plain character', () => {
  const view = setup()
  type(view, '"')
  expect(view.state.doc.toString()).toBe('“')
  view.contentDOM.focus()
  runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Backspace' }), 'editor')
  expect(view.state.doc.toString()).toBe('"')
})

test('a whole text is converted the same way, leaving list markers and rules alone', () => {
  expect(typographic(`"Hi," he said - 'go.'\n- item\n---\nIt's done -- mostly.`)).toBe(`“Hi,” he said – ‘go.’\n- item\n---\nIt’s done — mostly.`)
})
