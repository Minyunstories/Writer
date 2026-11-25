import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, test } from 'vitest'
import { useDrawerHeight } from './drawerState'

const tall = window.innerHeight

afterEach(() => {
  localStorage.clear()
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: tall })
})

const setWindowHeight = (height: number) => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
  window.dispatchEvent(new Event('resize'))
}

test('the drawer never takes more than about 60 % of the window, and follows a resize', () => {
  setWindowHeight(1200)
  const { result } = renderHook(() => useDrawerHeight())
  act(() => result.current[1](600))
  expect(result.current[0]).toBe(600)
  // A small window: the drawer leaves room for the text.
  act(() => setWindowHeight(500))
  expect(result.current[0]).toBe(300)
  // Back to a large window: the chosen height comes back.
  act(() => setWindowHeight(1200))
  expect(result.current[0]).toBe(600)
  // Never below the minimum, even in a tiny window.
  act(() => setWindowHeight(150))
  expect(result.current[0]).toBe(140)
})

test('pulling up at the window limit keeps the larger height for a larger window; pulling down sets it', () => {
  setWindowHeight(1200)
  const { result } = renderHook(() => useDrawerHeight())
  act(() => result.current[1](600))
  act(() => setWindowHeight(500))
  // ArrowUp on the grip at the limit.
  act(() => result.current[1](result.current[0] + 16))
  expect(result.current[0]).toBe(300)
  act(() => setWindowHeight(1200))
  expect(result.current[0]).toBe(600)
  act(() => setWindowHeight(500))
  act(() => result.current[1](250))
  act(() => setWindowHeight(1200))
  expect(result.current[0]).toBe(250)
})
