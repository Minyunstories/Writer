import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { IDLE_AFTER_MS, useWakeLock } from './wakeLock'

interface FakeSentinel {
  released: boolean
  release: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
}

let sentinels: FakeSentinel[]
let request: ReturnType<typeof vi.fn>

function makeSentinel(): FakeSentinel {
  const sentinel: FakeSentinel = {
    released: false,
    release: vi.fn(async () => {
      sentinel.released = true
    }),
    addEventListener: vi.fn(),
  }
  sentinels.push(sentinel)
  return sentinel
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

/** Lets the promise of a lock request settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  sentinels = []
  request = vi.fn(async () => makeSentinel())
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
  setVisibility('visible')
})

afterEach(() => {
  vi.useRealTimers()
  delete (navigator as { wakeLock?: unknown }).wakeLock
  delete (document as { visibilityState?: unknown }).visibilityState
})

test('requests the screen lock while active', async () => {
  renderHook(() => useWakeLock(true))
  await settle()
  expect(request).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledWith('screen')
})

test('does nothing while inactive', async () => {
  renderHook(() => useWakeLock(false))
  await settle()
  expect(request).not.toHaveBeenCalled()
})

test('does nothing without the API', async () => {
  delete (navigator as { wakeLock?: unknown }).wakeLock
  const { unmount } = renderHook(() => useWakeLock(true))
  await settle()
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
  })
  unmount()
})

test('releases after ten idle minutes and asks again on the next key', async () => {
  renderHook(() => useWakeLock(true))
  await settle()
  await act(async () => {
    vi.advanceTimersByTime(IDLE_AFTER_MS)
  })
  expect(sentinels[0].release).toHaveBeenCalledTimes(1)
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
  })
  await settle()
  expect(request).toHaveBeenCalledTimes(2)
})

test('activity keeps the lock', async () => {
  renderHook(() => useWakeLock(true))
  await settle()
  await act(async () => {
    vi.advanceTimersByTime(9 * 60 * 1000)
  })
  act(() => {
    document.dispatchEvent(new Event('pointerdown'))
  })
  await act(async () => {
    vi.advanceTimersByTime(9 * 60 * 1000)
  })
  expect(sentinels[0].release).not.toHaveBeenCalled()
})

test('scrolling inside an element counts as activity', async () => {
  renderHook(() => useWakeLock(true))
  await settle()
  const scroller = document.createElement('div')
  document.body.append(scroller)
  await act(async () => {
    vi.advanceTimersByTime(9 * 60 * 1000)
  })
  act(() => {
    scroller.dispatchEvent(new Event('scroll'))
  })
  await act(async () => {
    vi.advanceTimersByTime(9 * 60 * 1000)
  })
  expect(sentinels[0].release).not.toHaveBeenCalled()
  scroller.remove()
})

test('many keys do not ask again while held', async () => {
  renderHook(() => useWakeLock(true))
  await settle()
  act(() => {
    for (let i = 0; i < 5; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
  })
  await settle()
  expect(request).toHaveBeenCalledTimes(1)
})

test('asks again when the app comes back to the front', async () => {
  renderHook(() => useWakeLock(true))
  await settle()
  // The browser drops the lock by itself when the app is hidden.
  sentinels[0].released = true
  setVisibility('hidden')
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await settle()
  expect(request).toHaveBeenCalledTimes(1)
  setVisibility('visible')
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await settle()
  expect(request).toHaveBeenCalledTimes(2)
})

test('releases when no longer active', async () => {
  const { rerender } = renderHook(({ active }) => useWakeLock(active), { initialProps: { active: true } })
  await settle()
  rerender({ active: false })
  await settle()
  expect(sentinels[0].release).toHaveBeenCalledTimes(1)
})

test('releases on unmount', async () => {
  const { unmount } = renderHook(() => useWakeLock(true))
  await settle()
  unmount()
  await settle()
  expect(sentinels[0].release).toHaveBeenCalledTimes(1)
})

test('a lock that arrives after deactivating is released at once', async () => {
  let resolve: (sentinel: FakeSentinel) => void = () => {}
  request.mockImplementationOnce(() => new Promise<FakeSentinel>((done) => (resolve = done)))
  const { rerender } = renderHook(({ active }) => useWakeLock(active), { initialProps: { active: true } })
  rerender({ active: false })
  const late = makeSentinel()
  resolve(late)
  await settle()
  expect(late.release).toHaveBeenCalledTimes(1)
})

test('a refused lock does no harm and is tried again on the next key', async () => {
  request.mockImplementationOnce(async () => {
    throw new DOMException('Battery saver', 'NotAllowedError')
  })
  renderHook(() => useWakeLock(true))
  await settle()
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
  })
  await settle()
  expect(request).toHaveBeenCalledTimes(2)
})
