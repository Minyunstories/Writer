import { expect, test } from 'vitest'
import type { StampLibrary } from '../types'
import { mergeStamps, parseStamps, stampsFile } from './stampsFile'

// In cleaned form, as stamps are kept.
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" fill="currentColor"><path d="M0 0L5 5"/></svg>'
const library: StampLibrary = { stamps: [{ id: 'b', name: 'Turm', svg, updatedAt: 2 }, { id: 'a', name: 'Brunnen', svg, updatedAt: 1 }] }

test('round trip sorted by name; empty gives no file; unknown fields kept', () => {
  const text = stampsFile(library)!
  const back = parseStamps(text)!
  expect(back.stamps.map((stamp) => stamp.name)).toEqual(['Brunnen', 'Turm'])
  expect(stampsFile(back)).toBe(text)
  expect(stampsFile({ stamps: [] })).toBeNull()
  const raw = JSON.parse(text)
  raw.later = true
  raw.stamps[0].tags = ['x']
  const again = JSON.parse(stampsFile(parseStamps(JSON.stringify(raw))!)!)
  expect(again.later).toBe(true)
  expect(again.stamps[0].tags).toEqual(['x'])
})

test('stamps are cleaned again when read; unusable ones are dropped', () => {
  const back = parseStamps(JSON.stringify({ stamps: [{ id: 'x', name: 'Böse', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0" onclick="alert(1)"/></svg>', updatedAt: 1 }, { id: 'y', name: 'Leer', svg: '<svg/>', updatedAt: 1 }] }))!
  expect(back.stamps.map((stamp) => stamp.id)).toEqual(['x'])
  expect(back.stamps[0].svg).not.toContain('onclick')
  expect(parseStamps('nope')).toBeNull()
})

test('merge: both sides, deleted wins, newer wins', () => {
  const merged = mergeStamps(
    { stamps: [{ id: 'a', name: 'Brunnen alt', svg, updatedAt: 1 }, { id: 'c', name: 'Neu hier', svg, updatedAt: 5 }], deleted: ['b'] },
    { stamps: [{ id: 'a', name: 'Brunnen', svg, updatedAt: 3 }, { id: 'b', name: 'Turm', svg, updatedAt: 9 }] },
  )
  expect(merged.stamps.map((stamp) => stamp.name)).toEqual(['Brunnen', 'Neu hier'])
  expect(merged.deleted).toEqual(['b'])
})
