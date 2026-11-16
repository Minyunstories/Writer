import { act, renderHook, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { useAutosave } from './useAutosave'

type Doc = { a: string; b: string }
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('quick changes are merged into one save', async () => {
  const save = vi.fn(async (_patch: Partial<Doc>) => {})
  const { result } = renderHook(() => useAutosave<Doc>(save, { delay: 20 }))
  act(() => {
    result.current.change({ a: '1' })
    result.current.change({ b: '2' })
    result.current.change({ a: '3' })
  })
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  expect(save).toHaveBeenCalledWith({ a: '3', b: '2' })
})

test('saves never overlap', async () => {
  let active = 0
  let maxActive = 0
  const seen: Partial<Doc>[] = []
  const save = async (patch: Partial<Doc>) => {
    active++
    maxActive = Math.max(maxActive, active)
    await wait(40)
    seen.push(patch)
    active--
  }
  const { result } = renderHook(() => useAutosave<Doc>(save, { delay: 5 }))
  act(() => result.current.change({ a: '1' }))
  await wait(20)
  act(() => result.current.change({ a: '2' }))
  await waitFor(() => expect(seen).toEqual([{ a: '1' }, { a: '2' }]))
  expect(maxActive).toBe(1)
})

test('a failing save is flagged, retried and then cleared', async () => {
  let calls = 0
  const save = vi.fn(async () => {
    if (++calls === 1) throw new Error('quota')
  })
  const { result } = renderHook(() => useAutosave<Doc>(save, { delay: 5, retryDelay: 200 }))
  act(() => result.current.change({ a: '1' }))
  await waitFor(() => expect(result.current.failed).toBe(true))
  await waitFor(() => expect(result.current.failed).toBe(false))
  expect(save).toHaveBeenLastCalledWith({ a: '1' })
})

test('a slow failing save never beats a newer change', async () => {
  let calls = 0
  let stored: Partial<Doc> = {}
  const save = async (patch: Partial<Doc>) => {
    if (++calls === 1) {
      await wait(40)
      throw new Error('slow failure')
    }
    stored = { ...stored, ...patch }
  }
  const { result } = renderHook(() => useAutosave<Doc>(save, { delay: 5, retryDelay: 20 }))
  act(() => result.current.change({ a: 'alt' }))
  await wait(20)
  act(() => result.current.change({ a: 'neu' }))
  await waitFor(() => expect(stored).toEqual({ a: 'neu' }))
  await wait(80)
  expect(stored).toEqual({ a: 'neu' })
})

test('unmounting saves what is pending; a failure after that is reported', async () => {
  const save = vi.fn(async (_patch: Partial<Doc>) => {})
  const first = renderHook(() => useAutosave<Doc>(save, { delay: 500 }))
  act(() => first.result.current.change({ a: '1' }))
  first.unmount()
  await waitFor(() => expect(save).toHaveBeenCalledWith({ a: '1' }))

  const onFailedAfterClose = vi.fn()
  const failing = vi.fn(async () => {
    throw new Error('quota')
  })
  const second = renderHook(() => useAutosave<Doc>(failing, { delay: 500, retryDelay: 10_000, onFailedAfterClose }))
  act(() => second.result.current.change({ a: '1' }))
  second.unmount()
  await waitFor(() => expect(onFailedAfterClose).toHaveBeenCalled())
})

test('pagehide saves at once', async () => {
  const save = vi.fn(async (_patch: Partial<Doc>) => {})
  const { result } = renderHook(() => useAutosave<Doc>(save, { delay: 5000 }))
  act(() => result.current.change({ a: '1' }))
  window.dispatchEvent(new Event('pagehide'))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ a: '1' }))
})
