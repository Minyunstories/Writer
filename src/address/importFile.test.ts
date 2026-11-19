import { describe, expect, test } from 'vitest'
import type { BookAddress, WikiEntry } from '../types'
import { matchFigure, parseAddressImport, planAddressImport, type AddressImport } from './importFile'

const entry = (id: string, name: string, aliases: string[] = []): WikiEntry => ({
  id,
  bookId: 'b',
  folderId: 'chars',
  name,
  aliases,
  properties: [],
  imageIds: [],
  body: '',
  autoLink: true,
  createdAt: 0,
  updatedAt: 0,
})

const file = (data: Partial<AddressImport> & Record<string, unknown>) => JSON.stringify({ writer: 'address-import', version: 1, ranks: [], people: [], forms: [], ...data })

describe('parseAddressImport', () => {
  test('reads ranks, people and forms; trims texts, drops empty ones, changes default to none', () => {
    const data = parseAddressImport(
      file({
        ranks: [{ name: ' Knight ', public: 'Sir {Vorname}', private: ' ', note: 'Old order' }],
        people: [{ name: 'Mira Hale', rank: 'Knight', first: '', last: 'Hale' }],
        forms: [
          { from: 'Mira Hale', to: 'Lea', public: 'My Lady', changes: [{ label: 'Phase 2', private: 'Lea' }] },
          { from: 'Lea', to: 'Mira Hale', note: 'Never warm' },
        ] as never,
      }),
    )
    expect(data).toEqual({
      ranks: [{ name: 'Knight', public: 'Sir {Vorname}', note: 'Old order' }],
      people: [{ name: 'Mira Hale', rank: 'Knight', last: 'Hale' }],
      forms: [
        { from: 'Mira Hale', to: 'Lea', public: 'My Lady', changes: [{ label: 'Phase 2', private: 'Lea' }] },
        { from: 'Lea', to: 'Mira Hale', note: 'Never warm', changes: [] },
      ],
    })
  })

  test('refuses anything that is not an address import of version 1', () => {
    expect(parseAddressImport('not json')).toBeNull()
    expect(parseAddressImport(JSON.stringify({ writer: 'something-else', version: 1, ranks: [], people: [], forms: [] }))).toBeNull()
    expect(parseAddressImport(file({ version: 2 }))).toBeNull()
    expect(parseAddressImport(JSON.stringify({ writer: 'address-import', version: 1, ranks: [], people: [] }))).toBeNull()
    expect(parseAddressImport(file({ ranks: [{ name: 'Knight' }] as never }))).toBeNull()
    expect(parseAddressImport(file({ ranks: [{ public: 'Sir' }] as never }))).toBeNull()
    expect(parseAddressImport(file({ forms: [{ from: 'Mira' }] as never }))).toBeNull()
  })
})

describe('matchFigure', () => {
  const mira = entry('mira', 'Mira Hale', ['The Swan'])
  const lea = entry('lea', 'Lea')
  const tomL = entry('toml', 'Tom Lind')
  const tomB = entry('tomb', 'Tom Berg')
  const figures = [mira, lea, tomL, tomB]

  test('finds a figure by its name, an alias or its first name, ignoring case', () => {
    expect(matchFigure('mira hale', figures)).toBe(mira)
    expect(matchFigure('the swan', figures)).toBe(mira)
    expect(matchFigure('Mira', figures)).toBe(mira)
    expect(matchFigure('Lea', figures)).toBe(lea)
  })

  test('the first-name fallback is only for one-word names: titles must not match another figure', () => {
    const knight = entry('knight', 'Sir Pascal Berg')
    const mage = entry('mage', 'High Mage Ida')
    expect(matchFigure('Sir Ben', [knight, mage])).toBeUndefined()
    expect(matchFigure('High Mage Nora', [knight, mage])).toBeUndefined()
    expect(matchFigure('Lea Ravel', figures)).toBeUndefined()
    expect(matchFigure('Tom Berg', [tomL])).toBeUndefined()
  })

  test('two figures with the same first name: only the full name finds one', () => {
    expect(matchFigure('Tom', figures)).toBeUndefined()
    expect(matchFigure('Tom Berg', figures)).toBe(tomB)
  })

  test('an exact name wins over first-name matches; unknown names find nothing', () => {
    const tom = entry('tom', 'Tom')
    expect(matchFigure('Tom', [tomL, tom, tomB])).toBe(tom)
    expect(matchFigure('Pascal', figures)).toBeUndefined()
  })
})

describe('planAddressImport', () => {
  const mira = entry('mira', 'Mira Hale')
  const lea = entry('lea', 'Lea')
  const tom = entry('tom', 'Tom')
  const figures = [mira, lea, tom]
  let counter = 0
  const make = () => ({ id: () => `new${++counter}`, now: 1000 })

  const existing: BookAddress = {
    folder: 'chars',
    ranks: [
      { id: 'r-knight', name: 'knight', public: 'Sir', updatedAt: 5 },
      { id: 'r-old', name: 'Herzogin', public: 'Euer Gnaden', updatedAt: 5 },
    ],
    people: [
      { entryId: 'tom', rankId: 'r-old', first: 'Tommy', changes: [{ id: 'c1', chapterId: 'ch1', rankId: 'r-knight' }], updatedAt: 5 },
      { entryId: 'mira', changes: [], updatedAt: 5 },
    ],
    forms: [{ id: 'f-old', from: 'tom', to: 'lea', public: 'Lea', changes: [], createdAt: 1, updatedAt: 5 }],
    deleted: ['gone'],
  }

  const data: AddressImport = {
    ranks: [
      { name: 'Duchess', public: 'Your Grace / Lady {Nachname}' },
      { name: 'Knight', public: 'Sir {Vorname}', note: 'Old order' },
    ],
    people: [
      { name: 'Mira', rank: 'Knight', last: 'Hale' },
      { name: 'Lea', rank: 'Duchess' },
      { name: 'Pascal', rank: 'Knight' },
    ],
    forms: [
      { from: 'Mira', to: 'Lea', public: 'Your Grace', changes: [{ label: 'Phase 2', private: 'Lea' }] },
      { from: 'Mira', to: 'Lea', public: 'Twice', changes: [] },
      { from: 'Lea', to: 'Lea', public: 'Myself', changes: [] },
      { from: 'Pascal', to: 'Mira', public: 'Sir Mira', changes: [] },
      { from: 'Lea', to: 'Ida', public: 'Ida', changes: [] },
    ],
  }

  test('ranks follow the file; a rank of the same name keeps its id, the others are removed', () => {
    const { address } = planAddressImport(existing, data, figures, make())
    expect(address.ranks.map((rank) => rank.name)).toEqual(['Duchess', 'Knight'])
    const knight = address.ranks[1]
    expect(knight).toMatchObject({ id: 'r-knight', public: 'Sir {Vorname}', note: 'Old order' })
    expect(knight.updatedAt).toBeGreaterThan(5)
    expect(address.ranks.some((rank) => rank.id === 'r-old')).toBe(false)
    expect(address.deleted).toEqual(expect.arrayContaining(['gone', 'r-old']))
    expect(address.folder).toBe('chars')
  })

  test('figures get rank and names from the file; figures not in the file are cleared', () => {
    const { address } = planAddressImport(existing, data, figures, make())
    const knight = address.ranks.find((rank) => rank.name === 'Knight')!
    const duchess = address.ranks.find((rank) => rank.name === 'Duchess')!
    const person = (id: string) => address.people.find((item) => item.entryId === id)
    expect(person('mira')).toMatchObject({ rankId: knight.id, last: 'Hale', changes: [] })
    expect(person('mira')!.first).toBeUndefined()
    expect(person('lea')).toMatchObject({ rankId: duchess.id, changes: [] })
    expect(person('tom')).toMatchObject({ entryId: 'tom', changes: [] })
    expect(person('tom')!.rankId).toBeUndefined()
    expect(person('tom')!.first).toBeUndefined()
    expect(person('tom')!.updatedAt).toBeGreaterThan(5)
  })

  test('forms are replaced; changes come open (no chapter); unknown names are reported and skipped', () => {
    const { address, report } = planAddressImport(existing, data, figures, make())
    expect(address.forms).toHaveLength(1)
    const form = address.forms[0]
    expect(form).toMatchObject({ from: 'mira', to: 'lea', public: 'Your Grace' })
    expect(form.changes).toHaveLength(1)
    expect(form.changes[0]).toMatchObject({ label: 'Phase 2', private: 'Lea' })
    expect(form.changes[0].chapterId).toBeUndefined()
    expect(address.deleted).toContain('f-old')
    expect(report).toEqual({ ranks: 2, people: 2, forms: 1, missing: ['Ida', 'Pascal'] })
  })

  test('importing the same file again creates nothing twice and keeps the rank ids', () => {
    const first = planAddressImport(existing, data, figures, make())
    const second = planAddressImport(first.address, data, figures, make())
    expect(second.address.ranks.map((rank) => rank.id)).toEqual(first.address.ranks.map((rank) => rank.id))
    expect(second.address.forms).toHaveLength(1)
    expect(second.address.people.map(({ entryId, rankId, first, last, changes }) => ({ entryId, rankId, first, last, changes }))).toEqual(
      first.address.people.map(({ entryId, rankId, first, last, changes }) => ({ entryId, rankId, first, last, changes })),
    )
  })

  test('a book without address data gets one', () => {
    const { address, report } = planAddressImport(undefined, data, figures, make())
    expect(address.ranks).toHaveLength(2)
    expect(address.people).toHaveLength(2)
    expect(report.forms).toBe(1)
  })
})
