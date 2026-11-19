import { CompletionContext, type Completion } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, expect, test, vi } from 'vitest'
import type { WikiEntry, WikiFolder } from '../types'
import { closeWikiBrackets, wikiCompletionSource, type WikiCompletionOptions } from './wikiComplete'

const entry = (id: string, name: string, aliases: string[] = []): WikiEntry => ({
  id,
  bookId: 'b',
  folderId: null,
  name,
  aliases,
  properties: [],
  imageIds: [],
  body: '',
  autoLink: true,
  createdAt: 0,
  updatedAt: 0,
})
const folder = (id: string, name: string): WikiFolder => ({ id, bookId: 'b', parentId: null, name, createdAt: 0 })

let view: EditorView | undefined
afterEach(() => {
  view?.destroy()
  view = undefined
})

function setup(doc: string) {
  const create = vi.fn(async () => {})
  const options: WikiCompletionOptions = {
    entries: () => [entry('p', 'Pascal', ['the Captain']), entry('m', 'Mira'), entry('g', 'Größe Halle')],
    topFolders: () => [folder('c', 'Characters'), folder('l', 'Locations')],
    create,
  }
  view = new EditorView({ parent: document.body, state: EditorState.create({ doc, selection: { anchor: doc.length } }) })
  const result = wikiCompletionSource(options)(new CompletionContext(view.state, doc.length, false))
  return { view, result, create, options }
}

const labels = (options: readonly Completion[]) => options.map((option) => option.label)
const apply = (completion: Completion, result: NonNullable<ReturnType<typeof setup>['result']>) => {
  const fn = completion.apply as (view: EditorView, completion: Completion, from: number, to: number) => void
  fn(view!, completion, result.from, result.to ?? view!.state.doc.length)
}

test('after [[ matching entries and "create" choices are offered', () => {
  const { result } = setup('Er sah [[Pa')
  expect(result).not.toBeNull()
  expect(labels(result!.options)).toEqual([
    'Pascal',
    '„Pa“ neu anlegen in: Characters',
    '„Pa“ neu anlegen in: Locations',
    '„Pa“ neu anlegen ohne Ordner',
  ])
})

test('aliases, umlauts and spaces are found; an exact name offers no "create"', () => {
  expect(labels(setup('[[the C').result!.options)).toEqual(['Pascal', '„the C“ neu anlegen in: Characters', '„the C“ neu anlegen in: Locations', '„the C“ neu anlegen ohne Ordner'])
  expect(labels(setup('[[größe h').result!.options)[0]).toBe('Größe Halle')
  expect(labels(setup('[[Mira').result!.options)).toEqual(['Mira'])
})

test('choosing an existing entry leaves only its name', () => {
  const { result, create } = setup('Er sah [[Pa')
  apply(result!.options[0], result!)
  expect(view!.state.doc.toString()).toBe('Er sah Pascal')
  expect(view!.state.selection.main.head).toBe('Er sah Pascal'.length)
  expect(create).not.toHaveBeenCalled()
})

test('choosing "create" makes the entry in that folder and leaves the name', () => {
  const { result, create } = setup('Da war [[Elena Voss')
  apply(result!.options.find((o) => o.label.endsWith('in: Locations'))!, result!)
  expect(view!.state.doc.toString()).toBe('Da war Elena Voss')
  expect(create).toHaveBeenCalledWith('Elena Voss', 'l')
})

test('no list outside [[ or across lines', () => {
  expect(setup('ein [Link').result).toBeNull()
  expect(setup('[[Pas\ncal').result).toBeNull()
  expect(setup('nichts').result).toBeNull()
})

test('typing ]] after [[Name turns it into the name and creates a missing entry', () => {
  const { view, create, options } = setup('Er sah [[Mira]')
  const at = view.state.doc.length
  expect(closeWikiBrackets(view, at, at, ']', options)).toBe(true)
  expect(view.state.doc.toString()).toBe('Er sah Mira')
  expect(create).not.toHaveBeenCalled()

  view.dispatch({ changes: { from: view.state.doc.length, insert: ' und [[ Kael ]' } })
  const end = view.state.doc.length
  expect(closeWikiBrackets(view, end, end, ']', options)).toBe(true)
  expect(view.state.doc.toString()).toBe('Er sah Mira und Kael')
  expect(create).toHaveBeenCalledWith('Kael', null)
})

test('other brackets are left alone', () => {
  const { view, options } = setup('Liste [x]')
  const at = view.state.doc.length
  expect(closeWikiBrackets(view, at, at, ']', options)).toBe(false)
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'leer [[]' } })
  expect(closeWikiBrackets(view, view.state.doc.length, view.state.doc.length, ']', options)).toBe(false)
  expect(closeWikiBrackets(view, view.state.doc.length, view.state.doc.length, 'x', options)).toBe(false)
})

test('sentences after an unclosed [[ never offer "create"; long ones close the list', () => {
  expect(labels(setup('Er sah [[Privat und ging.').result?.options ?? [])).toEqual([])
  expect(labels(setup('[[eins zwei drei vier fünf').result?.options ?? [])).toEqual([])
  expect(setup('[[' + 'x'.repeat(41)).result).toBeNull()
  expect(labels(setup('[[Mira Voss').result!.options)).toContain('„Mira Voss“ neu anlegen ohne Ordner')
})
