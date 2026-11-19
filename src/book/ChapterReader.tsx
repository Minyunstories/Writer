import { useEffect, useState, type ReactNode } from 'react'
import type { Chapter } from '../types'
import { ChapterText } from '../manuscript/ChapterText'
import { useStored } from '../modules/drawerState'
import { CHANGED_EVENT, SYNCED_EVENT } from '../storage/connection'
import { getChapter } from '../storage/db'
import './reader.css'

interface Props {
  bookId: string
  /** In book order. */
  chapters: Chapter[]
  /** The chapter open in the editor (not offered), if any. */
  currentId: string | null
  tabs?: ReactNode
  onOpen: (chapterId: string) => void
  onClose: () => void
}

/**
 * Another chapter to read beside the text. Starts with the chapter before the open one (the first
 * chapter: the next one); the choice is remembered on this device, per book.
 */
export function ChapterReader({ bookId, chapters, currentId, tabs, onOpen, onClose }: Props) {
  const [stored, setStored] = useStored<string>(`mw:reader:${bookId}`, '')
  const others = chapters.filter((chapter) => chapter.id !== currentId)
  const index = chapters.findIndex((chapter) => chapter.id === currentId)
  const fallback = index > 0 ? chapters[index - 1] : others[0]
  const chosen = others.find((chapter) => chapter.id === stored) ?? fallback
  const number = (chapter: Chapter) => chapters.indexOf(chapter) + 1

  // The list handed in may be older than what is stored (it is not reloaded on every save):
  // read the chosen chapter itself, again after every save here and every sync run.
  const chosenId = chosen?.id
  const [fresh, setFresh] = useState<{ id: string; content: string } | null>(null)
  useEffect(() => {
    if (!chosenId) return
    let current = true
    const load = () =>
      getChapter(chosenId)
        .then((stored) => {
          if (current && stored) setFresh({ id: stored.id, content: stored.content })
        })
        .catch(() => {})
    void load()
    window.addEventListener(CHANGED_EVENT, load)
    window.addEventListener(SYNCED_EVENT, load)
    return () => {
      current = false
      window.removeEventListener(CHANGED_EVENT, load)
      window.removeEventListener(SYNCED_EVENT, load)
    }
  }, [chosenId])
  const content = fresh && fresh.id === chosenId ? fresh.content : (chosen?.content ?? '')

  return (
    <aside className="book-panel notes-panel reader-panel" aria-label="Kapitel lesen">
      <header className="book-panel-header">
        {tabs ?? <span className="notes-title">Kapitel lesen</span>}
        <button className="ghost icon panel-close" aria-label="Schließen" title="Schließen" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="book-panel-body reader-body">
        {chosen ? (
          <>
            <div className="reader-choice">
              <select aria-label="Kapitel" value={chosen.id} onChange={(event) => setStored(event.target.value)}>
                {others.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {number(chapter)} · {chapter.title}
                  </option>
                ))}
              </select>
              <button className="ghost" onClick={() => onOpen(chosen.id)}>
                Öffnen
              </button>
            </div>
            <div className="reader-text">
              <ChapterText content={content} />
            </div>
          </>
        ) : (
          <p className="muted notes-empty">Es gibt noch kein anderes Kapitel zum Lesen.</p>
        )}
      </div>
    </aside>
  )
}
