import { beforeEach, expect, test } from 'vitest'
import { activeModules, isModuleOn } from '../modules/modules'
import { createBook, getBook, resetDatabaseForTests } from './db'
import { setModule } from './modules'

beforeEach(async () => {
  await resetDatabaseForTests()
})

test('switching on and off', async () => {
  const book = await createBook('B')
  expect(isModuleOn(book, 'vocabulary')).toBe(false)
  expect(activeModules(book)).toEqual([])

  await setModule(book.id, 'vocabulary', true)
  let stored = (await getBook(book.id))!
  expect(stored.modules).toEqual({ vocabulary: true })
  expect(isModuleOn(stored, 'vocabulary')).toBe(true)
  expect(activeModules(stored)).toEqual(['vocabulary'])

  await setModule(book.id, 'vocabulary', false)
  stored = (await getBook(book.id))!
  expect(stored.modules).toBeUndefined()
  expect(isModuleOn(stored, 'vocabulary')).toBe(false)
})

test('modules the app does not know stay switched on', async () => {
  const book = await createBook('B')
  expect(activeModules({ modules: { tarot: true, vocabulary: true } })).toEqual(['vocabulary'])
  await setModule(book.id, 'vocabulary', true)
  expect((await getBook(book.id))!.modules).toEqual({ vocabulary: true })
})

test('activeModules lists both modules in tab order', async () => {
  expect(activeModules({ modules: { address: true, vocabulary: true } })).toEqual(['vocabulary', 'address'])
  expect(activeModules({ modules: { address: true } })).toEqual(['address'])
})
