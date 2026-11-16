import type { Extension } from '@codemirror/state'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { SYNCED_EVENT } from '../storage/connection'
import { createChapter, deleteChapter, getBook, listChapters, updateChapter } from '../storage/db'
import {
  createEntry,
  createFolder,
  deleteFolder,
  listEntries,
  listFolders,
  renameFolder,
} from '../storage/wiki'
import type { Book, Chapter, WikiEntry, WikiFolder } from '../types'
import { Outline } from '../outline/Outline'
import { SyncStatus } from '../sync/SyncStatus'
import { ConfirmDialog, PromptDialog } from '../ui/Dialogs'
import { buildMatcher } from '../wiki/linker'
import { WikiEntryEditor } from '../wiki/WikiEntryEditor'
import { createWikiLinks } from '../wiki/wikiLinks'
import { WikiSidebar } from '../wiki/WikiSidebar'
import { Sidebar, type Section } from './Sidebar'
import './book.css'

export interface ChapterRenderProps {
  book: Book
  chapter: Chapter
  /** Call after the book or chapter was changed so lists and titles refresh. */
  onChanged: () => void
  /** Editor extensions provided by the book view, e.g. wiki links. */
  extensions: Extension[]
}

interface Props {
  renderChapter?: (props: ChapterRenderProps) => ReactNode
}

type DialogState =
  | { kind: 'rename'; chapter: Chapter }
  | { kind: 'delete'; chapter: Chapter }
  | { kind: 'newFolder'; parentId: string | null }
  | { kind: 'renameFolder'; folder: WikiFolder }
  | { kind: 'deleteFolder'; folder: WikiFolder }
  | null

/** The first "Kapitel N" that is not taken yet. */
function nextChapterTitle(chapters: Chapter[]): string {
  const taken = new Set(chapters.map((chapter) => chapter.title))
  let number = chapters.length + 1
  while (taken.has(`Kapitel ${number}`)) number++
  return `Kapitel ${number}`
}

const SECTIONS: Section[] = ['chapters', 'wiki', 'outline']

function isNarrow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 720px)').matches
}

export function BookView({ renderChapter }: Props) {
  const { bookId = '', section: rawSection, itemId } = useParams()
  const section: Section = SECTIONS.includes(rawSection as Section) ? (rawSection as Section) : 'chapters'
  const navigate = useNavigate()

  const [book, setBook] = useState<Book | null | undefined>(undefined)
  const [loadFailed, setLoadFailed] = useState(false)
  const [actionError, setActionError] = useState(false)
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [folders, setFolders] = useState<WikiFolder[]>([])
  const [entries, setEntries] = useState<WikiEntry[]>([])
  const [panelEntryId, setPanelEntryId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrow())

  /** Reloads folders and entries only; cheap enough to run after every wiki edit. */
  const reloadWiki = useCallback(async () => {
    try {
      const [loadedFolders, loadedEntries] = await Promise.all([listFolders(bookId), listEntries(bookId)])
      setFolders(loadedFolders)
      setEntries(loadedEntries)
    } catch {
      setActionError(true)
    }
  }, [bookId])

  const reload = useCallback(async () => {
    try {
      const loaded = await getBook(bookId)
      setBook(loaded ?? null)
      setChapters(loaded ? await listChapters(bookId) : [])
      setLoadFailed(false)
    } catch {
      setLoadFailed(true)
      return
    }
    await reloadWiki()
  }, [bookId, reloadWiki])

  useEffect(() => {
    setBook(undefined)
    setPanelEntryId(null)
    void reload()
  }, [reload])

  // Each section saves on its own; refresh the shared lists when the writer switches,
  // so no section starts from an outdated copy.
  // A sync run may have changed anything in this book.
  useEffect(() => {
    const onSynced = () => void reload()
    window.addEventListener(SYNCED_EVENT, onSynced)
    return () => window.removeEventListener(SYNCED_EVENT, onSynced)
  }, [reload])

  const firstSection = useRef(true)
  useEffect(() => {
    if (firstSection.current) {
      // The book is loaded by the effect above on first render.
      firstSection.current = false
      return
    }
    void reload()
    // Only the switch matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section])

  // Names in the chapter text link to their wiki entry; a click opens the panel.
  const links = useMemo(
    () => createWikiLinks({ onOpen: (entryId) => setPanelEntryId(entryId) }),
    // One instance per book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookId],
  )
  const extensions = useMemo(() => [links.extension], [links])
  useEffect(() => {
    links.setMatcher(buildMatcher(entries))
  }, [links, entries])

  const activeChapter = section === 'chapters' ? chapters.find((c) => c.id === itemId) : undefined

  // Keep the URL pointing at an existing chapter.
  useEffect(() => {
    if (!book || section !== 'chapters' || activeChapter) return
    if (chapters.length > 0) {
      navigate(`/book/${book.id}/chapters/${chapters[0].id}`, { replace: true })
    } else if (itemId) {
      navigate(`/book/${book.id}/chapters`, { replace: true })
    }
  }, [book, section, activeChapter, chapters, itemId, navigate])

  const closeSidebarOnPhone = () => {
    if (isNarrow()) setSidebarOpen(false)
  }

  /** Runs a storage action and tells the writer when it failed. */
  const attempt = async (action: () => Promise<void>) => {
    setActionError(false)
    try {
      await action()
    } catch {
      setActionError(true)
    }
    await reload()
  }

  /** Creates a chapter. From the outline the writer stays in the outline. */
  const handleCreate = (open = true) =>
    attempt(async () => {
      if (!book) return
      const chapter = await createChapter(book.id, nextChapterTitle(chapters))
      if (!open) return
      navigate(`/book/${book.id}/chapters/${chapter.id}`)
      closeSidebarOnPhone()
    })

  const handleRename = (chapter: Chapter, title: string) => {
    setDialog(null)
    return attempt(async () => {
      await updateChapter(chapter.id, { title })
    })
  }

  const handleDelete = (chapter: Chapter) => {
    setDialog(null)
    return attempt(async () => {
      if (!book) return
      const index = chapters.findIndex((c) => c.id === chapter.id)
      const remaining = chapters.filter((c) => c.id !== chapter.id)
      await deleteChapter(chapter.id)
      if (chapter.id === itemId) {
        const next = remaining[Math.min(index, remaining.length - 1)]
        navigate(next ? `/book/${book.id}/chapters/${next.id}` : `/book/${book.id}/chapters`, { replace: true })
      }
    })
  }

  const handleCreateFolder = (parentId: string | null, name: string) => {
    setDialog(null)
    return attempt(async () => {
      if (book) await createFolder(book.id, name, parentId)
    })
  }

  const handleCreateEntry = (folderId: string | null) =>
    attempt(async () => {
      if (!book) return
      const entry = await createEntry(book.id, 'Unbenannt', folderId)
      navigate(`/book/${book.id}/wiki/${entry.id}`)
      closeSidebarOnPhone()
    })

  const handleRenameFolder = (folder: WikiFolder, name: string) => {
    setDialog(null)
    return attempt(async () => {
      await renameFolder(folder.id, name)
    })
  }

  const handleDeleteFolder = (folder: WikiFolder) => {
    setDialog(null)
    return attempt(async () => {
      await deleteFolder(folder.id)
    })
  }

  const activeEntry = section === 'wiki' ? entries.find((entry) => entry.id === itemId) : undefined
  const panelEntry = section === 'chapters' ? entries.find((entry) => entry.id === panelEntryId) : undefined

  if (loadFailed && !book) {
    return (
      <div className="book-message">
        <p>Das Buch konnte nicht geladen werden.</p>
        <button className="primary" onClick={() => void reload()}>
          Erneut versuchen
        </button>
        <Link to="/" className="book-back-link">
          Zurück zur Übersicht
        </Link>
      </div>
    )
  }

  if (book === undefined) return <div className="book-message muted">Lädt …</div>

  if (book === null) {
    return (
      <div className="book-message">
        <p>Buch nicht gefunden</p>
        <Link to="/" className="book-back-link">
          Zurück zur Übersicht
        </Link>
      </div>
    )
  }

  return (
    <div className={`book${sidebarOpen ? ' sidebar-open' : ''}`}>
      <header className="book-header">
        <button
          className="ghost icon"
          aria-label={sidebarOpen ? 'Navigation ausblenden' : 'Navigation einblenden'}
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          ☰
        </button>
        <Link to="/" className="book-back" aria-label="Zurück zur Übersicht" title="Zurück zur Übersicht">
          ←
        </Link>
        <h1>{book.title}</h1>
        <span className="book-header-space" />
        <SyncStatus />
      </header>

      {actionError && (
        <p className="book-error" role="alert">
          Das hat nicht geklappt. Bitte versuche es noch einmal.
          <button className="ghost" onClick={() => setActionError(false)}>
            Schließen
          </button>
        </p>
      )}

      <div className="book-body">
        <div className="sidebar-wrap">
          <Sidebar
            book={book}
            chapters={chapters}
            section={section}
            activeChapterId={activeChapter?.id}
            onSelectSection={(next) => navigate(`/book/${book.id}/${next}`)}
            onNavigate={closeSidebarOnPhone}
            onCreateChapter={() => void handleCreate()}
            onRenameChapter={(chapter) => setDialog({ kind: 'rename', chapter })}
            onDeleteChapter={(chapter) => setDialog({ kind: 'delete', chapter })}
            outline={
              chapters.length === 0 ? (
                <p className="muted sidebar-empty">Noch keine Kapitel</p>
              ) : (
                <ol className="outline-jump">
                  {chapters.map((chapter) => (
                    <li key={chapter.id}>
                      <button
                        className="ghost"
                        aria-label={`Zu ${chapter.title} springen`}
                        onClick={() => {
                          document.getElementById(`outline-${chapter.id}`)?.scrollIntoView?.({ block: 'start' })
                          closeSidebarOnPhone()
                        }}
                      >
                        {chapter.title}
                      </button>
                    </li>
                  ))}
                </ol>
              )
            }
            wiki={
              <WikiSidebar
                bookId={book.id}
                folders={folders}
                entries={entries}
                activeEntryId={activeEntry?.id}
                onNavigate={closeSidebarOnPhone}
                onCreateFolder={(parentId) => setDialog({ kind: 'newFolder', parentId })}
                onCreateEntry={handleCreateEntry}
                onRenameFolder={(folder) => setDialog({ kind: 'renameFolder', folder })}
                onDeleteFolder={(folder) => setDialog({ kind: 'deleteFolder', folder })}
              />
            }
          />
        </div>
        <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} />

        <main className="book-main">
          {section === 'chapters' && activeChapter && (
            renderChapter ? (
              renderChapter({ book, chapter: activeChapter, onChanged: reload, extensions })
            ) : (
              <p className="book-message muted">{activeChapter.title}</p>
            )
          )}
          {section === 'chapters' && !activeChapter && chapters.length === 0 && (
            <div className="book-message">
              <p className="muted">Dieses Buch hat noch keine Kapitel.</p>
              <button className="primary" onClick={() => void handleCreate()}>
                Erstes Kapitel anlegen
              </button>
            </div>
          )}
          {section === 'wiki' && activeEntry && (
            <div className="book-scroll">
              <WikiEntryEditor
                key={activeEntry.id}
                entryId={activeEntry.id}
                folders={folders}
                zoomArea="wiki"
                onChanged={reloadWiki}
                onSaveFailed={() => setActionError(true)}
                onDeleted={() => {
                  navigate(`/book/${book.id}/wiki`, { replace: true })
                  void reloadWiki()
                }}
              />
            </div>
          )}
          {section === 'wiki' && !activeEntry && (
            <div className="book-message">
              <p className="muted">
                {entries.length === 0
                  ? 'Das Wiki ist noch leer. Lege Personen, Orte oder Begriffe an; ihre Namen werden im Text automatisch verlinkt.'
                  : 'Wähle einen Eintrag aus der Liste.'}
              </p>
              {entries.length === 0 && (
                <button className="primary" onClick={() => void handleCreateEntry(null)}>
                  Ersten Eintrag anlegen
                </button>
              )}
            </div>
          )}
          {section === 'outline' && (
            <div className="book-scroll">
              <Outline
                book={book}
                chapters={chapters}
                onChanged={reload}
                onError={() => setActionError(true)}
                onCreateChapter={() => void handleCreate(false)}
              />
            </div>
          )}
        </main>

        {panelEntry && (
          <aside className="book-panel" aria-label="Wiki-Eintrag">
            <header className="book-panel-header">
              <Link to={`/book/${book.id}/wiki/${panelEntry.id}`} className="book-panel-open">
                Im Wiki öffnen
              </Link>
              <button className="ghost" onClick={() => setPanelEntryId(null)}>
                Schließen
              </button>
            </header>
            <div className="book-panel-body">
              <WikiEntryEditor
                key={panelEntry.id}
                entryId={panelEntry.id}
                folders={folders}
                zoomArea="panel"
                onChanged={reloadWiki}
                onSaveFailed={() => setActionError(true)}
                onDeleted={() => {
                  setPanelEntryId(null)
                  void reloadWiki()
                }}
              />
            </div>
          </aside>
        )}
      </div>

      {dialog?.kind === 'rename' && (
        <PromptDialog
          heading="Kapitel umbenennen"
          initialValue={dialog.chapter.title}
          confirmLabel="Speichern"
          onCancel={() => setDialog(null)}
          onConfirm={(title) => handleRename(dialog.chapter, title)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          message={`Kapitel „${dialog.chapter.title}" wirklich löschen?`}
          confirmLabel="Endgültig löschen"
          onCancel={() => setDialog(null)}
          onConfirm={() => handleDelete(dialog.chapter)}
        />
      )}
      {dialog?.kind === 'newFolder' && (
        <PromptDialog
          heading="Neuer Ordner"
          confirmLabel="Anlegen"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => handleCreateFolder(dialog.parentId, name)}
        />
      )}
      {dialog?.kind === 'renameFolder' && (
        <PromptDialog
          heading="Ordner umbenennen"
          initialValue={dialog.folder.name}
          confirmLabel="Speichern"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => handleRenameFolder(dialog.folder, name)}
        />
      )}
      {dialog?.kind === 'deleteFolder' && (
        <ConfirmDialog
          message={`Ordner „${dialog.folder.name}" wirklich löschen?`}
          detail="Die Einträge darin bleiben erhalten."
          confirmLabel="Ordner löschen"
          onCancel={() => setDialog(null)}
          onConfirm={() => handleDeleteFolder(dialog.folder)}
        />
      )}
    </div>
  )
}
