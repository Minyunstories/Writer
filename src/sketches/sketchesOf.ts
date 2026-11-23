import type { Book, Sketch, SketchStamp } from '../types'

/** The sketches with a stamp linked to the entry, each with its first such stamp (for centring on it). */
export function sketchesOf(book: Pick<Book, 'sketches'>, entryId: string): { sketch: Sketch; stamp: SketchStamp }[] {
  return (book.sketches ?? []).flatMap((sketch) => {
    const stamp = sketch.stamps.find((item) => item.entryId === entryId)
    return stamp ? [{ sketch, stamp }] : []
  })
}
