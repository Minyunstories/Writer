import { useState } from 'react'
import type { BookNote, Chapter, WikiEntry } from '../types'
import './notes.css'

interface Props {
  notes: BookNote[]
  chapters: Chapter[]
  entries: WikiEntry[]
  onAdd: (text: string) => void
  onDone: (id: string, done: boolean) => void
  onDelete: (id: string) => void
  onToChapter: (id: string, chapterId: string) => void
  onToEntry: (id: string, entryId: string) => void
  onOpenOrigin: (note: BookNote) => void
  onClose: () => void
}

/** The notepad: quick ideas that wait here until they find a better place. */
export function NotesPanel({ notes, chapters, entries, onAdd, onDone, onDelete, onToChapter, onToEntry, onOpenOrigin, onClose }: Props) {
  const [draft, setDraft] = useState('')
  const [showDone, setShowDone] = useState(false)
  const open = notes.filter((note) => !note.done)
  const done = notes.filter((note) => note.done)
  const titleOf = (chapterId?: string) => chapters.find((chapter) => chapter.id === chapterId)?.title

  const submit = () => {
    if (!draft.trim()) return
    onAdd(draft)
    setDraft('')
  }

  return (
    <aside className="book-panel notes-panel" aria-label="Notizblock">
      <header className="book-panel-header">
        <span className="notes-title">Notizblock</span>
        <button className="ghost" onClick={onClose}>
          Schließen
        </button>
      </header>
      <div className="book-panel-body notes-body">
        <textarea
          className="notes-input"
          aria-label="Neue Idee"
          placeholder="Neue Idee … (Enter speichert)"
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
        />

        {open.length === 0 ? (
          <p className="muted notes-empty">Keine offenen Ideen.</p>
        ) : (
          <ul className="notes-list" aria-label="Offene Ideen">
            {open.map((note) => {
              const origin = titleOf(note.chapterId)
              return (
                <li key={note.id} className="note">
                  <p className="note-text">{note.text}</p>
                  {origin && (
                    <button className="note-origin" onClick={() => onOpenOrigin(note)}>
                      aus: {origin}
                    </button>
                  )}
                  <div className="note-actions">
                    <select
                      aria-label="In die Outline von …"
                      value=""
                      onChange={(event) => event.target.value && onToChapter(note.id, event.target.value)}
                    >
                      <option value="">→ Kapitel</option>
                      {chapters.map((chapter) => (
                        <option key={chapter.id} value={chapter.id}>
                          {chapter.title}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="In die Notizen von …"
                      value=""
                      disabled={entries.length === 0}
                      onChange={(event) => event.target.value && onToEntry(note.id, event.target.value)}
                    >
                      <option value="">→ Wiki</option>
                      {[...entries]
                        .sort((a, b) => a.name.localeCompare(b.name, 'de'))
                        .map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.name}
                          </option>
                        ))}
                    </select>
                    <button onClick={() => onDone(note.id, true)}>Erledigt</button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {done.length > 0 && (
          <div className="notes-done">
            <button className="ghost notes-done-toggle" aria-expanded={showDone} onClick={() => setShowDone((on) => !on)}>
              {showDone ? '▾' : '▸'} Erledigt ({done.length})
            </button>
            {showDone && (
              <ul className="notes-list" aria-label="Erledigte Ideen">
                {done.map((note) => (
                  <li key={note.id} className="note done">
                    <p className="note-text">{note.text}</p>
                    <div className="note-actions">
                      <button className="ghost" onClick={() => onDone(note.id, false)}>
                        Wieder öffnen
                      </button>
                      <button className="ghost danger" onClick={() => onDelete(note.id)}>
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
