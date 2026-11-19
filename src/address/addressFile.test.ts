import { expect, test } from 'vitest'
import type { BookAddress } from '../types'
import { addressFile, mergeAddress, parseAddress } from './addressFile'

const sorted: BookAddress = {
  folder: 'f1',
  ranks: [
    { id: 'r2', name: 'King', public: 'Your Majesty', private: 'Sire', updatedAt: 2 },
    { id: 'r1', name: 'Duchess', public: 'Your Grace · Lady {Nachname}', note: 'Bedienstete: My Lady', updatedAt: 1 },
  ],
  people: [
    {
      entryId: 'lea',
      rankId: 'r1',
      first: 'Lea',
      last: 'Brandt',
      changes: [
        { id: 'p1', chapterId: 'c2', rankId: 'r2' },
        { id: 'p2', chapterId: 'c3', last: 'Hale' },
      ],
      updatedAt: 3,
    },
    { entryId: 'mira', changes: [], updatedAt: 1 },
  ],
  forms: [
    {
      id: 'a',
      from: 'mira',
      to: 'lea',
      private: 'Lea',
      changes: [
        { id: 'ch1', chapterId: 'c2', label: 'Phase 2', private: 'Leelee', note: 'nach dem Ball' },
        { id: 'ch2', private: 'Brandt', note: 'sobald sie es anbietet' },
      ],
      createdAt: 1,
      updatedAt: 4,
    },
    { id: 'b', from: 'lea', to: 'mira', public: 'Mistress Mira', changes: [], createdAt: 2, updatedAt: 2 },
  ],
  deleted: ['x1', 'z9'],
}

test('round trip is lossless and stable', () => {
  const shuffled: BookAddress = { ...sorted, people: [...sorted.people].reverse(), forms: [...sorted.forms].reverse(), deleted: ['z9', 'x1'] }
  const file = addressFile(shuffled)!
  expect(parseAddress(file)).toEqual(sorted)
  expect(addressFile(parseAddress(file)!)).toBe(file)
  const raw = JSON.parse(file)
  expect(raw.ranks.map((r: { id: string }) => r.id)).toEqual(['r2', 'r1'])
  expect(raw.people[0]).toEqual({
    entry: 'lea',
    rank: 'r1',
    first: 'Lea',
    last: 'Brandt',
    changes: [
      { id: 'p1', chapter: 'c2', rank: 'r2' },
      { id: 'p2', chapter: 'c3', last: 'Hale' },
    ],
    updatedAt: 3,
  })
  expect(raw.forms[0].changes[1]).toEqual({ id: 'ch2', private: 'Brandt', note: 'sobald sie es anbietet' })
  expect(raw.forms[1]).toEqual({ id: 'b', from: 'lea', to: 'mira', public: 'Mistress Mira', changes: [], createdAt: 2, updatedAt: 2 })
})

test('nothing to write means no file', () => {
  expect(addressFile({ ranks: [], people: [], forms: [] })).toBeUndefined()
  expect(addressFile({ folder: '*', ranks: [], people: [], forms: [] })).toBeDefined()
})

test('unknown fields survive at every level', () => {
  const file = JSON.stringify({
    tone: 'formal',
    ranks: [{ id: 'r1', name: 'Duchess', public: 'Your Grace', updatedAt: 1, color: 'gold' }],
    people: [{ entry: 'lea', changes: [{ id: 'p1', chapter: 'c1', last: 'X', why: 'Heirat' }], updatedAt: 1, since: 'birth' }],
    forms: [{ id: 'a', from: 'mira', to: 'lea', public: 'Lea', changes: [{ id: 'ch1', chapter: 'c1', private: 'L', weather: 'rain' }], createdAt: 1, updatedAt: 1, mood: 'warm' }],
  })
  const written = JSON.parse(addressFile(parseAddress(file)!)!)
  expect(written.tone).toBe('formal')
  expect(written.ranks[0].color).toBe('gold')
  expect(written.people[0].since).toBe('birth')
  expect(written.people[0].changes[0].why).toBe('Heirat')
  expect(written.forms[0].mood).toBe('warm')
  expect(written.forms[0].changes[0].weather).toBe('rain')
})

test('broken data is tolerated', () => {
  expect(parseAddress('nope')).toBeNull()
  expect(parseAddress('[]')).toBeNull()
  expect(parseAddress(undefined)).toBeNull()
  const parsed = parseAddress(
    JSON.stringify({
      ranks: [{ id: 'r1', public: 'x' }, { id: 'r2', name: 'King' }],
      people: [{ rank: 'r2' }, { entry: 'lea', changes: [{ id: 'p1', last: 'X' }, { id: 'p2', chapter: 'c1', last: 'Y' }] }],
      forms: [{ id: 'a', to: 'lea' }, { id: 'b', from: 'mira', to: 'lea', changes: [{ id: 'ch1', private: 'L' }] }],
    }),
  )!
  expect(parsed.ranks).toEqual([{ id: 'r2', name: 'King', public: '', updatedAt: 0 }])
  expect(parsed.people).toEqual([{ entryId: 'lea', changes: [{ id: 'p2', chapterId: 'c1', last: 'Y' }], updatedAt: 0 }])
  expect(parsed.forms).toEqual([{ id: 'b', from: 'mira', to: 'lea', changes: [{ id: 'ch1', private: 'L' }], createdAt: 0, updatedAt: 0 }])
})

test('merge: newer wins per rank, person and form; deletions stay; rank order from this device', () => {
  const mine: BookAddress = {
    ranks: [
      { id: 'r2', name: 'King', public: 'Your Majesty', updatedAt: 1 },
      { id: 'r1', name: 'Duchess', public: 'Your Grace', updatedAt: 5 },
    ],
    people: [{ entryId: 'lea', rankId: 'r1', changes: [], updatedAt: 2 }],
    forms: [{ id: 'a', from: 'mira', to: 'lea', private: 'Lea', changes: [], createdAt: 1, updatedAt: 1 }],
  }
  const theirs: BookAddress = {
    folder: 'f9',
    ranks: [
      { id: 'r1', name: 'Herzogin', public: 'Euer Gnaden', updatedAt: 3 },
      { id: 'r3', name: 'Knight', public: 'Sir {Vorname}', updatedAt: 3 },
    ],
    people: [{ entryId: 'lea', rankId: 'r3', changes: [], updatedAt: 7 }],
    forms: [{ id: 'a', from: 'mira', to: 'lea', private: 'Leelee', changes: [], createdAt: 1, updatedAt: 6 }],
    deleted: ['r2'],
  }
  const merged = mergeAddress(mine, theirs)
  expect(merged.ranks.map((r) => [r.id, r.name])).toEqual([
    ['r1', 'Duchess'],
    ['r3', 'Knight'],
  ])
  expect(merged.people[0].rankId).toBe('r3')
  expect(merged.forms[0].private).toBe('Leelee')
  expect(merged.deleted).toEqual(['r2'])
  expect(merged.folder).toBe('f9')
  expect(mergeAddress({ ...mine, folder: 'f1' }, theirs).folder).toBe('f1')
})
