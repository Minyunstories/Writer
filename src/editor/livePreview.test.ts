import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { expect, test } from 'vitest'
import { buildDecorations } from './livePreview'
import { highlightSyntax } from './markdownSetup'

const DOC = '# Titel\n\nEin **fetter** und *kursiver* Satz.'

function decorations(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdown()] })
  const found: { from: number; to: number; cls: string }[] = []
  const set = buildDecorations(state, [{ from: 0, to: doc.length }])
  const cursor = set.iter()
  while (cursor.value) {
    found.push({ from: cursor.from, to: cursor.to, cls: String(cursor.value.spec.class) })
    cursor.next()
  }
  return found
}

function classesAt(doc: string, text: string): string[] {
  const from = doc.indexOf(text)
  const to = from + text.length
  return decorations(doc)
    .filter((d) => d.from !== d.to && d.from <= from && d.to >= to)
    .map((d) => d.cls)
}

test('heading line gets its level class', () => {
  const lines = decorations(DOC).filter((d) => d.cls.startsWith('cm-mw-h'))
  expect(lines).toEqual([{ from: 0, to: 0, cls: 'cm-mw-h1' }])
  expect(decorations('## Zwei').some((d) => d.cls === 'cm-mw-h2')).toBe(true)
  expect(decorations('##### Fünf').some((d) => d.cls === 'cm-mw-h3')).toBe(true)
})

test('bold and italic text get their classes', () => {
  expect(classesAt(DOC, 'fetter')).toContain('cm-mw-bold')
  expect(classesAt(DOC, 'fetter')).not.toContain('cm-mw-italic')
  expect(classesAt(DOC, 'kursiver')).toContain('cm-mw-italic')
  expect(classesAt(DOC, 'kursiver')).not.toContain('cm-mw-bold')
})

test('markdown markers are marked so they can recede', () => {
  const marks = decorations(DOC)
    .filter((d) => d.cls === 'cm-mw-mark')
    .map((d) => DOC.slice(d.from, d.to))
  expect(marks).toEqual(['#', '**', '**', '*', '*'])
})

test('plain text carries no decoration', () => {
  expect(classesAt(DOC, 'Ein')).toEqual([])
  expect(classesAt(DOC, 'Satz')).toEqual([])
})

test('empty lines between paragraphs are marked so they can be drawn smaller', () => {
  const blanks = decorations('Eins\n\nZwei\n\n\nDrei').filter((d) => d.cls === 'cm-mw-blank')
  expect(blanks.map((d) => d.from)).toEqual([5, 11, 12])
  expect(decorations('Eins\nZwei').some((d) => d.cls === 'cm-mw-blank')).toBe(false)
})

function highlightClasses(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdown({ extensions: [highlightSyntax] })] })
  const found: { from: number; to: number; cls: string }[] = []
  const cursor = buildDecorations(state, [{ from: 0, to: doc.length }]).iter()
  while (cursor.value) {
    found.push({ from: cursor.from, to: cursor.to, cls: String(cursor.value.spec.class) })
    cursor.next()
  }
  return found
}

test('==text== is highlighted and its markers are dimmed', () => {
  const doc = 'Ein ==wichtiger Satz== hier.'
  const found = highlightClasses(doc)
  const from = doc.indexOf('wichtiger')
  expect(found.some((d) => d.cls === 'cm-mw-highlight' && d.from <= from && d.to >= from + 'wichtiger Satz'.length)).toBe(true)
  const marks = found.filter((d) => d.cls === 'cm-mw-mark').map((d) => doc.slice(d.from, d.to))
  expect(marks).toEqual(['==', '=='])
})

test('a lone, spaced or unclosed == is not a highlight', () => {
  for (const doc of ['a==b und weiter', 'x == y und z', '== a ==', 'Ein ==offen bis zum Ende']) {
    expect(highlightClasses(doc).some((d) => d.cls === 'cm-mw-highlight')).toBe(false)
  }
})
