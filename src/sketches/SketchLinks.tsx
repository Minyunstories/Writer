import { useId } from 'react'
import { isModuleOn } from '../modules/modules'
import type { Book, Sketch, SketchStamp } from '../types'
import { sketchesOf } from './sketchesOf'

type Props = {
  book: Book
  entryId: string
  onOpen(sketch: Sketch, stamp: SketchStamp): void
}

/** „Auf Skizzen“ in a wiki entry: the sketches with a stamp linked to it (only with the module, only when there are any). */
export function SketchLinks({ book, entryId, onOpen }: Props) {
  const id = useId()
  if (!isModuleOn(book, 'sketches')) return null
  const hits = sketchesOf(book, entryId)
  if (!hits.length) return null
  return (
    <section className="wiki-field sketch-links" aria-labelledby={`${id}-label`}>
      <span className="wiki-label" id={`${id}-label`}>
        Auf Skizzen
      </span>
      <ul className="relation-list">
        {hits.map(({ sketch, stamp }) => (
          <li key={sketch.id}>
            <button className="relation-name" onClick={() => onOpen(sketch, stamp)}>
              {sketch.name}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
