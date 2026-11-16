import { expect, test } from 'vitest'
import { fitWithin } from './image'

test('fitWithin scales the longest side down and never up', () => {
  expect(fitWithin(4000, 2000, 1600)).toEqual({ width: 1600, height: 800 })
  expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  expect(fitWithin(1000, 3200, 1600)).toEqual({ width: 500, height: 1600 })
  expect(fitWithin(1601, 1, 1600)).toEqual({ width: 1600, height: 1 })
})
