import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { countWords, formatWordCount } from '../lib/wordCount'
import { SYNCED_EVENT } from '../storage/connection'
import { createBook, deleteBook, listBooks, listChapters, updateBook } from '../storage/db'
import { SyncStatus } from '../sync/SyncStatus'
import type { Book } from '../types'
import { ConfirmDialog, PromptDialog } from '../ui/Dialogs'
import './Dashboard.css'

interface BookSummary {
  book: Book
  words: number
}

type DialogState = { kind: 'create' } | { kind: 'rename'; book: Book } | { kind: 'delete'; book: Book } | null

const dateFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })

async function loadSummaries(): Promise<BookSummary[]> {
  const books = await listBooks()
  return Promise.all(
    books.map(async (book) => {
      const chapters = await listChapters(book.id)
      return { book, words: chapters.reduce((sum, c) => sum + countWords(c.content), 0) }
    }),
  )
}

export function Dashboard() {
  const [summaries, setSummaries] = useState<BookSummary[] | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
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

  const run = async (action: () => Promise<unknown>) => {
    setDialog(null)
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
        <h1>MinyunWriter</h1>
        <div className="dashboard-header-actions">
          <SyncStatus />
          <button className="primary" onClick={() => setDialog({ kind: 'create' })}>
            Neues Buch
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

      <div className="book-grid">
        {summaries?.map(({ book, words }) => (
          <article key={book.id} className="book-card" aria-label={book.title}>
            <Link to={`/book/${book.id}`} className="book-card-title">
              {book.title}
            </Link>
            <p className="muted book-card-meta">{formatWordCount(words)}</p>
            <p className="muted book-card-meta">Zuletzt geändert {dateFormat.format(book.updatedAt)}</p>
            <div className="book-card-actions">
              <button className="ghost" onClick={() => setDialog({ kind: 'rename', book })}>
                Umbenennen
              </button>
              <button className="ghost danger" onClick={() => setDialog({ kind: 'delete', book })}>
                Löschen
              </button>
            </div>
          </article>
        ))}
      </div>

      {dialog?.kind === 'create' && (
        <PromptDialog
          heading="Neues Buch"
          confirmLabel="Anlegen"
          onCancel={() => setDialog(null)}
          onConfirm={(title) => run(() => createBook(title))}
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
