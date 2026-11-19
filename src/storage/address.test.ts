import { beforeEach, expect, test } from 'vitest'
import { addRank, deleteForm, deleteRank, importAddress, moveRank, saveForm, setFigureFolder, setPerson, updateRank } from './address'
import { CHANGED_EVENT } from './connection'
import type { WikiEntry } from '../types'
import { createBook, getBook, resetDatabaseForTests } from './db'

beforeEach(async () => {
  await resetDatabaseForTests()
})

const addressOf = async (bookId: string) => (await getBook(bookId))!.address!
const order = ['c1', 'c2', 'c3']
const tick = () => new Promise((resolve) => setTimeout(resolve, 2))

test('ranks: add, edit, reorder, delete', async () => {
  const book = await createBook('B')
  const king = await addRank(book.id, '  King ')
  const duchess = await addRank(book.id, 'Duchess')
  expect(king).toMatchObject({ name: 'King', public: '' })
  await expect(addRank(book.id, '  ')).rejects.toThrow()
  await updateRank(book.id, duchess.id, { public: ' Your Grace ', private: '', note: 'Bedienstete: My Lady' })
  expect((await addressOf(book.id)).ranks[1]).toMatchObject({ name: 'Duchess', public: 'Your Grace', note: 'Bedienstete: My Lady' })
  expect((await addressOf(book.id)).ranks[1].private).toBeUndefined()
  await moveRank(book.id, duchess.id, -1)
  expect((await addressOf(book.id)).ranks.map((r) => r.name)).toEqual(['Duchess', 'King'])
  await moveRank(book.id, duchess.id, -1)
  expect((await addressOf(book.id)).ranks.map((r) => r.name)).toEqual(['Duchess', 'King'])
  await deleteRank(book.id, king.id)
  const address = await addressOf(book.id)
  expect(address.ranks.map((r) => r.name)).toEqual(['Duchess'])
  expect(address.deleted).toEqual([king.id])
})

test('saving an unchanged rank or person writes nothing', async () => {
  const book = await createBook('B')
  const rank = await addRank(book.id, 'Duchess')
  await updateRank(book.id, rank.id, { public: 'Your Grace' })
  await setPerson(book.id, 'lea', { rankId: rank.id, first: 'Lea' }, order)
  const before = await addressOf(book.id)
  await tick()
  await updateRank(book.id, rank.id, { name: 'Duchess', public: ' Your Grace ' })
  await setPerson(book.id, 'lea', { rankId: rank.id, first: 'Lea ', changes: [] }, order)
  const after = await addressOf(book.id)
  expect(after.ranks[0].updatedAt).toBe(before.ranks[0].updatedAt)
  expect(after.people[0].updatedAt).toBe(before.people[0].updatedAt)
})

test('setPerson sorts changes by chapter and clears the rank with null', async () => {
  const book = await createBook('B')
  await setPerson(
    book.id,
    'lea',
    {
      rankId: 'r1',
      changes: [
        { chapterId: 'c3', last: 'Hale' },
        { chapterId: 'c2', rankId: 'r2' },
        { chapterId: 'c1' },
      ],
    },
    order,
  )
  let person = (await addressOf(book.id)).people[0]
  expect(person.changes.map((c) => c.chapterId)).toEqual(['c2', 'c3'])
  expect(person.changes.every((c) => c.id)).toBe(true)
  await setPerson(book.id, 'lea', { rankId: null }, order)
  person = (await addressOf(book.id)).people[0]
  expect(person.rankId).toBeUndefined()
  expect(person.changes).toHaveLength(2)
})

test('saveForm creates, updates and sorts changes, open ones last', async () => {
  const book = await createBook('B')
  await saveForm(
    book.id,
    {
      from: 'mira',
      to: 'lea',
      private: ' Lea ',
      changes: [
        { private: 'Ravel', note: 'sobald sie es anbietet' },
        { chapterId: 'c3', label: 'Phase 2', private: 'Leelee' },
        { chapterId: 'c1', public: 'Lady Lea' },
      ],
    },
    order,
  )
  let forms = (await addressOf(book.id)).forms
  expect(forms).toHaveLength(1)
  expect(forms[0]).toMatchObject({ from: 'mira', to: 'lea', private: 'Lea' })
  expect(forms[0].changes.map((c) => c.chapterId ?? 'open')).toEqual(['c1', 'c3', 'open'])
  await saveForm(book.id, { from: 'mira', to: 'lea', private: 'Leelee', changes: [] }, order)
  forms = (await addressOf(book.id)).forms
  expect(forms).toHaveLength(1)
  expect(forms[0]).toMatchObject({ private: 'Leelee', changes: [] })
})

test('an empty form is deleted, not stored', async () => {
  const book = await createBook('B')
  await saveForm(book.id, { from: 'mira', to: 'lea', private: 'Lea', changes: [] }, order)
  const id = (await addressOf(book.id)).forms[0].id
  await saveForm(book.id, { from: 'mira', to: 'lea', public: ' ', changes: [{ label: '  ' }] }, order)
  const address = await addressOf(book.id)
  expect(address.forms).toEqual([])
  expect(address.deleted).toEqual([id])
  await saveForm(book.id, { from: 'tom', to: 'lea', changes: [] }, order)
  expect((await addressOf(book.id)).forms).toEqual([])
})

test('saveForm removes an older duplicate for the same direction', async () => {
  const book = await createBook('B')
  const { db } = await import('./connection')
  const stored = (await getBook(book.id))!
  const dup = (id: string, updatedAt: number) => ({ id, from: 'mira', to: 'lea', private: id, changes: [], createdAt: 1, updatedAt })
  await (await db()).put('books', { ...stored, address: { ranks: [], people: [], forms: [dup('old', 1), dup('new', 5)] } })
  await saveForm(book.id, { from: 'mira', to: 'lea', private: 'Lea', changes: [] }, order)
  const address = await addressOf(book.id)
  expect(address.forms.map((f) => [f.id, f.private])).toEqual([['new', 'Lea']])
  expect(address.deleted).toEqual(['old'])
  await deleteForm(book.id, 'mira', 'lea')
  expect((await addressOf(book.id)).forms).toEqual([])
})

test('setFigureFolder stores the choice', async () => {
  const book = await createBook('B')
  await setFigureFolder(book.id, '*')
  expect((await addressOf(book.id)).folder).toBe('*')
  await setFigureFolder(book.id, 'f1')
  expect((await addressOf(book.id)).folder).toBe('f1')
})

const figure = (id: string, name: string): WikiEntry => ({ id, bookId: 'b', folderId: null, name, aliases: [], properties: [], imageIds: [], body: '', autoLink: true, createdAt: 0, updatedAt: 0 })

test('importAddress replaces ranks, figures and exceptions in one go and announces the change', async () => {
  const book = await createBook('B')
  const old = await addRank(book.id, 'Herzogin')
  await saveForm(book.id, { from: 'mira', to: 'lea', public: 'Lea', changes: [] }, order)
  const oldForm = (await addressOf(book.id)).forms[0].id
  let announced = 0
  const listener = () => announced++
  window.addEventListener(CHANGED_EVENT, listener)
  try {
    const report = await importAddress(
      book.id,
      {
        ranks: [{ name: 'Knight', public: 'Sir {Vorname}' }],
        people: [{ name: 'Mira', rank: 'Knight' }],
        forms: [{ from: 'Mira', to: 'Lea', public: 'My Lady', changes: [{ label: 'Later', private: 'Lea' }] }],
      },
      [figure('mira', 'Mira Hale'), figure('lea', 'Lea')],
    )
    expect(report).toEqual({ ranks: 1, people: 1, forms: 1, missing: [] })
  } finally {
    window.removeEventListener(CHANGED_EVENT, listener)
  }
  expect(announced).toBe(1)
  const address = await addressOf(book.id)
  expect(address.ranks.map((rank) => rank.name)).toEqual(['Knight'])
  expect(address.people).toEqual([expect.objectContaining({ entryId: 'mira', rankId: address.ranks[0].id })])
  expect(address.forms).toEqual([expect.objectContaining({ from: 'mira', to: 'lea', public: 'My Lady' })])
  expect(address.forms[0].changes[0].chapterId).toBeUndefined()
  expect(address.deleted).toEqual(expect.arrayContaining([old.id, oldForm]))
})

test('importAddress on a missing book writes nothing', async () => {
  expect(await importAddress('nope', { ranks: [], people: [], forms: [] }, [])).toEqual({ ranks: 0, people: 0, forms: 0, missing: [] })
})
