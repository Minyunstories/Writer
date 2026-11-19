import { useEffect, useRef } from 'react'
import { COVERS, coverOf, HIGHLIGHTS, highlightOf } from '../lib/bookStyle'
import { isModuleOn, MODULES, type ModuleId } from '../modules/modules'
import { COVER_PATTERNS, patternOf, type CoverPattern } from '../shelf/shelf'
import type { Book, EnglishDialect } from '../types'

interface Props {
  book: Book
  onCover: (color: string) => void
  onHighlight: (color: string) => void
  /** null: no pattern. */
  onPattern: (pattern: CoverPattern | null) => void
  onDialect: (dialect: EnglishDialect) => void
  onModule: (id: ModuleId, on: boolean) => void
  onRename: () => void
  onDelete: () => void
  onClose: () => void
}

/** The "⋯" menu of a book on the shelf: colours, pattern, check, modules, rename, delete. */
export function BookMenu({ book, onCover, onHighlight, onPattern, onDialect, onModule, onRename, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const label = `Buchmenü für ${book.title}`
  const cover = coverOf(book)
  const highlight = highlightOf(book)
  const pattern = patternOf(book)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    // A press anywhere else closes the menu.
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (ref.current && !ref.current.contains(target) && !(target as Element).closest?.('.book-menu-button')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [onClose])

  return (
    <div ref={ref} className="book-menu" role="dialog" aria-label={label}>
      <span className="book-menu-label">Farbe des Einbands</span>
      <div className="book-menu-covers">
        {COVERS.map((swatch) => (
          <button
            key={swatch.color}
            type="button"
            className="book-menu-swatch"
            aria-label={`Einband ${swatch.name}`}
            title={swatch.name}
            aria-pressed={cover === swatch.color}
            style={{ background: swatch.color }}
            onClick={() => onCover(swatch.color)}
          />
        ))}
      </div>
      <span className="book-menu-label">Muster</span>
      <div className="book-menu-patterns">
        <button
          type="button"
          className="book-menu-swatch book-menu-swatch-square"
          aria-label="Ohne Muster"
          title="Ohne"
          aria-pressed={pattern === undefined}
          style={{ backgroundColor: cover }}
          onClick={() => onPattern(null)}
        />
        {COVER_PATTERNS.map((option) => (
          <button
            key={option.id}
            type="button"
            className="book-menu-swatch book-menu-swatch-square book-menu-pattern"
            aria-label={`Muster ${option.name}`}
            title={option.name}
            aria-pressed={pattern === option.id}
            data-pattern={option.id}
            style={{ backgroundColor: cover }}
            onClick={() => onPattern(option.id)}
          />
        ))}
      </div>
      <span className="book-menu-label">Farbe für Markierungen</span>
      <div className="book-menu-highlights">
        {HIGHLIGHTS.map((swatch) => (
          <button
            key={swatch.color}
            type="button"
            className="book-menu-swatch book-menu-swatch-square"
            aria-label={`Markierung ${swatch.name}`}
            title={swatch.name}
            aria-pressed={highlight === swatch.color}
            style={{ background: swatch.color }}
            onClick={() => onHighlight(swatch.color)}
          />
        ))}
      </div>
      <label className="book-menu-label" htmlFor={`dialect-${book.id}`}>
        Englisch der Prüfung
      </label>
      <select
        id={`dialect-${book.id}`}
        className="book-menu-select"
        value={book.spelling?.dialect ?? 'american'}
        onChange={(event) => onDialect(event.target.value as EnglishDialect)}
      >
        <option value="american">Amerikanisch</option>
        <option value="british">Britisch</option>
        <option value="canadian">Kanadisch</option>
        <option value="australian">Australisch</option>
      </select>
      <span className="book-menu-label">Module</span>
      <div className="book-menu-modules">
        {MODULES.map((module) => (
          <label key={module.id} className="book-menu-module">
            <input type="checkbox" checked={isModuleOn(book, module.id)} onChange={(event) => onModule(module.id, event.target.checked)} />
            {module.name}
          </label>
        ))}
      </div>
      <div className="book-menu-rule" />
      <button type="button" className="book-menu-action" onClick={onRename}>
        Umbenennen
      </button>
      <button type="button" className="book-menu-action danger" onClick={onDelete}>
        Löschen
      </button>
    </div>
  )
}
