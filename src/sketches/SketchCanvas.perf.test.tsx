import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useCallback, useEffect, useState } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createBook, getBook, resetDatabaseForTests } from '../storage/db'
import { addStroke, createSketch } from '../storage/sketches'
import type { Sketch } from '../types'
import * as geometry from './geometry'
import { SketchCanvas } from './SketchCanvas'

vi.mock('./geometry', async (original) => {
  const real = await original<typeof import('./geometry')>()
  return { ...real, strokePath: vi.fn(real.strokePath) }
})

beforeEach(async () => {
  await resetDatabaseForTests()
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function Harness({ bookId, sketchId }: { bookId: string; sketchId: string }) {
  const [sketch, setSketch] = useState<Sketch | null>(null)
  const load = useCallback(async () => setSketch((await getBook(bookId))!.sketches!.find((item) => item.id === sketchId)!), [bookId, sketchId])
  useEffect(() => {
    void load()
  }, [load])
  return sketch ? <SketchCanvas bookId={bookId} sketch={sketch} entries={[]} stamps={[]} editable onOpenEntry={() => {}} onChanged={() => void load()} /> : null
}

test('a new stroke or an eraser hit does not redraw the strokes already there', async () => {
  const book = await createBook('B')
  const sketch = await createSketch(book.id, 'Karte')
  for (let i = 0; i < 60; i++) await addStroke(book.id, sketch.id, { color: '#fff', width: 2, points: [i * 10, 0, i * 10, 50] })
  render(<Harness bookId={book.id} sketchId={sketch.id} />)
  const canvas = await screen.findByRole('group', { name: 'Skizze Karte' })
  await waitFor(() => expect(document.querySelectorAll('.sketch-strokes .sketch-stroke')).toHaveLength(60))
  const calls = vi.mocked(geometry.strokePath)
  calls.mockClear()

  fireEvent.pointerDown(canvas, { pointerId: 1, pointerType: 'pen', button: 0, clientX: 100, clientY: 500 })
  fireEvent.pointerMove(canvas, { pointerId: 1, pointerType: 'pen', clientX: 200, clientY: 520 })
  fireEvent.pointerUp(canvas, { pointerId: 1, pointerType: 'pen', clientX: 200, clientY: 520 })
  await waitFor(async () => expect((await getBook(book.id))!.sketches![0].strokes).toHaveLength(61))
  await new Promise((done) => setTimeout(done, 50))
  // The live line, the new stroke, a few more – but not the 60 that were there before (three times over).
  expect(calls.mock.calls.length).toBeLessThan(15)

  calls.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Radierer' }))
  // The first stroke (x = 0) is at screen x 0 * scale + offset; hit it at its middle.
  const first = document.querySelector('.sketch-strokes .sketch-stroke')!
  expect(first).toBeTruthy()
  const world = canvas.querySelector('.sketch-world')!.getAttribute('transform')!
  const [, tx, ty, scale] = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/.exec(world)!.map(Number)
  fireEvent.pointerDown(canvas, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: tx, clientY: ty + 25 * scale })
  await waitFor(() => expect(document.querySelector('.sketch-strokes .sketch-stroke')!.getAttribute('visibility')).toBe('hidden'))
  expect(calls.mock.calls.length).toBeLessThan(5)
  fireEvent.pointerUp(canvas, { pointerId: 2, pointerType: 'mouse', clientX: tx, clientY: ty + 25 * scale })
})
