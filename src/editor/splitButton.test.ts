import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, expect, test, vi } from 'vitest'
import { splitButton } from './splitButton'

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

function open(doc: string, cursor: number) {
  const onSplit = vi.fn()
  const parent = document.createElement('div')
  document.body.append(parent)
  const view = new EditorView({ state: EditorState.create({ doc, selection: EditorSelection.cursor(cursor), extensions: [splitButton(onSplit)] }), parent })
  views.push(view)
  return { view, onSplit, button: () => view.dom.querySelector<HTMLButtonElement>('.cm-mw-split') }
}

const DOC = 'Eins\n\n## Der Winter\n\nZwei\n\n### Klein'

test('the button shows only in a ## line with the cursor in it', () => {
  const { view, button } = open(DOC, DOC.indexOf('Winter'))
  expect(button()?.textContent).toBe('In neues Kapitel')
  view.dispatch({ selection: { anchor: 1 } })
  expect(button()).toBeNull()
  view.dispatch({ selection: { anchor: DOC.indexOf('Klein') } })
  expect(button()).toBeNull()
})

test('a click reports where the line starts', () => {
  const { button, onSplit } = open(DOC, DOC.indexOf('Winter'))
  button()!.click()
  expect(onSplit).toHaveBeenCalledWith(DOC.indexOf('## Der'))
})

test('pressing the button does not take the focus from the text', () => {
  const { button } = open(DOC, DOC.indexOf('Winter'))
  const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
  button()!.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)
})
