import { describe, expect, test } from 'vitest'
import type { Sketch } from '../types'
import { mergeSketch, parseSketch, sketchFile } from './sketchFile'

const sketch: Sketch = {
  id: 's1',
  name: 'Landkarte',
  strokes: [
    { id: 'b', color: '#aaa', width: 2, points: [1.04, 2.06, 3, 4], createdAt: 20 },
    { id: 'a', color: '#bbb', width: 1, points: [5, 6], createdAt: 10 },
  ],
  stamps: [{ id: 'p', stamp: 'builtin:house', x: 10.04, y: 20, size: 2, color: '#ccc', entryId: 'mira', createdAt: 5, updatedAt: 7 }],
  createdAt: 1,
  updatedAt: 30,
}

describe('sketchFile', () => {
  test('round trip; strokes in drawing order; numbers rounded to one decimal; one stroke per line', () => {
    const text = sketchFile(sketch)
    expect(text.split('\n').filter((line) => line.includes('"points"'))).toHaveLength(2)
    const back = parseSketch(text, 's1')!
    expect(back.strokes.map((stroke) => stroke.id)).toEqual(['a', 'b'])
    expect(back.strokes[1].points).toEqual([1, 2.1, 3, 4])
    expect(back.stamps[0]).toEqual({ ...sketch.stamps[0], x: 10 })
    expect(back.name).toBe('Landkarte')
    expect(sketchFile(back)).toBe(text)
  })

  test('unknown fields are kept at every level', () => {
    const raw = JSON.parse(sketchFile(sketch))
    raw.future = 1
    raw.strokes[0].pressure = [1]
    raw.stamps[0].rotation = 90
    const back = parseSketch(JSON.stringify(raw), 's1')!
    const again = JSON.parse(sketchFile(back))
    expect(again.future).toBe(1)
    expect(again.strokes[0].pressure).toEqual([1])
    expect(again.stamps[0].rotation).toBe(90)
  })

  test('broken input gives null; broken items are skipped', () => {
    expect(parseSketch('nope', 's1')).toBeNull()
    expect(parseSketch('[]', 's1')).toBeNull()
    const back = parseSketch(JSON.stringify({ name: 'X', strokes: [{ id: 'a', points: 'x' }, { id: 'b', color: '#fff', width: 9, points: [1, 2] }], stamps: [{ id: 'c' }] }), 's1')!
    expect(back.strokes).toEqual([{ id: 'b', color: '#fff', width: 2, points: [1, 2], createdAt: 0 }])
    expect(back.stamps).toEqual([])
    expect(back.id).toBe('s1')
  })
})

describe('mergeSketch', () => {
  test('new strokes from both sides stay, erased stays erased, newer stamp and name win', () => {
    const local: Sketch = {
      ...sketch,
      name: 'Karte alt',
      updatedAt: 10,
      strokes: [...sketch.strokes, { id: 'mine', color: '#1', width: 1, points: [0, 0], createdAt: 40 }],
      stamps: [{ ...sketch.stamps[0], x: 50, updatedAt: 9 }],
      deleted: ['a'],
    }
    const remote: Sketch = {
      ...sketch,
      name: 'Karte neu',
      updatedAt: 50,
      strokes: [{ id: 'a', color: '#bbb', width: 1, points: [5, 6], createdAt: 10 }, { id: 'theirs', color: '#2', width: 3, points: [1, 1], createdAt: 41 }],
      stamps: [{ ...sketch.stamps[0], x: 70, updatedAt: 8 }],
      deleted: ['b'],
    }
    const merged = mergeSketch(local, remote)
    expect(merged.name).toBe('Karte neu')
    expect(merged.strokes.map((stroke) => stroke.id)).toEqual(['mine', 'theirs'])
    expect(merged.stamps.map((stamp) => stamp.x)).toEqual([50])
    expect([...(merged.deleted ?? [])].sort()).toEqual(['a', 'b'])
    expect(merged.updatedAt).toBe(50)
  })
})

describe('labels', () => {
  test('a stamp label travels after the entry; files without labels stay as they were', () => {
    const plain = sketchFile(sketch)
    expect(plain).not.toContain('label')
    const labelled: Sketch = { ...sketch, stamps: [{ ...sketch.stamps[0], entryId: 'e1', label: 'Hütte am Bach' }, { ...sketch.stamps[0], id: 't1', stamp: 'text', label: 'Mühlbach', createdAt: 99 }] }
    const text = sketchFile(labelled)
    // After the dates, where an older version keeps an unknown field: both write the same bytes, no back and forth.
    expect(text).toContain(`"entry":"e1","createdAt":${sketch.stamps[0].createdAt},"updatedAt":${sketch.stamps[0].updatedAt},"label":"Hütte am Bach"}`)
    const back = parseSketch(text, sketch.id)!
    expect(back.stamps.map((stamp) => [stamp.stamp, stamp.label])).toEqual([
      [sketch.stamps[0].stamp, 'Hütte am Bach'],
      ['text', 'Mühlbach'],
    ])
    expect(sketchFile(back)).toBe(text)
    expect(back.stamps[0].extra).toBeUndefined()
  })
})

test('a stamp label kept by an older version as an unknown field becomes the label again', async () => {
  const { normalizeStamp } = await import('./sketchFile')
  const old = { ...sketch.stamps[0], extra: { label: 'Mühlbach', later: 1 } }
  expect(normalizeStamp(old)).toEqual({ ...sketch.stamps[0], label: 'Mühlbach', extra: { later: 1 } })
  expect(normalizeStamp({ ...sketch.stamps[0], extra: { label: 'Mühlbach' } })).toEqual({ ...sketch.stamps[0], label: 'Mühlbach' })
  expect(normalizeStamp(sketch.stamps[0])).toBe(sketch.stamps[0])
})
