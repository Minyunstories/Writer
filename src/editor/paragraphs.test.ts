import { expect, test } from 'vitest'
import { mapPosition, separateParagraphs } from './paragraphs'

test('a blank line wherever two text lines meet', () => {
  expect(separateParagraphs('a\nb\nc')).toEqual({ text: 'a\n\nb\n\nc', added: [2, 4] })
})

test('blank lines that are there stay as they are', () => {
  expect(separateParagraphs('a\n\nb')).toEqual({ text: 'a\n\nb', added: [] })
  expect(separateParagraphs('a\n\n\nb')).toEqual({ text: 'a\n\n\nb', added: [] })
})

test('a line of spaces counts as blank', () => {
  expect(separateParagraphs('a\n   \nb')).toEqual({ text: 'a\n   \nb', added: [] })
})

test('headings and scene breaks are lines like any other', () => {
  expect(separateParagraphs('## Title\nText\n***\nMore').text).toBe('## Title\n\nText\n\n***\n\nMore')
})

test('treats \\r\\n as a line break', () => {
  expect(separateParagraphs('a\r\nb').text).toBe('a\n\nb')
  expect(separateParagraphs('a\rb').text).toBe('a\n\nb')
})

test('line breaks at the edges and empty text are left alone', () => {
  expect(separateParagraphs('\na\n')).toEqual({ text: '\na\n', added: [] })
  expect(separateParagraphs('')).toEqual({ text: '', added: [] })
})

test('positions move with the added line breaks', () => {
  expect(mapPosition([2, 4], 1)).toBe(1)
  expect(mapPosition([2, 4], 2)).toBe(3)
  expect(mapPosition([2, 4], 5)).toBe(7)
})

test('only pasting is changed, not dropping or typing', async () => {
  const { EditorState } = await import('@codemirror/state')
  const { pasteParagraphs } = await import('./paragraphs')
  const state = EditorState.create({ doc: 'Mira ran.', extensions: [pasteParagraphs] })
  const insert = (userEvent: string) => state.update({ changes: { from: 9, insert: '\nRain fell.\nTom came.' }, userEvent }).state.doc.toString()
  expect(insert('input.paste')).toBe('Mira ran.\n\nRain fell.\n\nTom came.')
  expect(insert('input.drop')).toBe('Mira ran.\nRain fell.\nTom came.')
  expect(insert('move.drop')).toBe('Mira ran.\nRain fell.\nTom came.')
})
