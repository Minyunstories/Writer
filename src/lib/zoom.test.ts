import { beforeEach, expect, test } from 'vitest'
import { getZoom, setZoom } from './zoom'

beforeEach(() => {
  localStorage.clear()
})

test('defaults to 100', () => {
  expect(getZoom('editor')).toBe(100)
})

test('clamps and rounds to steps of 10', () => {
  expect(setZoom('editor', 37)).toBe(50)
  expect(setZoom('editor', 999)).toBe(200)
  expect(setZoom('editor', 114)).toBe(110)
  expect(getZoom('editor')).toBe(110)
})

test('areas are independent', () => {
  setZoom('editor', 150)
  expect(getZoom('wiki')).toBe(100)
})

test('ignores garbage in storage', () => {
  localStorage.setItem('mw.zoom.editor', 'abc')
  expect(getZoom('editor')).toBe(100)
})
