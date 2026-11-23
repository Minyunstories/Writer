import type { Book, Sketch, SketchStamp, SketchStroke } from '../types'
import { normalizeSketch } from '../sketches/sketchFile'
import { announceChange, db, newId } from './connection'

/** Changes the sketches of one book in a single transaction; an update returning null leaves them as they are. */
async function change(bookId: string, update: (sketches: Sketch[]) => Sketch[] | null): Promise<boolean> {
  const tx = (await db()).transaction('books', 'readwrite')
  const book = await tx.store.get(bookId)
  const next = book ? update(book.sketches ?? []) : null
  if (book && next) {
    const updated: Book = { ...book, sketches: next }
    if (!next.length) delete updated.sketches
    await tx.store.put(updated)
  }
  await tx.done
  if (book && next) announceChange()
  return Boolean(book && next)
}

/**
 * Changes one sketch; null from the update (or a missing sketch) writes nothing. The sketch's own `updatedAt`
 * dates its name only (strokes and stamps carry their own dates): a stroke drawn later elsewhere must not undo a rename.
 */
function changeSketch(bookId: string, id: string, update: (sketch: Sketch) => Sketch | null): Promise<boolean> {
  return change(bookId, (sketches) => {
    const index = sketches.findIndex((sketch) => sketch.id === id)
    // Labels an older version kept as unknown fields are taken over first, so a change cannot bring them back.
    const next = index < 0 ? null : update(normalizeSketch(sketches[index]))
    if (!next) return null
    const copy = [...sketches]
    copy[index] = next
    return copy
  })
}

const forget = (sketch: Sketch, ids: string[]) => [...new Set([...(sketch.deleted ?? []), ...ids])]

export async function createSketch(bookId: string, name: string): Promise<Sketch> {
  const now = Date.now()
  let created: Sketch | undefined
  await change(bookId, (sketches) => {
    created = { id: newId(), name: name.trim() || `Skizze ${sketches.length + 1}`, strokes: [], stamps: [], createdAt: now, updatedAt: now }
    return [...sketches, created]
  })
  if (!created) throw new Error('Buch nicht gefunden')
  return created
}

export async function renameSketch(bookId: string, id: string, name: string): Promise<void> {
  const text = name.trim()
  await changeSketch(bookId, id, (sketch) => (!text || text === sketch.name ? null : { ...sketch, name: text, updatedAt: Math.max(Date.now(), sketch.updatedAt + 1) }))
}

/** Deletes a whole sketch (no trash: the sync keeps it when it was drawn on elsewhere meanwhile). */
export async function deleteSketch(bookId: string, id: string): Promise<void> {
  await change(bookId, (sketches) => (sketches.some((sketch) => sketch.id === id) ? sketches.filter((sketch) => sketch.id !== id) : null))
}

export async function addStroke(bookId: string, sketchId: string, stroke: Omit<SketchStroke, 'id' | 'createdAt'> & { createdAt?: number }): Promise<SketchStroke> {
  const added: SketchStroke = { createdAt: Date.now(), ...stroke, id: newId() }
  await changeSketch(bookId, sketchId, (sketch) => ({ ...sketch, strokes: [...sketch.strokes, added] }))
  return added
}

export async function addStamp(bookId: string, sketchId: string, stamp: Omit<SketchStamp, 'id' | 'updatedAt' | 'createdAt'> & { createdAt?: number }): Promise<SketchStamp> {
  const now = Date.now()
  const added: SketchStamp = { createdAt: now, ...stamp, id: newId(), updatedAt: now }
  await changeSketch(bookId, sketchId, (sketch) => ({ ...sketch, stamps: [...sketch.stamps, added] }))
  return added
}

export type StampPatch = Partial<Pick<SketchStamp, 'x' | 'y' | 'size' | 'color'>> & { entryId?: string | null; label?: string | null }

/** Moves, resizes, recolours, (un)links or (un)labels a stamp; entryId or label null removes it. */
export async function updateStamp(bookId: string, sketchId: string, id: string, patch: StampPatch): Promise<void> {
  await changeSketch(bookId, sketchId, (sketch) => {
    const index = sketch.stamps.findIndex((stamp) => stamp.id === id)
    if (index < 0) return null
    const old = sketch.stamps[index]
    const next: SketchStamp = { ...old }
    if (patch.x !== undefined) next.x = patch.x
    if (patch.y !== undefined) next.y = patch.y
    if (patch.size !== undefined) next.size = patch.size
    if (patch.color !== undefined) next.color = patch.color
    if (patch.entryId === null) delete next.entryId
    else if (patch.entryId !== undefined) next.entryId = patch.entryId
    if (patch.label === null || (patch.label !== undefined && !patch.label.trim())) delete next.label
    else if (patch.label !== undefined) next.label = patch.label.trim()
    if (JSON.stringify(next) === JSON.stringify(old)) return null
    next.updatedAt = Math.max(Date.now(), old.updatedAt + 1)
    const stamps = [...sketch.stamps]
    stamps[index] = next
    return { ...sketch, stamps }
  })
}

/** Erases strokes and stamps; their ids stay as tombstones so no other device brings them back. */
export async function removeItems(bookId: string, sketchId: string, ids: string[]): Promise<void> {
  const gone = new Set(ids)
  await changeSketch(bookId, sketchId, (sketch) => {
    const strokes = sketch.strokes.filter((stroke) => !gone.has(stroke.id))
    const stamps = sketch.stamps.filter((stamp) => !gone.has(stamp.id))
    if (strokes.length === sketch.strokes.length && stamps.length === sketch.stamps.length) return null
    return { ...sketch, strokes, stamps, deleted: forget(sketch, ids) }
  })
}

/** Undo of erasing: adds copies with new ids (the old ids stay erased, so the sync cannot revive or lose them). */
export async function restoreItems(bookId: string, sketchId: string, strokes: SketchStroke[], stamps: SketchStamp[]): Promise<{ strokes: SketchStroke[]; stamps: SketchStamp[] }> {
  const now = Date.now()
  const restored = {
    strokes: strokes.map((stroke) => ({ ...stroke, id: newId() })),
    stamps: stamps.map((stamp) => ({ ...stamp, id: newId(), updatedAt: now })),
  }
  if (!strokes.length && !stamps.length) return restored
  await changeSketch(bookId, sketchId, (sketch) => ({ ...sketch, strokes: [...sketch.strokes, ...restored.strokes], stamps: [...sketch.stamps, ...restored.stamps] }))
  return restored
}
