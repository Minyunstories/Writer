import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, expect, test } from 'vitest'
import { buildDecorations } from './livePreview'
import { sceneNameDecorations, sceneNames } from './sceneNames'

function found(doc: string, cursor: number, focused = true) {
  const state = EditorState.create({ doc, selection: { anchor: cursor } })
  const result: { from: number; to: number; text?: string; cls?: string }[] = []
  const iter = sceneNameDecorations(state, [{ from: 0, to: doc.length }], focused).iter()
  while (iter.value) {
    const widget = iter.value.spec.widget as { stars: string | null; name: string } | undefined
    result.push({
      from: iter.from,
      to: iter.to,
      ...(widget ? { text: `${widget.stars ?? ''}|${widget.name}` } : { cls: String(iter.value.spec.class) }),
    })
    iter.next()
  }
  return result
}

const DOC = 'The storm came.\n\n*** Ankunft\n\nMorning came.'

test('away from the cursor, a named break shows its stars with the name under them', () => {
  expect(found(DOC, 0)).toEqual([{ from: 17, to: 28, text: '***|Ankunft' }])
})

test('with the cursor on the line, the line is plain text to edit, the name a little set off', () => {
  expect(found(DOC, 20, false)).toEqual([{ from: 17, to: 28, text: '***|Ankunft' }])
  expect(found(DOC, 20)).toEqual([{ from: 21, to: 28, cls: 'cm-mw-scene-name-raw' }])
  expect(found(DOC, 17)).toEqual([{ from: 21, to: 28, cls: 'cm-mw-scene-name-raw' }])
  expect(found(DOC, 28)).toEqual([{ from: 21, to: 28, cls: 'cm-mw-scene-name-raw' }])
})

test('the name line at the top shows only the name; plain stars stay as they are', () => {
  const doc = '*** Abschied\n\nThe storm came.\n\n***\n\nRain.'
  expect(found(doc, doc.length)).toEqual([{ from: 0, to: 12, text: '|Abschied' }])
})

test('a named break is centred like a plain one', () => {
  const doc = 'Ende.\n*** Ankunft\nNeu.'
  const state = EditorState.create({ doc, extensions: [markdown()] })
  const lines: number[] = []
  const cursor = buildDecorations(state, [{ from: 0, to: doc.length }]).iter()
  while (cursor.value) {
    if (String(cursor.value.spec.class) === 'cm-mw-separator') lines.push(state.doc.lineAt(cursor.from).number)
    cursor.next()
  }
  expect(lines).toEqual([2])
})

let view: EditorView | undefined
afterEach(() => view?.destroy())

test('in the editor, the line turns to text when the cursor arrives and back when it leaves', () => {
  view = new EditorView({ parent: document.body, state: EditorState.create({ doc: DOC, selection: { anchor: 20 }, extensions: [sceneNames()] }) })
  // Not focused yet (a chapter just opened): the name shows, even with the cursor on its line.
  expect(view.dom.querySelector('.cm-mw-scene-name')?.textContent).toBe('Ankunft')
  view.focus()
  view.dispatch({ selection: { anchor: 0 } })
  expect(view.dom.querySelector('.cm-mw-scene-name')?.textContent).toBe('Ankunft')
  view.dispatch({ selection: { anchor: 20 } })
  expect(view.dom.querySelector('.cm-mw-scene')).toBeNull()
  expect(view.dom.querySelector('.cm-mw-scene-name-raw')?.textContent).toBe('Ankunft')
  view.dispatch({ selection: { anchor: 0 } })
  expect(view.dom.querySelector('.cm-mw-scene .cm-mw-scene-stars')?.textContent).toBe('***')
})

test('a jump that marks something inside a name shows the line as text, also without focus', async () => {
  const { StateEffect, StateField } = await import('@codemirror/state')
  const mark = StateEffect.define<{ from: number; to: number } | null>()
  const marked = StateField.define<{ from: number; to: number } | null>({
    create: () => null,
    update: (value, tr) => tr.effects.reduce((current, effect) => (effect.is(mark) ? effect.value : current), value),
  })
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: DOC, extensions: [marked, sceneNames({ reveal: (state) => (state.field(marked) ? [state.field(marked)!] : []) })] }),
  })
  expect(view.dom.querySelector('.cm-mw-scene')).not.toBeNull()
  view.dispatch({ selection: { anchor: 21 }, effects: mark.of({ from: 21, to: 28 }) })
  expect(view.dom.querySelector('.cm-mw-scene')).toBeNull()
  view.dispatch({ effects: mark.of(null) })
  expect(view.dom.querySelector('.cm-mw-scene')).not.toBeNull()
})
