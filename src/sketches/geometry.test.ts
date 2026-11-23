import { expect, test } from 'vitest'
import type { SketchStamp } from '../types'
import { stampAt, stampBox, TEXT_SIZES, TEXT_STAMP } from './geometry'

const text = (label: string): SketchStamp => ({ id: 't', stamp: TEXT_STAMP, x: 0, y: 0, size: 2, color: '#fff', label, createdAt: 1, updatedAt: 1 })

test('a free text is as wide as its words: the right end of a long text is hit, the space beside a short one is not', () => {
  const long = text('Der lange Weg zum Hafen')
  const box = stampBox(long)
  expect(box.right - box.left).toBeGreaterThan(150)
  expect(box.bottom - box.top).toBeCloseTo(TEXT_SIZES[2] * 1.3)
  expect(stampAt([long], 100, 0)?.id).toBe('t')
  expect(stampAt([text('Ort')], 100, 0)).toBeUndefined()
})
