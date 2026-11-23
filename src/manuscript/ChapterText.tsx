import type { ReactNode } from 'react'
import { parseSceneBreak } from '../lib/sceneBreak'

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

interface Props {
  content: string
  /** A click on a paragraph: its offset in the chapter text. Without it, the text is only to read. */
  onOpenAt?: (offset: number) => void
}

/** A chapter's text to read: paragraphs, subheadings, scene breaks (without their names), bold, italic and highlights. */
export function ChapterText({ content, onOpenAt }: Props) {
  let offset = 0
  let written = false
  const blocks = content.split('\n').flatMap((line) => {
    const start = offset
    offset += line.length + 1
    if (!line.trim()) return []
    const scene = line.includes('*') ? parseSceneBreak(line) : null
    const first = !written
    written = true
    if (scene) {
      // Scene names are only for writing. A name line at the very top is no break at all.
      if (first && scene.name) return []
      return [
        <div key={start} className="manuscript-separator" aria-hidden="true">
          ***
        </div>,
      ]
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    const open = onOpenAt ? () => onOpenAt(start) : undefined
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
  return <>{blocks.length > 0 ? blocks : <p className="muted">Noch kein Text.</p>}</>
}
