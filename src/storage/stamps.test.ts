import { beforeEach, expect, test } from 'vitest'
import { resetDatabaseForTests } from './db'
import { addCustomStamp, deleteCustomStamp, listStamps, renameCustomStamp } from './stamps'

beforeEach(async () => {
  await resetDatabaseForTests()
})

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L5 5" onclick="x()"/></svg>'

test('own stamps: added cleaned, renamed, deleted (as tombstone); an unusable file is refused', async () => {
  const tower = await addCustomStamp('Turm', svg)
  expect(tower).not.toBeNull()
  expect(tower!.svg).not.toContain('onclick')
  expect(await addCustomStamp('Leer', '<svg xmlns="http://www.w3.org/2000/svg"/>')).toBeNull()
  await renameCustomStamp(tower!.id, 'Wachturm')
  expect((await listStamps()).map((stamp) => stamp.name)).toEqual(['Wachturm'])
  await deleteCustomStamp(tower!.id)
  expect(await listStamps()).toEqual([])
})
