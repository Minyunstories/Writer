import type { Chapter } from '../types'
import { ZoomControl } from '../book/ZoomControl'
import { useZoom } from '../lib/zoom'
import { ChapterText } from './ChapterText'
import './manuscript.css'

interface Props {
  title: string
  chapters: Chapter[]
  /** A click on a paragraph opens its chapter there (offset in the chapter text). */
  onOpen: (chapterId: string, offset: number) => void
}

/** The whole book as one long document to read through; a click jumps into the chapter to edit. */
export function Manuscript({ title, chapters, onOpen }: Props) {
  const [zoom] = useZoom('manuscript')
  return (
    <article className="manuscript" style={{ fontSize: `${(1.12 * zoom) / 100}rem` }}>
      <header className="manuscript-head">
        <h1>{title}</h1>
        <ZoomControl area="manuscript" />
        <button className="ghost manuscript-print" onClick={() => window.print()}>
          Drucken / als PDF
        </button>
      </header>
      {chapters.map((chapter) => {
        return (
          <section key={chapter.id} className="manuscript-chapter">
            <h2>
              <button className="manuscript-chapter-title" onClick={() => onOpen(chapter.id, 0)} title="Kapitel öffnen">
                {chapter.title}
              </button>
            </h2>
            <ChapterText content={chapter.content} onOpenAt={(offset) => onOpen(chapter.id, offset)} />
          </section>
        )
      })}
    </article>
  )
}
