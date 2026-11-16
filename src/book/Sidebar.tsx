import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Book, Chapter } from '../types'

export type Section = 'chapters' | 'wiki' | 'outline'

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
  onDeleteChapter,
}: Props) {
  return (
    <nav className="sidebar" aria-label="Buchnavigation">
      <div className="sidebar-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={section === tab.id}
            className="ghost sidebar-tab"
            onClick={() => onSelectSection(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {section === 'chapters' && (
        <>
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
                    >
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
