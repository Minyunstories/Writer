import type { Extension } from '@codemirror/state'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
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
import type { JumpTarget } from '../editor/Editor'
import { wikiCompletion } from '../editor/wikiComplete'
import { ConfirmDialog, PromptDialog } from '../ui/Dialogs'
import { buildMatcher } from '../wiki/linker'
import { WikiEntryEditor } from '../wiki/WikiEntryEditor'
import { createWikiLinks } from '../wiki/wikiLinks'
import { WikiSidebar } from '../wiki/WikiSidebar'
import { Sidebar, type Section } from './Sidebar'
import { FEATHER } from '../dashboard/Dashboard'
import { highlightOf } from '../lib/bookStyle'
import './book.css'

export interface ChapterRenderProps {
  book: Book
  chapter: Chapter
  /** Call after the book or chapter was changed so lists and titles refresh. */
  onChanged: () => void
  /** Editor extensions provided by the book view, e.g. wiki links. */
  extensions: Extension[]
  /** Where to jump in this chapter, e.g. from "Erwähnt in". */
  jumpTo?: JumpTarget
  /** Call once the jump happened, so a later visit to the chapter does not jump again. */
  onJumped: () => void
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

/** A mouse or trackpad: focusing the text does not open an on-screen keyboard. */
function canHover(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches
}

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
  /** Entries opened in the panel; the last one is shown, "Zurück" goes one step back. */
  const [panelStack, setPanelStack] = useState<string[]>([])
  const panelEntryId = panelStack[panelStack.length - 1] ?? null
  const [jump, setJump] = useState<(JumpTarget & { chapterId: string }) | null>(null)
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
    setPanelStack([])
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

  /** Opens an entry in the panel as a fresh start, e.g. from the chapter text or the outline. */
  const openPanel = useCallback(
    (entryId: string) => {
      setPanelStack([entryId])
      // Chapters may have changed since they were loaded; "Erwähnt in" should be current.
      void reload()
    },
    [reload],
  )
  const pushPanel = (entryId: string) => setPanelStack((stack) => (stack[stack.length - 1] === entryId ? stack : [...stack, entryId]))

  // Latest lists for the editor extensions, which are created once per book.
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const foldersRef = useRef(folders)
  foldersRef.current = folders
  const openPanelRef = useRef(openPanel)
  openPanelRef.current = openPanel

  // Names in the chapter text link to their wiki entry; a click opens the panel.
  const links = useMemo(
    () => createWikiLinks({ onOpen: (entryId) => openPanelRef.current(entryId) }),
    // One instance per book.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookId],
  )
  const extensions = useMemo(
    () => [
      links.extension,
      wikiCompletion({
        entries: () => entriesRef.current,
        topFolders: () => foldersRef.current.filter((folder) => !folder.parentId),
        create: async (name, folderId) => {
          try {
            await createEntry(bookId, name, folderId)
          } catch {
            setActionError(true)
          }
          await reloadWiki()
        },
      }),
    ],
    // One set per book; the lists are read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [links, bookId],
  )
  useEffect(() => {
    links.setMatcher(buildMatcher(entries))
  }, [links, entries])

  const activeChapter = section === 'chapters' ? chapters.find((c) => c.id === itemId) : undefined

  // Keep the URL pointing at an existing chapter. Opening the book itself continues where text
  // was last changed; the chapter list and links open what they point at.
  useEffect(() => {
    if (!book || section !== 'chapters' || activeChapter) return
    const place = rawSection === undefined ? book.place : undefined
    if (place && chapters.some((chapter) => chapter.id === place.chapterId)) {
      setJump({ chapterId: place.chapterId, from: place.offset, to: place.offset, key: Date.now(), focus: canHover() })
      navigate(`/book/${book.id}/chapters/${place.chapterId}`, { replace: true })
    } else if (chapters.length > 0) {
      navigate(`/book/${book.id}/chapters/${chapters[0].id}`, { replace: true })
    } else if (itemId) {
      navigate(`/book/${book.id}/chapters`, { replace: true })
    }
  }, [book, section, rawSection, activeChapter, chapters, itemId, navigate])

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
      // The list must know the chapter first, or the URL is "corrected" to the first chapter.
      setChapters(await listChapters(book.id))
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
  const panelEntry = section !== 'wiki' ? entries.find((entry) => entry.id === panelEntryId) : undefined

  /** Opens a chapter and marks a place in it. */
  const openChapterAt = (chapterId: string, range: { from: number; to: number }) => {
    if (!book) return
    setJump({ chapterId, ...range, key: Date.now() })
    navigate(`/book/${book.id}/chapters/${chapterId}`)
    closeSidebarOnPhone()
    // On a phone the panel covers the text: close it so the place is visible.
    if (isNarrow()) setPanelStack([])
  }

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
    <div
      className={`book book-view${sidebarOpen ? ' sidebar-open' : ''}`}
      // The book's highlight colour for every text field inside.
      style={{ '--mw-highlight': highlightOf(book) } as CSSProperties}
    >
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
        <img className="book-logo" src={FEATHER} alt="" />
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
              renderChapter({
                book,
                chapter: activeChapter,
                onChanged: reload,
                extensions,
                jumpTo: jump?.chapterId === activeChapter.id ? jump : undefined,
                onJumped: () => setJump(null),
              })
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
                entries={entries}
                chapters={chapters}
                zoomArea="wiki"
                onOpenEntry={(entryId) => navigate(`/book/${book.id}/wiki/${entryId}`)}
                onOpenChapter={openChapterAt}
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
                entries={entries}
                folders={folders}
                onOpenEntry={openPanel}
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
              <span className="book-panel-actions">
                {panelStack.length > 1 && (
                  <button className="ghost" onClick={() => setPanelStack((stack) => stack.slice(0, -1))}>
                    Zurück
                  </button>
                )}
                <button className="ghost" onClick={() => setPanelStack([])}>
                  Schließen
                </button>
              </span>
            </header>
            <div className="book-panel-body">
              <WikiEntryEditor
                key={panelEntry.id}
                entryId={panelEntry.id}
                folders={folders}
                entries={entries}
                chapters={chapters}
                zoomArea="panel"
                onOpenEntry={pushPanel}
                onOpenChapter={openChapterAt}
                onChanged={reloadWiki}
                onSaveFailed={() => setActionError(true)}
                onDeleted={() => {
                  setPanelStack((stack) => stack.filter((id) => id !== panelEntry.id))
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
