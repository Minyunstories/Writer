import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, expect, test } from 'vitest'
import { showSynonyms, synonyms } from './synonymBox'
import type { Thesaurus } from './thesaurus'

let view: EditorView | null = null
afterEach(() => {
  view?.destroy()
  view = null
})
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

const thesaurus: Thesaurus = {
  s: [['a', 'accomplished rapidly', 'quick', 'speedy', 'fast']],
  w: { quick: [0], speedy: [0], fast: [0] },
}

function setup(doc: string, anchor: number, head = anchor) {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: synonyms({ load: async () => thesaurus }),
    }),
    parent: document.body,
  })
  return view
}

test('the word at the cursor gets a box of synonyms; a click replaces it', async () => {
  const view = setup('A Quick look.', 4)
  showSynonyms(view)
  await wait()
  const box = document.querySelector('.cm-mw-synonyms')!
  expect(box.textContent).toContain('accomplished rapidly')
  const speedy = [...box.querySelectorAll('button')].find((b) => b.textContent === 'speedy')!
  speedy.click()
  expect(view.state.doc.toString()).toBe('A Speedy look.')
  expect(document.querySelector('.cm-mw-synonyms')).toBeNull()
})

test('a selected word works too, and a word without synonyms says so', async () => {
  const view = setup('A quick zorp.', 8, 12)
  showSynonyms(view)
  await wait()
  expect(document.querySelector('.cm-mw-synonyms')?.textContent).toContain('Keine Synonyme für „zorp“')
})

test('Escape closes the box', async () => {
  const view = setup('A quick look.', 3)
  showSynonyms(view)
  await wait()
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(document.querySelector('.cm-mw-synonyms')).toBeNull()
})
