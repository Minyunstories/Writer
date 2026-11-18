import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { COMMENTS_EVENT, deleteComment, resolveAnchor, updateComment } from '../storage/comments'
import { SYNCED_EVENT } from '../storage/connection'
import { getChapter, listChapters } from '../storage/db'
import type { Chapter, ChapterComment } from '../types'
import './comments.css'

interface Props {
  bookId: string
  tabs?: ReactNode
  onOpen: (chapterId: string, range: { from: number; to: number }) => void
  onClose: () => void
}

/** Every comment in the book, by chapter: jump to it, mark it done, delete it. */
export function CommentsPanel({ bookId, tabs, onOpen, onClose }: Props) {
  const [chapters, setChapters] = useState<Chapter[] | null>(null)
  const [showDone, setShowDone] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    listChapters(bookId).then(setChapters, () => setFailed(true))
  }, [bookId])
  useEffect(() => {
    load()
    window.addEventListener(COMMENTS_EVENT, load)
    window.addEventListener(SYNCED_EVENT, load)
    return () => {
      window.removeEventListener(COMMENTS_EVENT, load)
      window.removeEventListener(SYNCED_EVENT, load)
    }
  }, [load])

  const attempt = (action: () => Promise<void>) => void action().catch(() => setFailed(true))
  const open = (chapterId: string, comment: ChapterComment) =>
    void getChapter(chapterId).then((chapter) => onOpen(chapterId, resolveAnchor(chapter?.content ?? '', comment)))

  const withComments = (chapters ?? []).filter((chapter) => chapter.comments?.length)
  const openOnes = withComments.map((chapter) => ({ chapter, comments: chapter.comments!.filter((c) => !c.done) })).filter((group) => group.comments.length)
  const doneOnes = withComments.flatMap((chapter) => chapter.comments!.filter((c) => c.done).map((comment) => ({ chapter, comment })))

  return (
    <aside className="book-panel notes-panel comments-panel" aria-label="Kommentare">
      <header className="book-panel-header">
        {tabs ?? <span className="notes-title">Kommentare</span>}
        <button className="ghost" onClick={onClose}>
          Schließen
        </button>
      </header>
      <div className="book-panel-body notes-body">
        {failed && <p className="comments-error">Das hat nicht geklappt. Bitte noch einmal versuchen.</p>}
        {chapters && openOnes.length === 0 && <p className="muted notes-empty">Keine offenen Kommentare. Text markieren und Strg+Alt+M drücken, um einen zu schreiben.</p>}
        {openOnes.map(({ chapter, comments }) => (
          <section key={chapter.id} className="comments-chapter">
            <h3>{chapter.title}</h3>
            <ul className="notes-list">
              {comments.map((comment) => (
                <li key={comment.id} className="note comment">
                  <button className="comment-jump" onClick={() => open(chapter.id, comment)}>
                    <span className="comment-quote">„{comment.quote.length > 80 ? `${comment.quote.slice(0, 80)}…` : comment.quote}“</span>
                    <span className="note-text">{comment.text || '(leer)'}</span>
                  </button>
                  <div className="note-actions">
                    <button onClick={() => attempt(() => updateComment(chapter.id, comment.id, { done: true }))}>Erledigt</button>
                    <button className="ghost danger" onClick={() => attempt(() => deleteComment(chapter.id, comment.id))}>
                      Löschen
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {doneOnes.length > 0 && (
          <div className="notes-done">
            <button className="ghost notes-done-toggle" aria-expanded={showDone} onClick={() => setShowDone((on) => !on)}>
              {showDone ? '▾' : '▸'} Erledigt ({doneOnes.length})
            </button>
            {showDone && (
              <ul className="notes-list">
                {doneOnes.map(({ chapter, comment }) => (
                  <li key={comment.id} className="note done">
                    <p className="note-text">{comment.text}</p>
                    <p className="muted comment-where">
                      {chapter.title}: „{comment.quote.slice(0, 60)}“
                    </p>
                    <div className="note-actions">
                      <button className="ghost" onClick={() => attempt(() => updateComment(chapter.id, comment.id, { done: false }))}>
                        Wieder öffnen
                      </button>
                      <button className="ghost danger" onClick={() => attempt(() => deleteComment(chapter.id, comment.id))}>
                        Löschen
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
