import { expect, test } from 'vitest'
import type { Chapter, WikiEntry, WikiFolder } from '../types'
import { buildMatcher } from './linker'
import { effectiveTemplate, entriesIn, groupByTopFolder, mentionsOf, topFolderOf } from './mentions'

const folder = (id: string, name: string, parentId: string | null = null, template?: string[]): WikiFolder => ({
  id,
  bookId: 'b',
  parentId,
  name,
  createdAt: 0,
  ...(template ? { template } : {}),
})
const entry = (id: string, name: string, folderId: string | null = null, extra: Partial<WikiEntry> = {}): WikiEntry => ({
  id,
  bookId: 'b',
  folderId,
  name,
  aliases: [],
  properties: [],
  imageIds: [],
  body: '',
  autoLink: true,
  createdAt: 1,
  updatedAt: 1,
  ...extra,
})
const chapter = (id: string, content: string): Chapter => ({ id, bookId: 'b', title: id, content, updatedAt: 0 })

const folders = [
  folder('chars', 'Characters', null, ['Augenfarbe', 'Alter']),
  folder('royals', 'Royals', 'chars'),
  folder('locs', 'Locations'),
  folder('loopA', 'A', 'loopB'),
  folder('loopB', 'B', 'loopA'),
]
const entries = [
  entry('pascal', 'Pascal', 'royals', { aliases: ['the Captain'] }),
  entry('mira', 'Mira', 'chars'),
  entry('hafen', 'Hafen', 'locs'),
  entry('note', 'Notiz'),
  entry('off', 'Storm', 'locs', { autoLink: false }),
]
const matcher = buildMatcher(entries)
const chapters = [
  chapter('c1', 'Pascal ging zum Hafen. Storm zog auf.'),
  chapter('c2', 'Nichts.'),
  chapter('c3', 'Mira sah the Captain. Pascal lachte.\nMira auch.'),
]

test('mentionsOf counts per chapter in order with the first position', () => {
  expect(mentionsOf('pascal', chapters, matcher)).toEqual([
    { chapterId: 'c1', count: 1, first: { from: 0, to: 6 } },
    { chapterId: 'c3', count: 2, first: { from: 9, to: 20 } },
  ])
  expect(mentionsOf('off', chapters, matcher)).toEqual([])
  expect(mentionsOf('unknown', chapters, matcher)).toEqual([])
})

test('entriesIn lists distinct entries in order of first appearance', () => {
  expect(entriesIn(chapters[2], matcher)).toEqual(['mira', 'pascal'])
  expect(entriesIn(chapters[1], matcher)).toEqual([])
})

test('topFolderOf walks up and survives loops', () => {
  expect(topFolderOf('royals', folders)!.id).toBe('chars')
  expect(topFolderOf('chars', folders)!.id).toBe('chars')
  expect(topFolderOf(null, folders)).toBeNull()
  expect(topFolderOf('missing', folders)).toBeNull()
  expect(['loopA', 'loopB']).toContain(topFolderOf('loopA', folders)!.id)
})

test('effectiveTemplate comes from the top-level folder', () => {
  expect(effectiveTemplate({ folderId: 'royals' }, folders)).toEqual(['Augenfarbe', 'Alter'])
  expect(effectiveTemplate({ folderId: 'locs' }, folders)).toEqual([])
  expect(effectiveTemplate({ folderId: null }, folders)).toEqual([])
})

test('groupByTopFolder groups by top-level folder, sorted by name, loose entries last', () => {
  const groups = groupByTopFolder(['hafen', 'note', 'pascal', 'mira', 'unknown'], entries, folders)
  expect(groups.map((g) => [g.folder?.name ?? null, g.entries.map((e) => e.name)])).toEqual([
    ['Characters', ['Pascal', 'Mira']],
    ['Locations', ['Hafen']],
    [null, ['Notiz']],
  ])
})
