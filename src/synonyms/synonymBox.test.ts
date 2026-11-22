import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, expect, test } from 'vitest'
import type { CollectionItem } from '../types'
import { showSynonyms, synonymCollection, synonyms } from './synonymBox'
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

const bank: CollectionItem[] = [
  { id: '1', text: 'swift', category: 'Speed', group: 'fast / quick', createdAt: 1, updatedAt: 1 },
  { id: '2', text: 'rapid', category: 'Speed', group: 'fast / quick', createdAt: 2, updatedAt: 2 },
  { id: '3', text: 'like the wind', category: 'Speed', group: 'fast / quick', createdAt: 3, updatedAt: 3 },
  { id: '4', text: 'strolled', category: 'Verbs', group: 'walked (slowly)', createdAt: 4, updatedAt: 4 },
  { id: '5', text: 'ambled', category: 'Verbs', group: 'walked (slowly)', createdAt: 5, updatedAt: 5 },
  { id: '6', text: 'He nodded.', category: '1. Nod', createdAt: 6, updatedAt: 6 },
]

function setupWithBank(doc: string, anchor: number, load: () => Promise<Thesaurus> = async () => thesaurus) {
  view = new EditorView({
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor),
      extensions: [synonyms({ load }), synonymCollection(() => bank)],
    }),
    parent: document.body,
  })
  return view
}
const buttons = () => [...document.querySelectorAll('.cm-mw-synonyms button')]

test('the groups of the collection come first: named after the word or holding it, with the other entries', async () => {
  const view = setupWithBank('A Quick look, rapid and fast.', 4)
  showSynonyms(view)
  await wait()
  const box = document.querySelector('.cm-mw-synonyms')!
  const headings = [...box.querySelectorAll('.cm-mw-synonyms-meaning')].map((p) => p.textContent)
  expect(headings[0]).toBe('Sammlung · Speed · fast / quick')
  expect(headings[1]).toContain('accomplished rapidly')
  // The looked-up word itself is not offered; a phrase is.
  const first = [...box.querySelector('.cm-mw-synonyms-group')!.querySelectorAll('button')]
  expect(first.map((b) => b.dataset.word)).toEqual(['swift', 'rapid', 'like the wind'])
  // Already in the chapter: paler, with a count.
  const rapid = first[1]
  expect(rapid.classList.contains('cm-mw-synonyms-used')).toBe(true)
  expect(rapid.textContent).toBe('rapid1×')
  expect(rapid.title).toBe('1× im Kapitel')
  first[2].click()
  expect(view.state.doc.toString()).toBe('A Like the wind look, rapid and fast.')
})

test('an inflected word finds its group; without the thesaurus the collection still shows', async () => {
  const view = setupWithBank('They were walking home.', 12, () => Promise.reject(new Error('offline')))
  showSynonyms(view)
  await wait()
  const box = document.querySelector('.cm-mw-synonyms')!
  expect(box.querySelector('.cm-mw-synonyms-meaning')!.textContent).toBe('Sammlung · Verbs · walked (slowly)')
  expect(buttons().map((b) => b.textContent)).toEqual(['strolled', 'ambled'])
  expect(box.textContent).toContain('konnten nicht geladen werden')
})
