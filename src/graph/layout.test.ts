import { expect, test } from 'vitest'
import { layoutGraph } from './layout'

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

test('connected entries end up closer than unconnected ones; the result is the same every time', () => {
  const nodes = ['a', 'b', 'c', 'd']
  const edges = [
    ['a', 'b'],
    ['c', 'd'],
  ] as [string, string][]
  const first = layoutGraph(nodes, edges, {})
  expect(layoutGraph(nodes, edges, {})).toEqual(first)
  expect(dist(first.a, first.b)).toBeLessThan(dist(first.a, first.c))
  expect(dist(first.c, first.d)).toBeLessThan(dist(first.b, first.d))
  for (const id of nodes) expect(dist(first[id], { x: 0, y: 0 })).toBeLessThan(700)
})

test('entries the writer placed stay where they are; the others arrange around them', () => {
  const placed = { a: { x: 300, y: -200 } }
  const result = layoutGraph(['a', 'b', 'c'], [['a', 'b']], placed)
  expect(result.a).toEqual({ x: 300, y: -200 })
  expect(dist(result.a, result.b)).toBeLessThan(dist(result.a, result.c) + 1)
  expect(Number.isFinite(result.c.x)).toBe(true)
})
