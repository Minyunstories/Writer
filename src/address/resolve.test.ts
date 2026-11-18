import { expect, test } from 'vitest'
import type { AddressForm, BookAddress, WikiEntry, WikiFolder } from '../types'
import { addressHistory, figureFolderId, figuresOf, fill, formOf, involved, personAt, resolveAddress } from './resolve'

const entry = (id: string, name: string, folderId: string | null = 'chars'): WikiEntry => ({
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
})
const folder = (id: string, name: string, parentId: string | null = null): WikiFolder => ({ id, bookId: 'b', parentId, name, createdAt: 1 })

const lea = entry('lea', 'Lea Ravel')
const mira = entry('mira', 'Mira')
const tom = entry('tom', 'Tom')
const pascal = entry('pascal', 'Pascal', 'noble')
const castle = entry('castle', 'Burg', 'places')
const folders = [folder('chars', 'Characters'), folder('noble', 'Adel', 'chars'), folder('places', 'Orte')]
const order = ['c1', 'c2', 'c3']

const duchess = { id: 'r1', name: 'Duchess', public: 'Your Grace · Lady {Nachname}', updatedAt: 1 }
const lady = { id: 'r0', name: 'Lady', public: 'Lady {Nachname}', updatedAt: 1 }
const form = (patch: Partial<AddressForm>): AddressForm => ({ id: 'f1', from: 'mira', to: 'lea', changes: [], createdAt: 1, updatedAt: 1, ...patch })
const book = (patch: Partial<BookAddress>): BookAddress => ({ ranks: [duchess, lady], people: [{ entryId: 'lea', rankId: 'r1', changes: [], updatedAt: 1 }], forms: [], ...patch })

test('rule with placeholders, names from the entry when empty', () => {
  const resolved = resolveAddress(book({}), mira, lea, order, 'c1')
  expect(resolved).toMatchObject({ public: 'Your Grace · Lady Ravel', private: 'Your Grace · Lady Ravel', source: 'rule', rankName: 'Duchess' })
  expect(fill('Sir {Vorname} {Nachname}', { first: 'Tom', last: 'Tom' })).toBe('Sir Tom Tom')
  expect(fill('Lady {Nachname}', { first: 'A', last: '' })).toBe('Lady {Nachname}')
  expect(personAt(book({}), tom, order, null)).toEqual({ first: 'Tom', last: 'Tom' })
})

test('a form replaces only what it fills; changes apply up to the chapter', () => {
  const address = book({ forms: [form({ private: 'Lea', changes: [{ id: 'x', chapterId: 'c3', label: 'Phase 2', private: 'Leelee', note: 'nach dem Ball' }] })] })
  expect(resolveAddress(address, mira, lea, order, 'c2')).toMatchObject({ public: 'Your Grace · Lady Ravel', private: 'Lea', source: 'form' })
  const later = resolveAddress(address, mira, lea, order, 'c3')
  expect(later.private).toBe('Leelee')
  expect(later.notes).toContainEqual({ source: 'Phase 2', text: 'nach dem Ball' })
  expect(resolveAddress(address, mira, lea, order, null).private).toBe('Lea')
})

test('open changes and changes in deleted chapters are pending, not applied', () => {
  const address = book({
    forms: [
      form({
        private: 'Lea',
        changes: [
          { id: 'o', private: 'Ravel', note: 'sobald sie es anbietet' },
          { id: 'g', chapterId: 'gone', private: 'X' },
        ],
      }),
    ],
  })
  const resolved = resolveAddress(address, mira, lea, order, 'c3')
  expect(resolved.private).toBe('Lea')
  expect(resolved.pending.map((change) => change.id)).toEqual(['o', 'g'])
})

test('private stays empty through the layers and then follows public', () => {
  const address = book({ forms: [form({ public: 'Lady Hale' })] })
  expect(resolveAddress(address, mira, lea, order, 'c1')).toMatchObject({ public: 'Lady Hale', private: 'Lady Hale' })
})

test('notes add up with their source', () => {
  const address = book({
    ranks: [{ ...duchess, note: 'Bedienstete: My Lady' }],
    forms: [form({ note: 'kühl', changes: [{ id: 'x', chapterId: 'c1', note: 'Wechsel-Notiz' }] })],
  })
  expect(resolveAddress(address, mira, lea, order, 'c2').notes).toEqual([
    { source: 'Regel: Duchess', text: 'Bedienstete: My Lady' },
    { source: 'Abweichung', text: 'kühl' },
    { source: 'Wechsel', text: 'Wechsel-Notiz' },
  ])
})

test('rank and surname change from a chapter on', () => {
  const address = book({
    people: [
      {
        entryId: 'lea',
        rankId: 'r0',
        changes: [
          { id: 'p', chapterId: 'c3', rankId: 'r1', last: 'Hale' },
          { id: 'q', chapterId: 'gone', last: 'Nobody' },
        ],
        updatedAt: 1,
      },
    ],
  })
  expect(resolveAddress(address, mira, lea, order, 'c2').public).toBe('Lady Ravel')
  expect(resolveAddress(address, mira, lea, order, 'c3').public).toBe('Your Grace · Lady Hale')
  expect(personAt(address, lea, order, null).rank?.id).toBe('r0')
})

test('no rank and no form gives none', () => {
  expect(resolveAddress(book({}), mira, tom, order, 'c1')).toMatchObject({ source: 'none', public: '', private: '' })
})

test('a deleted rank counts as no rank', () => {
  const address = book({ people: [{ entryId: 'lea', rankId: 'rX', changes: [], updatedAt: 1 }] })
  expect(personAt(address, lea, order, 'c1').rank).toBeUndefined()
  expect(resolveAddress(address, mira, lea, order, 'c1').source).toBe('none')
})

test('reordered chapters: changes follow the chapter', () => {
  const address = book({ people: [{ entryId: 'lea', rankId: 'r0', changes: [{ id: 'p', chapterId: 'c2', rankId: 'r1' }], updatedAt: 1 }] })
  expect(resolveAddress(address, mira, lea, ['c1', 'c3', 'c2'], 'c3').public).toBe('Lady Ravel')
  expect(resolveAddress(address, mira, lea, ['c1', 'c3', 'c2'], 'c2').public).toBe('Your Grace · Lady Ravel')
})

test('history lists each change point once', () => {
  const address = book({
    people: [
      {
        entryId: 'lea',
        rankId: 'r0',
        changes: [
          { id: 'n', chapterId: 'c1', first: 'Leandra' },
          { id: 'p', chapterId: 'c2', rankId: 'r1' },
        ],
        updatedAt: 1,
      },
    ],
    forms: [form({ changes: [{ id: 'x', chapterId: 'c3', label: 'Phase 2', private: 'Leelee' }] })],
  })
  expect(addressHistory(address, mira, lea, order)).toEqual([
    { chapterId: null, public: 'Lady Ravel', private: 'Lady Ravel' },
    { chapterId: 'c2', public: 'Your Grace · Lady Ravel', private: 'Your Grace · Lady Ravel' },
    { chapterId: 'c3', label: 'Phase 2', public: 'Your Grace · Lady Ravel', private: 'Leelee' },
  ])
})

test('figures: chosen folder, default by folder name, all, deleted folder falls back', () => {
  const entries = [tom, castle, lea, pascal, mira]
  expect(figureFolderId(undefined, folders)).toBe('chars')
  expect(figuresOf(undefined, entries, folders).map((e) => e.id)).toEqual(['lea', 'mira', 'pascal', 'tom'])
  expect(figuresOf(book({ folder: '*' }), entries, folders).map((e) => e.id)).toEqual(['castle', 'lea', 'mira', 'pascal', 'tom'])
  expect(figuresOf(book({ folder: 'places' }), entries, folders).map((e) => e.id)).toEqual(['castle'])
  expect(figureFolderId(book({ folder: 'gone' }), folders)).toBe('chars')
  expect(figureFolderId(undefined, [folder('places', 'Orte')])).toBeNull()
})

test('formOf takes the newest duplicate', () => {
  const address = book({ forms: [form({ id: 'old', private: 'A', updatedAt: 1 }), form({ id: 'new', private: 'B', updatedAt: 5 })] })
  expect(formOf(address, 'mira', 'lea')?.id).toBe('new')
  expect(formOf(address, 'lea', 'mira')).toBeUndefined()
})

test('involved: a rank now or later, or part of a form', () => {
  const address = book({
    people: [
      { entryId: 'lea', rankId: 'r1', changes: [], updatedAt: 1 },
      { entryId: 'pascal', changes: [{ id: 'p', chapterId: 'c2', rankId: 'r0' }], updatedAt: 1 },
    ],
    forms: [form({ from: 'tom', to: 'mira' })],
  })
  expect(['lea', 'pascal', 'tom', 'mira', 'castle'].map((id) => involved(address, id))).toEqual([true, true, true, true, false])
})
