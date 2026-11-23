import { beforeEach, expect, test } from 'vitest'
import { CHANGED_EVENT } from './connection'
import { createBook, getBook, resetDatabaseForTests } from './db'
import { addStamp, addStroke, createSketch, deleteSketch, removeItems, renameSketch, restoreItems, updateStamp } from './sketches'

beforeEach(async () => {
  await resetDatabaseForTests()
})

const sketchOf = async (bookId: string, id: string) => (await getBook(bookId))!.sketches!.find((sketch) => sketch.id === id)!

test('create, rename and delete sketches; a rename to the same name writes nothing', async () => {
  const book = await createBook('B')
  const map = await createSketch(book.id, '  Landkarte ')
  expect(map.name).toBe('Landkarte')
  await createSketch(book.id, '')
  expect((await getBook(book.id))!.sketches!.map((sketch) => sketch.name)).toEqual(['Landkarte', 'Skizze 2'])
  const before = (await sketchOf(book.id, map.id)).updatedAt
  let heard = 0
  const listen = () => heard++
  window.addEventListener(CHANGED_EVENT, listen)
  await renameSketch(book.id, map.id, 'Landkarte')
  expect(heard).toBe(0)
  await renameSketch(book.id, map.id, 'Karte')
  window.removeEventListener(CHANGED_EVENT, listen)
  expect(heard).toBe(1)
  expect((await sketchOf(book.id, map.id)).updatedAt).toBeGreaterThanOrEqual(before)
  await deleteSketch(book.id, map.id)
  expect((await getBook(book.id))!.sketches!.map((sketch) => sketch.name)).toEqual(['Skizze 2'])
})

test('strokes and stamps: added with ids, stamps updated, removed ones become tombstones', async () => {
  const book = await createBook('B')
  const sketch = await createSketch(book.id, 'Karte')
  const stroke = await addStroke(book.id, sketch.id, { color: '#fff', width: 2, points: [0, 0, 10, 10] })
  const stamp = await addStamp(book.id, sketch.id, { stamp: 'builtin:house', x: 5, y: 5, size: 2, color: '#fff' })
  await updateStamp(book.id, sketch.id, stamp.id, { x: 8, entryId: 'mira' })
  let stored = await sketchOf(book.id, sketch.id)
  expect(stored.strokes.map((item) => item.id)).toEqual([stroke.id])
  expect(stored.stamps[0]).toMatchObject({ x: 8, entryId: 'mira' })
  expect(stored.stamps[0].updatedAt).toBeGreaterThan(stamp.updatedAt - 1)
  await updateStamp(book.id, sketch.id, stamp.id, { entryId: null })
  expect((await sketchOf(book.id, sketch.id)).stamps[0].entryId).toBeUndefined()
  await removeItems(book.id, sketch.id, [stroke.id, stamp.id])
  stored = await sketchOf(book.id, sketch.id)
  expect(stored.strokes).toEqual([])
  expect(stored.stamps).toEqual([])
  expect([...(stored.deleted ?? [])].sort()).toEqual([stroke.id, stamp.id].sort())
})

test('restoring (undo of erasing) adds copies with new ids, never the removed ids', async () => {
  const book = await createBook('B')
  const sketch = await createSketch(book.id, 'Karte')
  const stroke = await addStroke(book.id, sketch.id, { color: '#fff', width: 1, points: [1, 1] })
  await removeItems(book.id, sketch.id, [stroke.id])
  const restored = await restoreItems(book.id, sketch.id, [stroke], [])
  expect(restored.strokes[0].id).not.toBe(stroke.id)
  const stored = await sketchOf(book.id, sketch.id)
  expect(stored.strokes.map((item) => item.points)).toEqual([[1, 1]])
  expect(stored.deleted).toContain(stroke.id)
})

test('changes to a missing sketch write nothing', async () => {
  const book = await createBook('B')
  let heard = 0
  const listen = () => heard++
  window.addEventListener(CHANGED_EVENT, listen)
  await removeItems(book.id, 'nope', ['x'])
  await updateStamp(book.id, 'nope', 'x', { x: 1 })
  window.removeEventListener(CHANGED_EVENT, listen)
  expect(heard).toBe(0)
})
