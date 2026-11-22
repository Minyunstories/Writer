import { beforeEach, expect, test } from 'vitest'
import { resetDatabaseForTests } from './db'
import { getFavorites, setFavorite, toggleFavorite } from './favorites'
import { favoriteKeys, favoriteKey } from '../collection/favoritesFile'
import { addToCollection, getCollection } from './collection'

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('toggling marks and unmarks a word; the collection is untouched', async () => {
  await addToCollection({ text: 'swift', category: 'Speed', group: 'fast' })
  const before = await getCollection()
  await toggleFavorite('Speed', 'swift')
  expect([...favoriteKeys(await getFavorites())]).toEqual([favoriteKey('Speed', 'swift')])
  await toggleFavorite('Speed', 'Swift')
  const after = await getFavorites()
  expect(favoriteKeys(after).size).toBe(0)
  // The removal stays as a mark, so the sync knows it is newer.
  expect(after.marks).toHaveLength(1)
  expect(after.marks[0].on).toBe(false)
  expect(await getCollection()).toEqual(before)
})

test('setting a word to the state it already has writes nothing', async () => {
  await setFavorite('Speed', 'swift', true)
  const marked = await getFavorites()
  await setFavorite('Speed', 'Swift', true)
  expect(await getFavorites()).toEqual(marked)
  await setFavorite('Speed', 'rapid', false)
  expect((await getFavorites()).marks).toHaveLength(1)
  await setFavorite('Speed', 'swift', false)
  expect(favoriteKeys(await getFavorites()).size).toBe(0)
})
