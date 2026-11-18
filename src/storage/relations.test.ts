import { beforeEach, expect, test } from 'vitest'
import { createBook, getBook, resetDatabaseForTests } from './db'
import { addRelation, addRelationType, deleteRelation, deleteRelationType, relationsOf, updateRelation, updateRelationType } from './relations'

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('a relationship shows from both sides, each with its own name', async () => {
  const book = await createBook('B')
  const teacher = await addRelationType(book.id, ' Lehrer von ', ' Schüler von ')
  const friends = await addRelationType(book.id, 'befreundet mit', '')
  expect(friends.backward).toBeUndefined()
  await addRelation(book.id, { from: 'mira', to: 'lea', typeId: teacher.id, note: ' seit dem Brand ' })
  await addRelation(book.id, { from: 'lea', to: 'tom', typeId: friends.id })
  const stored = (await getBook(book.id))!
  expect(relationsOf(stored, 'mira')).toEqual([{ id: expect.any(String), label: 'Lehrer von', other: 'lea', note: 'seit dem Brand' }])
  expect(relationsOf(stored, 'lea').map((r) => [r.label, r.other])).toEqual([
    ['Schüler von', 'mira'],
    ['befreundet mit', 'tom'],
  ])
  expect(relationsOf(stored, 'tom').map((r) => [r.label, r.other])).toEqual([['befreundet mit', 'lea']])
})

test('types and relationships are changed and deleted; deleting a type removes its relationships', async () => {
  const book = await createBook('B')
  const type = await addRelationType(book.id, 'Mentor von', 'Schützling von')
  const relation = await addRelation(book.id, { from: 'a', to: 'b', typeId: type.id })
  await updateRelation(book.id, relation.id, { note: 'heimlich' })
  await updateRelationType(book.id, type.id, 'Lehrer von', 'Schüler von')
  let stored = (await getBook(book.id))!
  expect(relationsOf(stored, 'b')).toEqual([{ id: relation.id, label: 'Schüler von', other: 'a', note: 'heimlich' }])
  await deleteRelation(book.id, relation.id)
  expect(relationsOf((await getBook(book.id))!, 'a')).toEqual([])
  await addRelation(book.id, { from: 'a', to: 'c', typeId: type.id })
  await deleteRelationType(book.id, type.id)
  stored = (await getBook(book.id))!
  expect(stored.relations).toEqual({ types: [], relations: [], deleted: expect.arrayContaining([type.id, relation.id]) })
})

test('places in the relationship network are stored and cleared', async () => {
  const { placeInGraph, clearGraph } = await import('./relations')
  const book = await createBook('B')
  await placeInGraph(book.id, { mira: { x: 10.4, y: -20.6 } })
  await placeInGraph(book.id, { lea: { x: 1, y: 2 } })
  expect((await getBook(book.id))!.graph).toEqual({ mira: { x: 10, y: -21 }, lea: { x: 1, y: 2 } })
  await clearGraph(book.id)
  expect((await getBook(book.id))!.graph).toBeUndefined()
})
