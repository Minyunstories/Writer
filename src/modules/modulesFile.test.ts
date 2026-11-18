import { expect, test } from 'vitest'
import { modulesFile, parseModules } from './modulesFile'

test('only switched-on modules are written, sorted', () => {
  expect(modulesFile({ vocabulary: true, address: false })).toBe('{\n  "vocabulary": true\n}\n')
  expect(modulesFile({ vocabulary: true, address: true })).toBe('{\n  "address": true,\n  "vocabulary": true\n}\n')
  expect(modulesFile({})).toBeUndefined()
  expect(modulesFile({ vocabulary: false })).toBeUndefined()
})

test('unknown modules from a newer app survive', () => {
  const parsed = parseModules('{"vocabulary":true,"address":true}')
  expect(parsed).toEqual({ address: true, vocabulary: true })
  expect(Object.keys(JSON.parse(modulesFile(parsed!)!))).toEqual(['address', 'vocabulary'])
})

test('broken files are tolerated', () => {
  expect(parseModules('nope')).toBeNull()
  expect(parseModules('[]')).toBeNull()
  expect(parseModules(undefined)).toBeNull()
  expect(parseModules('{"vocabulary":"yes","address":true}')).toEqual({ address: true })
})
