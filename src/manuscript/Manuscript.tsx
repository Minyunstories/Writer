import type { ReactNode } from 'react'
import type { Chapter } from '../types'
import { ZoomControl } from '../book/ZoomControl'
import { SEPARATOR } from '../editor/livePreview'
import { useZoom } from '../lib/zoom'
import './manuscript.css'

interface Props {
  title: string
  chapters: Chapter[]
  /** A click on a paragraph opens its chapter there (offset in the chapter text). */
  onOpen: (chapterId: string, offset: number) => void
}

const INLINE = /(\*\*[^*\n]+\*\*|==[^=\n]+==|\*[^*\n]+\*|_[^_\n]+_)/g

/** Bold, italic and highlighted text as elements; everything else as plain text. */
function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('==') && part.endsWith('==') && part.length > 4) return <mark key={index}>{part.slice(2, -2)}</mark>
    if (/^(\*[^*]+\*|_[^_]+_)$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>
    return part
  })
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
        let offset = 0
        const blocks = chapter.content.split('\n').flatMap((line) => {
          const start = offset
          offset += line.length + 1
          if (!line.trim()) return []
          if (SEPARATOR.test(line))
            return [
              <div key={start} className="manuscript-separator" aria-hidden="true">
                ***
              </div>,
            ]
          const heading = /^(#{1,6})\s+(.*)$/.exec(line)
          const open = () => onOpen(chapter.id, start)
          if (heading)
            return [
              <h3 key={start} className="manuscript-subhead" onClick={open}>
                {inline(heading[2])}
              </h3>,
            ]
          return [
            <p key={start} onClick={open}>
              {inline(line)}
            </p>,
          ]
        })
        return (
          <section key={chapter.id} className="manuscript-chapter">
            <h2>
              <button className="manuscript-chapter-title" onClick={() => onOpen(chapter.id, 0)} title="Kapitel öffnen">
                {chapter.title}
              </button>
            </h2>
            {blocks.length > 0 ? blocks : <p className="muted">Noch kein Text.</p>}
          </section>
        )
      })}
    </article>
  )
}
