import type { ReactNode } from 'react'
import { SketchesView, type SketchesViewProps } from './SketchesView'

type Props = Omit<SketchesViewProps, 'actions'> & {
  tabs: ReactNode
  /** Laid over the whole book (the chapter stays open underneath). */
  wide: boolean
  onWide(wide: boolean): void
  onClose(): void
}

/** Sketches in the right panel, beside the text while writing. */
export function SketchesPanel({ tabs, wide, onWide, onClose, ...view }: Props) {
  return (
    <aside className={`book-panel notes-panel sketches-panel${wide ? ' wide' : ''}`} aria-label="Skizzen">
      <header className="book-panel-header">
        {tabs}
        <button className="ghost icon panel-close" aria-label="Schließen" title="Schließen" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="book-panel-body sketches-panel-body">
        <SketchesView
          {...view}
          actions={
            <button className="ghost" title={wide ? 'Wieder als Leiste neben dem Text' : 'Über die ganze Buchfläche legen'} onClick={() => onWide(!wide)}>
              {wide ? 'Verkleinern' : 'Vergrößern'}
            </button>
          }
        />
      </div>
    </aside>
  )
}
