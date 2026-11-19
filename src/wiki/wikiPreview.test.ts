import { EditorState } from '@codemirror/state'
import { afterEach, expect, test, vi } from 'vitest'
import type { WikiEntry, WikiFolder } from '../types'
import { buildMatcher } from './linker'
import { linkAt, previewCard, previewData } from './wikiPreview'

const entry = (patch: Partial<WikiEntry>): WikiEntry => ({
  id: 'e1',
  bookId: 'b1',
  folderId: null,
  name: 'Mira',
  aliases: [],
  properties: [],
  imageIds: [],
  body: '',
  autoLink: true,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})

afterEach(() => {
  vi.restoreAllMocks()
})

test('linkAt finds the name under the pointer', () => {
  const matcher = buildMatcher([entry({ id: 'm', name: 'Mira' })])
  const state = EditorState.create({ doc: 'Then Mira smiled.\nMira\'s cup.' })
  expect(linkAt(matcher, state, 7, 1)).toEqual({ from: 5, to: 9, entryId: 'm' })
  expect(linkAt(matcher, state, 5, 1)).toEqual({ from: 5, to: 9, entryId: 'm' })
  expect(linkAt(matcher, state, 5, -1)).toBeNull()
  expect(linkAt(matcher, state, 9, -1)).toEqual({ from: 5, to: 9, entryId: 'm' })
  expect(linkAt(matcher, state, 9, 1)).toBeNull()
  expect(linkAt(matcher, state, 2, 1)).toBeNull()
  // "Mira's" on the next line.
  expect(linkAt(matcher, state, 20, 1)).toEqual({ from: 18, to: 22, entryId: 'm' })
})

test('previewData: the first three filled-in properties, in template order', () => {
  const folders = [{ id: 'f1', bookId: 'b1', name: 'Figuren', parentId: null, createdAt: 1, template: ['Alter', 'Augenfarbe', 'Größe'] } as WikiFolder]
  const data = previewData(
    entry({
      folderId: 'f1',
      aliases: ['die Ältere'],
      properties: [
        { id: 'p1', key: 'Lieblingsort', value: 'der Hafen' },
        { id: 'p2', key: 'Größe', value: '' },
        { id: 'p3', key: 'Augenfarbe', value: 'grün' },
        { id: 'p4', key: 'Alter', value: '32' },
        { id: 'p5', key: 'Schwester', value: '[[Lea]]' },
      ],
    }),
    folders,
  )
  expect(data).toEqual({
    name: 'Mira',
    aliases: ['die Ältere'],
    properties: [
      { key: 'Alter', value: '32' },
      { key: 'Augenfarbe', value: 'grün' },
      { key: 'Lieblingsort', value: 'der Hafen' },
    ],
  })
  expect(previewData(entry({ properties: [{ id: 'p', key: 'Schwester', value: 'die [[Lea]]' }] }), []).properties).toEqual([{ key: 'Schwester', value: 'die Lea' }])
})

test('previewCard shows name, aliases, properties and the portrait, and frees the portrait', () => {
  const createObjectURL = vi.fn(() => 'blob:portrait')
  const revokeObjectURL = vi.fn()
  Object.assign(URL, { createObjectURL, revokeObjectURL })
  const card = previewCard(
    { name: 'Mira', aliases: ['die Ältere', 'M.'], properties: [{ key: 'Alter', value: '32' }] },
    { type: 'image/webp', data: new Uint8Array([1, 2]).buffer },
  )
  expect(card.dom.querySelector('.cm-mw-preview-name')!.textContent).toBe('Mira')
  expect(card.dom.querySelector('.cm-mw-preview-aliases')!.textContent).toBe('auch: die Ältere, M.')
  expect([...card.dom.querySelectorAll('dt')].map((el) => el.textContent)).toEqual(['Alter'])
  expect([...card.dom.querySelectorAll('dd')].map((el) => el.textContent)).toEqual(['32'])
  expect(card.dom.querySelector('img')!.getAttribute('src')).toBe('blob:portrait')
  card.destroy()
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:portrait')
})

test('previewCard without portrait or properties shows just the name', () => {
  const card = previewCard({ name: 'Lea', aliases: [], properties: [] }, null)
  expect(card.dom.querySelector('img')).toBeNull()
  expect(card.dom.querySelector('dl')).toBeNull()
  expect(card.dom.querySelector('.cm-mw-preview-aliases')).toBeNull()
  expect(card.dom.textContent).toBe('Lea')
  card.destroy()
})

test('previewTooltip: over a name, the card; elsewhere or without data, nothing', async () => {
  const { previewTooltip } = await import('./wikiPreview')
  const matcher = buildMatcher([entry({ id: 'm', name: 'Mira' })])
  const state = EditorState.create({ doc: 'Then Mira smiled.' })
  const preview = vi.fn(async (entryId: string) => (entryId === 'm' ? () => previewCard({ name: 'Mira', aliases: [], properties: [] }, null) : null))
  const tooltip = await previewTooltip(state, 6, 1, matcher, preview)
  expect(tooltip).toMatchObject({ pos: 5, end: 9, above: true })
  expect(tooltip!.create(null as never).dom.textContent).toBe('Mira')
  expect(await previewTooltip(state, 1, 1, matcher, preview)).toBeNull()
  expect(await previewTooltip(state, 6, 1, matcher, async () => null)).toBeNull()
})
