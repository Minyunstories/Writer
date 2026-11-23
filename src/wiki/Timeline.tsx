import { splitScenes } from '../lib/scenes'
import { statusLabel } from '../lib/chapterStatus'
import type { Chapter } from '../types'
import type { Mention } from './mentions'

interface Props {
  name: string
  chapters: Chapter[]
  mentions: Mention[]
  onOpen?: (chapterId: string, range: { from: number; to: number }) => void
}

const AROUND = 40

/** A few words around the first mention. */
function snippet(content: string, from: number, to: number): string {
  const start = Math.max(0, content.lastIndexOf('\n', from) + 1, from - AROUND)
  const lineEnd = content.indexOf('\n', to)
  const end = Math.min(lineEnd < 0 ? content.length : lineEnd, to + AROUND)
  return `${start > 0 && content[start - 1] !== '\n' ? '…' : ''}${content.slice(start, end).replace(/[*_=]/g, '')}${end < content.length && content[end] !== '\n' ? '…' : ''}`
}

/** Where an entry appears through the book, chapter by chapter, with dates, scenes and the gaps between. */
export function Timeline({ name, chapters, mentions, onOpen }: Props) {
  const byChapter = new Map(mentions.map((mention) => [mention.chapterId, mention]))
  const rows: ({ kind: 'gap'; count: number } | { kind: 'chapter'; chapter: Chapter; index: number })[] = []
  chapters.forEach((chapter, index) => {
    if (byChapter.has(chapter.id)) rows.push({ kind: 'chapter', chapter, index })
    else if (rows.length > 0) {
      const last = rows[rows.length - 1]
      if (last.kind === 'gap') last.count++
      else rows.push({ kind: 'gap', count: 1 })
    }
  })
  // A gap at the end says nothing: the story simply goes on without the entry.
  if (rows.at(-1)?.kind === 'gap') rows.pop()

  return (
    <ol className="wiki-timeline" aria-label="Zeitleiste">
      {rows.map((row, position) => {
        if (row.kind === 'gap')
          return (
            <li key={`gap-${position}`} className="wiki-timeline-gap">
              {row.count} {row.count === 1 ? 'Kapitel' : 'Kapitel'} ohne {name}
            </li>
          )
        const { chapter, index } = row
        const mention = byChapter.get(chapter.id)!
        const scenes = splitScenes(chapter.content)
        const sceneOf = (offset: number) => scenes.filter((scene) => scene.start <= offset).length
        const status = statusLabel(chapter.status)
        return (
          <li key={chapter.id} className="wiki-timeline-item">
            <span className="wiki-timeline-dot" aria-hidden="true" />
            <button className="wiki-timeline-card" onClick={() => onOpen?.(chapter.id, mention.first)}>
              <span className="wiki-timeline-head">
                {chapter.date && <span className="wiki-timeline-date">{chapter.date}</span>}
                <span className="wiki-mention-number">{index + 1}</span>
                <span className="wiki-mention-title">{chapter.title}</span>
                <span className="wiki-mention-count">{mention.count}×</span>
              </span>
              <span className="wiki-timeline-text">{snippet(chapter.content, mention.first.from, mention.first.to)}</span>
              {(scenes.length > 1 || status) && (
                <span className="muted wiki-timeline-meta">
                  {scenes.length > 1 && `ab Szene ${sceneOf(mention.first.from)} von ${scenes.length}`}
                  {scenes.length > 1 && status && ' · '}
                  {status}
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
