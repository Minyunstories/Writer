import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useCallback, useEffect, useState } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createBook, getBook, resetDatabaseForTests } from '../storage/db'
import { createSketch } from '../storage/sketches'
import { createEntry } from '../storage/wiki'
import type { Sketch, WikiEntry } from '../types'
import { SketchCanvas } from './SketchCanvas'

beforeEach(async () => {
  await resetDatabaseForTests()
  // jsdom has no layout: the canvas is 800 × 600 at the top left, so an empty sketch has (0, 0) at (400, 300).
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const stored = async (bookId: string, id: string) => (await getBook(bookId))!.sketches!.find((sketch) => sketch.id === id)!

function Harness({ bookId, sketchId, editable = true, entries = [], onOpenEntry = () => {} }: { bookId: string; sketchId: string; editable?: boolean; entries?: WikiEntry[]; onOpenEntry?: (id: string) => void }) {
  const [sketch, setSketch] = useState<Sketch | null>(null)
  const load = useCallback(async () => setSketch(await stored(bookId, sketchId)), [bookId, sketchId])
  useEffect(() => {
    void load()
  }, [load])
  return sketch ? <SketchCanvas bookId={bookId} sketch={sketch} entries={entries} stamps={[]} editable={editable} onOpenEntry={onOpenEntry} onChanged={() => void load()} /> : null
}

async function setup(props: Partial<Parameters<typeof Harness>[0]> = {}) {
  const book = await createBook('B')
  const sketch = await createSketch(book.id, 'Karte')
  render(<Harness bookId={book.id} sketchId={sketch.id} {...props} />)
  const canvas = await screen.findByRole('group', { name: 'Skizze Karte' })
  return { book, sketch, canvas }
}

type Point = [number, number]
const drag = (target: Element, points: Point[], pointerType = 'pen', pointerId = 1) => {
  const [first, ...rest] = points
  fireEvent.pointerDown(target, { pointerId, pointerType, button: 0, clientX: first[0], clientY: first[1] })
  for (const [x, y] of rest) fireEvent.pointerMove(target, { pointerId, pointerType, clientX: x, clientY: y })
  const [x, y] = points[points.length - 1]
  fireEvent.pointerUp(target, { pointerId, pointerType, clientX: x, clientY: y })
}

test('the pen draws a stroke in world coordinates and saves it', async () => {
  const { book, sketch, canvas } = await setup()
  drag(canvas, [
    [400, 300],
    [420, 310],
    [440, 320],
  ])
  await waitFor(async () => expect((await stored(book.id, sketch.id)).strokes).toHaveLength(1))
  const stroke = (await stored(book.id, sketch.id)).strokes[0]
  expect(stroke.points.slice(0, 2)).toEqual([0, 0])
  expect(stroke.points.slice(-2)).toEqual([40, 20])
  expect(stroke.width).toBe(2)
  await waitFor(() => expect(document.querySelectorAll('.sketch-strokes .sketch-stroke')).toHaveLength(1))
})

test('a finger does not draw, it moves the sketch', async () => {
  const { book, sketch, canvas } = await setup()
  const layer = canvas.querySelector('.sketch-world')!
  const before = layer.getAttribute('transform')
  drag(
    canvas,
    [
      [400, 300],
      [450, 330],
    ],
    'touch',
  )
  expect(layer.getAttribute('transform')).not.toBe(before)
  await new Promise((done) => setTimeout(done, 30))
  expect((await stored(book.id, sketch.id)).strokes).toEqual([])
})

test('the eraser removes the whole stroke it touches; undo brings it back with a new id', async () => {
  const { book, sketch, canvas } = await setup()
  drag(canvas, [
    [400, 300],
    [500, 300],
  ])
  await waitFor(async () => expect((await stored(book.id, sketch.id)).strokes).toHaveLength(1))
  const id = (await stored(book.id, sketch.id)).strokes[0].id
  fireEvent.click(screen.getByRole('button', { name: 'Radierer' }))
  drag(canvas, [[450, 302]], 'mouse')
  await waitFor(async () => expect((await stored(book.id, sketch.id)).strokes).toEqual([]))
  expect((await stored(book.id, sketch.id)).deleted).toContain(id)

  fireEvent.click(screen.getByRole('button', { name: 'Rückgängig' }))
  await waitFor(async () => expect((await stored(book.id, sketch.id)).strokes).toHaveLength(1))
  const back = (await stored(book.id, sketch.id)).strokes[0]
  expect(back.id).not.toBe(id)
  expect(back.points).toEqual([0, 0, 100, 0])
})

test('a stamp is placed, linked to a wiki entry, and opens it with the hand', async () => {
  const book = await createBook('B')
  const mira = await createEntry(book.id, 'Mira')
  const sketch = await createSketch(book.id, 'Karte')
  const open = vi.fn()
  render(<Harness bookId={book.id} sketchId={sketch.id} entries={[mira]} onOpenEntry={open} />)
  const canvas = await screen.findByRole('group', { name: 'Skizze Karte' })

  fireEvent.click(screen.getByRole('button', { name: 'Stempel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Haus' }))
  drag(canvas, [[400, 300]], 'mouse')
  await waitFor(async () => expect((await stored(book.id, sketch.id)).stamps).toHaveLength(1))
  expect((await stored(book.id, sketch.id)).stamps[0]).toMatchObject({ stamp: 'builtin:house', x: 0, y: 0, size: 2 })

  fireEvent.click(screen.getByRole('button', { name: 'Auswählen' }))
  drag(canvas, [[402, 298]], 'mouse')
  fireEvent.change(await screen.findByRole('combobox', { name: 'Mit Wiki-Eintrag verknüpfen' }), { target: { value: mira.id } })
  await waitFor(async () => expect((await stored(book.id, sketch.id)).stamps[0].entryId).toBe(mira.id))
  await waitFor(() => expect(canvas.querySelector('.sketch-stamp-label')?.textContent).toBe('Mira'))

  fireEvent.click(screen.getByRole('button', { name: 'Hand' }))
  drag(canvas, [[401, 301]], 'mouse')
  expect(open).toHaveBeenCalledWith(mira.id)
})

test('not editable (phone): no toolbar, but moving and tapping linked stamps work', async () => {
  const book = await createBook('B')
  const mira = await createEntry(book.id, 'Mira')
  const sketch = await createSketch(book.id, 'Karte')
  const { addStamp } = await import('../storage/sketches')
  await addStamp(book.id, sketch.id, { stamp: 'builtin:tree', x: 0, y: 0, size: 2, color: '#fff', entryId: mira.id })
  const open = vi.fn()
  render(<Harness bookId={book.id} sketchId={sketch.id} editable={false} entries={[mira]} onOpenEntry={open} />)
  const canvas = await screen.findByRole('group', { name: 'Skizze Karte' })
  expect(screen.queryByRole('toolbar')).toBeNull()
  // A single stamp is fitted into the middle of the canvas.
  await act(async () => {
    drag(canvas, [[400, 300]], 'touch')
  })
  expect(open).toHaveBeenCalledWith(mira.id)
})

test('Entf removes the selected stamp only while it is shown as selected', async () => {
  const { book, sketch, canvas } = await setup()
  fireEvent.click(screen.getByRole('button', { name: 'Stempel' }))
  drag(canvas, [[400, 300]], 'mouse')
  await waitFor(async () => expect((await stored(book.id, sketch.id)).stamps).toHaveLength(1))
  fireEvent.click(screen.getByRole('button', { name: 'Auswählen' }))
  drag(canvas, [[400, 300]], 'mouse')
  await screen.findByRole('combobox', { name: 'Mit Wiki-Eintrag verknüpfen' })
  fireEvent.click(screen.getByRole('button', { name: 'Stift' }))
  fireEvent.keyDown(canvas, { key: 'Delete' })
  await new Promise((done) => setTimeout(done, 30))
  expect((await stored(book.id, sketch.id)).stamps).toHaveLength(1)
  // Back to Auswählen: nothing is selected any more, so Entf still removes nothing.
  fireEvent.click(screen.getByRole('button', { name: 'Auswählen' }))
  fireEvent.keyDown(canvas, { key: 'Delete' })
  await new Promise((done) => setTimeout(done, 30))
  expect((await stored(book.id, sketch.id)).stamps).toHaveLength(1)
  drag(canvas, [[400, 300]], 'mouse')
  fireEvent.keyDown(canvas, { key: 'Delete' })
  await waitFor(async () => expect((await stored(book.id, sketch.id)).stamps).toEqual([]))
})
