import { statusLabel } from '../lib/chapterStatus'
import type { Scene } from '../lib/scenes'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Book, Chapter } from '../types'

export type Section = 'chapters' | 'wiki' | 'outline' | 'manuscript'

const TABS: { id: Section; label: string }[] = [
  { id: 'chapters', label: 'Kapitel' },
  { id: 'wiki', label: 'Wiki' },
  { id: 'outline', label: 'Outline' },
]

interface Props {
  book: Book
  chapters: Chapter[]
  section: Section
  activeChapterId?: string
  /** Content of the wiki tab. */
  wiki?: ReactNode
  /** Content of the outline tab. */
  outline?: ReactNode
  onSelectSection: (section: Section) => void
  onNavigate: () => void
  onCreateChapter: () => void
  onRenameChapter: (chapter: Chapter) => void
  onDeleteChapter: (chapter: Chapter) => void
  /** Scenes of the open chapter (shown when there are at least two). */
  scenes?: Scene[]
  onOpenScene?: (index: number) => void
}

export function Sidebar({
  book,
  chapters,
  section,
  activeChapterId,
  wiki,
  outline,
  onSelectSection,
  onNavigate,
  onCreateChapter,
  onRenameChapter,
  scenes = [],
  onOpenScene,
  onDeleteChapter,
}: Props) {
  return (
    <nav className="sidebar" aria-label="Buchnavigation">
      <div className="sidebar-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={section === tab.id || (tab.id === 'chapters' && section === 'manuscript')}
            className="ghost sidebar-tab"
            onClick={() => onSelectSection(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {(section === 'chapters' || section === 'manuscript') && (
        <>
          <Link
            to={`/book/${book.id}/manuscript`}
            className={`sidebar-manuscript${section === 'manuscript' ? ' active' : ''}`}
            aria-current={section === 'manuscript' ? 'page' : undefined}
            onClick={onNavigate}
          >
            Manuskript lesen
          </Link>
          {chapters.length === 0 ? (
            <p className="muted sidebar-empty">Noch keine Kapitel</p>
          ) : (
            <ol className="chapter-list">
              {chapters.map((chapter) => {
                const active = chapter.id === activeChapterId
                return (
                  <li key={chapter.id} className={active ? 'active' : undefined}>
                    <Link
                      to={`/book/${book.id}/chapters/${chapter.id}`}
                      aria-current={active ? 'page' : undefined}
                      onClick={onNavigate}
                      title={statusLabel(chapter.status)}
                    >
                      {chapter.status && <span className={`status-dot status-${chapter.status}`} aria-hidden="true" />}
                      {chapter.title}
                    </Link>
                    <button
                      className="ghost icon"
                      aria-label="Kapitel umbenennen"
                      title="Umbenennen"
                      onClick={() => onRenameChapter(chapter)}
                    >
                      ✎
                    </button>
                    <button
                      className="ghost icon danger"
                      aria-label="Kapitel löschen"
                      title="Löschen"
                      onClick={() => onDeleteChapter(chapter)}
                    >
                      ×
                    </button>
                    {active && scenes.length > 1 && (
                      <ol className="scene-list" aria-label="Szenen">
                        {scenes.map((scene, index) => (
                          <li key={index}>
                            <button className="scene-link" onClick={() => onOpenScene?.(index)}>
                              <span className="scene-number">Szene {index + 1}</span>
                              <span className="scene-preview">{scene.preview || '(leer)'}</span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
          <button className="sidebar-add" onClick={onCreateChapter}>
            Neues Kapitel
          </button>
        </>
      )}

      {section === 'wiki' && wiki}

      {section === 'outline' && outline}
    </nav>
  )
}
