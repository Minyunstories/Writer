import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { countWords, formatWordCount } from '../lib/wordCount'
import { SYNCED_EVENT } from '../storage/connection'
import { coverOf } from '../lib/bookStyle'
import { createBook, deleteBook, listBooks, listChapters, nextCover, setBookStyle, updateBook } from '../storage/db'
import { SyncStatus } from '../sync/SyncStatus'
import type { Book } from '../types'
import { ConfirmDialog, PromptDialog } from '../ui/Dialogs'
import { updateSpelling } from '../storage/spelling'
import { BookMenu } from './BookMenu'
import './Dashboard.css'

/** The feather, served next to the app. */
export const FEATHER = `${import.meta.env.BASE_URL}favicon.svg`

interface BookSummary {
  book: Book
  words: number
  chapters: number
}

type DialogState = { kind: 'create' } | { kind: 'rename'; book: Book } | { kind: 'delete'; book: Book } | null

const dateFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })

/** "Zuletzt heute, 14:02" or "Zuletzt am 12.11.2026". */
export function lastChanged(time: number, now = new Date()): string {
  const date = new Date(time)
  return date.toDateString() === now.toDateString() ? `Zuletzt heute, ${timeFormat.format(date)}` : `Zuletzt am ${dateFormat.format(date)}`
}

async function loadSummaries(): Promise<BookSummary[]> {
  const books = await listBooks()
  return Promise.all(
    books.map(async (book) => {
      const chapters = await listChapters(book.id)
      return { book, words: chapters.reduce((sum, c) => sum + countWords(c.content), 0), chapters: chapters.length }
    }),
  )
}

export function Dashboard() {
  const [summaries, setSummaries] = useState<BookSummary[] | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const closeMenu = useCallback(() => setMenuFor(null), [])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setSummaries(await loadSummaries())
      setError(null)
    } catch {
      setError('Die Bücher konnten nicht geladen werden. Der Browser erlaubt hier vermutlich keinen lokalen Speicher.')
      setSummaries([])
    }
  }, [])

  useEffect(() => {
    void refresh()
    // Books may arrive or change through a sync run.
    const onSynced = () => void refresh()
    window.addEventListener(SYNCED_EVENT, onSynced)
    return () => window.removeEventListener(SYNCED_EVENT, onSynced)
  }, [refresh])

  /** Colour changes keep the menu open, so the effect can be seen and changed again. */
  const restyle = async (bookId: string, style: { cover?: string; highlight?: string }) => {
    try {
      await setBookStyle(bookId, style)
    } catch {
      setError('Das hat nicht geklappt. Bitte versuche es noch einmal.')
    }
    await refresh()
  }

  const run = async (action: () => Promise<unknown>) => {
    setDialog(null)
    setMenuFor(null)
    try {
      await action()
    } catch {
      setError('Das hat nicht geklappt. Bitte versuche es noch einmal.')
    }
    await refresh()
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <img className="dashboard-logo" src={FEATHER} alt="" />
        <h1>Writer</h1>
        <div className="dashboard-header-actions">
          <SyncStatus />
          <button className="primary dashboard-new" aria-label="Neues Buch" onClick={() => setDialog({ kind: 'create' })}>
            <span className="dashboard-new-plus" aria-hidden="true">
              +
            </span>
            <span className="dashboard-new-label">Neues Buch</span>
          </button>
        </div>
      </header>

      {error && (
        <p className="dashboard-error" role="alert">
          {error}
        </p>
      )}

      {summaries !== null && summaries.length === 0 && !error && (
        <div className="dashboard-empty">
          <p>Noch keine Bücher</p>
          <p className="muted">Lege dein erstes Buch an, um mit dem Schreiben zu beginnen.</p>
        </div>
      )}

      {summaries !== null && summaries.length > 0 && <p className="dashboard-shelf-label">Deine Bücher</p>}
      <div className="book-grid">
        {summaries?.map(({ book, words, chapters }) => (
          <article key={book.id} className="book-card" aria-label={book.title}>
            <Link
              to={`/book/${book.id}`}
              className="book-cover"
              aria-label={book.title}
              style={{ '--cover': coverOf(book) } as CSSProperties}
            >
              <span className="book-cover-title">{book.title}</span>
              <span className="book-cover-rule" aria-hidden="true" />
              <span className="book-cover-meta">
                <span>{formatWordCount(words)}</span>
                <span>{chapters === 1 ? '1 Kapitel' : `${chapters} Kapitel`}</span>
              </span>
              <span className="book-cover-date">{lastChanged(book.updatedAt)}</span>
            </Link>
            <button
              type="button"
              className="book-menu-button"
              aria-label={`Buchmenü für ${book.title}`}
              aria-expanded={menuFor === book.id}
              onClick={() => setMenuFor((open) => (open === book.id ? null : book.id))}
            >
              ⋯
            </button>
            {menuFor === book.id && (
              <BookMenu
                book={book}
                onCover={(cover) => void restyle(book.id, { cover })}
                onHighlight={(highlight) => void restyle(book.id, { highlight })}
                onDialect={(dialect) =>
                  void updateSpelling(book.id, (current) => ({ ...current, dialect }))
                    .catch(() => setError('Das hat nicht geklappt. Bitte versuche es noch einmal.'))
                    .then(refresh)
                }
                onRename={() => {
                  setMenuFor(null)
                  setDialog({ kind: 'rename', book })
                }}
                onDelete={() => {
                  setMenuFor(null)
                  setDialog({ kind: 'delete', book })
                }}
                onClose={closeMenu}
              />
            )}
          </article>
        ))}
        {summaries !== null && summaries.length > 0 && (
          <button className="book-new" aria-label="Neues Buch (im Regal)" onClick={() => setDialog({ kind: 'create' })}>
            <span className="book-new-plus" aria-hidden="true">
              +
            </span>
            <span aria-hidden="true">Neues Buch</span>
          </button>
        )}
      </div>

      {dialog?.kind === 'create' && (
        <PromptDialog
          heading="Neues Buch"
          confirmLabel="Anlegen"
          onCancel={() => setDialog(null)}
          onConfirm={(title) => run(async () => createBook(title, { cover: await nextCover() }))}
        />
      )}
      {dialog?.kind === 'rename' && (
        <PromptDialog
          heading="Buch umbenennen"
          initialValue={dialog.book.title}
          confirmLabel="Speichern"
          onCancel={() => setDialog(null)}
          onConfirm={(title) => run(() => updateBook(dialog.book.id, { title }))}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          message={`Buch „${dialog.book.title}" wirklich löschen?`}
          confirmLabel="Endgültig löschen"
          onCancel={() => setDialog(null)}
          onConfirm={() => run(() => deleteBook(dialog.book.id))}
        />
      )}
    </div>
  )
}
