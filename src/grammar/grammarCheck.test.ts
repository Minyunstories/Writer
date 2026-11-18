import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, expect, test, vi } from 'vitest'
import { grammarCheck, recheckGrammar, type GrammarItem } from './grammarCheck'

let view: EditorView | null = null
afterEach(() => {
  view?.destroy()
  view = null
})

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms))

function setup(doc: string, items: (text: string) => GrammarItem[], extra: Partial<Parameters<typeof grammarCheck>[0]> = {}) {
  const onAddWord = vi.fn()
  const onIgnore = vi.fn()
  let enabled = true
  const check = vi.fn(async (text: string) => items(text))
  view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: grammarCheck({ check, onAddWord, onIgnore, enabled: () => enabled, delay: 0, ...extra }),
    }),
    parent: document.body,
  })
  return { view, check, onAddWord, onIgnore, setEnabled: (on: boolean) => (enabled = on) }
}

const are = (text: string): GrammarItem[] => {
  const at = text.indexOf('are')
  return at < 0 ? [] : [{ from: at, to: at + 3, message: 'Use “is” here.', kind: 'Agreement', suggestions: [{ label: 'is', insert: 'is' }], hash: 'h1' }]
}

test('problems are underlined; with the cursor inside, a box offers the fix', async () => {
  const { view } = setup('This are fine.', are)
  await wait()
  expect(view.dom.querySelector('.cm-mw-grammar')?.textContent).toBe('are')
  view.dispatch({ selection: { anchor: 6 } })
  await wait()
  const box = document.querySelector('.cm-mw-grammar-box')!
  expect(box.textContent).toContain('Use “is” here.')
  ;(box.querySelector('button[aria-label="Ersetzen durch „is“"]') as HTMLButtonElement).click()
  expect(view.state.doc.toString()).toBe('This is fine.')
  await wait()
  expect(view.dom.querySelector('.cm-mw-grammar')).toBeNull()
})

test('a word can be accepted and a spot ignored', async () => {
  const items = (text: string): GrammarItem[] => {
    const at = text.indexOf('Nysss')
    return at < 0 ? [] : [{ from: at, to: at + 5, message: 'Unknown word.', kind: 'Spelling', suggestions: [], word: 'Nysss', hash: 'h2' }]
  }
  const { view, onAddWord, onIgnore } = setup('Hello Nysss.', items)
  await wait()
  view.dispatch({ selection: { anchor: 8 } })
  await wait()
  const ignore = document.querySelector('.cm-mw-grammar-box button[data-action="ignore"]') as HTMLButtonElement
  expect(ignore).not.toBeNull()
  ;(document.querySelector('.cm-mw-grammar-box button[data-action="word"]') as HTMLButtonElement).click()
  expect(onAddWord).toHaveBeenCalledWith('Nysss')
  // The mark goes at once, without waiting for the next check.
  expect(view.dom.querySelector('.cm-mw-grammar')).toBeNull()
  ignore.click()
  expect(onIgnore).toHaveBeenCalledWith('h2')
})

test('switched off: nothing is checked or shown; switched on again after a recheck', async () => {
  const { view, check, setEnabled } = setup('This are fine.', are)
  await wait()
  setEnabled(false)
  view.dispatch({ effects: recheckGrammar.of(null) })
  await wait()
  expect(view.dom.querySelector('.cm-mw-grammar')).toBeNull()
  const calls = check.mock.calls.length
  view.dispatch({ changes: { from: 0, insert: 'So ' } })
  await wait()
  expect(check.mock.calls.length).toBe(calls)
  setEnabled(true)
  view.dispatch({ effects: recheckGrammar.of(null) })
  await wait()
  expect(view.dom.querySelector('.cm-mw-grammar')?.textContent).toBe('are')
})

test('results for an older text are dropped', async () => {
  let release: () => void = () => {}
  const slow = (text: string) => new Promise<GrammarItem[]>((resolve) => (release = () => resolve(are(text))))
  const { view } = setup('This are fine.', () => [], { check: slow })
  await wait()
  view.dispatch({ changes: { from: 0, to: 14, insert: 'Fine.' } })
  release()
  await wait()
  expect(view.dom.querySelector('.cm-mw-grammar')).toBeNull()
})

test('a kind of finding can be switched off for good', async () => {
  const onDisableRule = vi.fn()
  const items = (text: string): GrammarItem[] =>
    text.includes('damn') ? [{ from: 5, to: 9, message: 'Offensive.', kind: 'Style', suggestions: [], rule: 'NoCurses' }] : []
  const { view } = setup('Well damn it.', items, { onDisableRule })
  await wait()
  view.dispatch({ selection: { anchor: 6 } })
  await wait()
  ;(document.querySelector('.cm-mw-grammar-box button[data-action="rule"]') as HTMLButtonElement).click()
  expect(onDisableRule).toHaveBeenCalledWith('NoCurses')
  expect(view.dom.querySelector('.cm-mw-grammar')).toBeNull()
})
