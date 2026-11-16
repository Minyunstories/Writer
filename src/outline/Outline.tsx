import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ZoomControl } from '../book/ZoomControl'
import { MAX_DATE_LENGTH } from '../lib/bookStyle'
import { useAutosave } from '../lib/useAutosave'
import { countWords, formatWordCount } from '../lib/wordCount'
import { useZoom } from '../lib/zoom'
import { SYNCED_EVENT } from '../storage/connection'
import { changeChapterTags, ConflictError, getChapter, moveChapter, setChapterDate, updateChapter } from '../storage/db'
import type { Book, Chapter, WikiEntry, WikiFolder } from '../types'
import { buildMatcher, type Matcher } from '../wiki/linker'
import { MarkdownField } from '../wiki/MarkdownField'
import { entriesIn, groupByTopFolder } from '../wiki/mentions'
import { Tags } from './Tags'
import './outline.css'

interface Props {
  book: Book
  chapters: Chapter[]
  /** Called after the chapter order changed. */
  onChanged: () => void | Promise<void>
  /** Called when something could not be stored. */
  onError: () => void
  onCreateChapter: () => void
  /** Wiki entries and folders, for the list of entries each chapter mentions. */
  entries?: WikiEntry[]
  folders?: WikiFolder[]
  onOpenEntry?: (entryId: string) => void
}

interface CardProps {
  book: Book
  chapter: Chapter
  index: number
  count: number
  dragging: boolean
  /** True while any card is being dragged. */
  reordering: boolean
  /** True while a move is being stored; further moves wait. */
  busy: boolean
  onMove: (direction: 'up' | 'down') => void
  onDragStart: () => void
  onDragEnd: () => void
  onDropHere: () => void
  onError: () => void
  tagSuggestions: string[]
  onTagsChange: (change: { add: string } | { remove: string }) => void
  onFilter: (tag: string) => void
  matcher: Matcher
  entries: WikiEntry[]
  folders: WikiFolder[]
  onOpenEntry?: (entryId: string) => void
}

/** The free-text date left of a chapter on the timeline, saved while typing, and its dot on the rail. */
function DateField({ chapter, onError }: { chapter: Chapter; onError: () => void }) {
  const [value, setValue] = useState(chapter.date ?? '')
  /** What is in the field and not yet stored. */
  const typed = useRef<string | null>(null)

  const { change } = useAutosave<{ date: string }>(
    async (patch) => {
      if (patch.date === undefined) return
      await setChapterDate(chapter.id, patch.date)
      if (typed.current === patch.date) typed.current = null
    },
    { onFailedAfterClose: onError },
  )

  // Pick up a date changed elsewhere (another tab, a sync run) unless one is being typed.
  useEffect(() => {
    const refresh = async () => {
      if (typed.current !== null) return
      try {
        const stored = await getChapter(chapter.id)
        if (stored && typed.current === null) setValue(stored.date ?? '')
      } catch {
        // Not reachable right now.
      }
    }
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener(SYNCED_EVENT, onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(SYNCED_EVENT, onFocus)
    }
  }, [chapter.id])

  useEffect(() => {
    if (typed.current === null) setValue(chapter.date ?? '')
  }, [chapter.date])

  return (
    <>
      <div className="outline-date">
        {/* A text area, so a long date wraps in the narrow phone column; Enter finishes it. */}
        <textarea
          rows={1}
          className={value.trim() ? 'filled' : ''}
          value={value}
          maxLength={MAX_DATE_LENGTH}
          placeholder="Datum"
          aria-label={`Datum für ${chapter.title}`}
          enterKeyHint="done"
          onChange={(event) => {
            // Pasted line breaks become spaces: a date is one line.
            const next = event.target.value.replace(/\n/g, ' ')
            typed.current = next
            setValue(next)
            change({ date: next })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
        />
      </div>
      <div className="outline-rail" aria-hidden="true">
        <span className={`outline-dot${value.trim() ? ' filled' : ''}`} />
      </div>
    </>
  )
}

function OutlineCard({
  book,
  chapter,
  index,
  count,
  dragging,
  reordering,
  busy,
  onMove,
  onDragStart,
  onDragEnd,
  onDropHere,
  onError,
  tagSuggestions,
  onTagsChange,
  onFilter,
  matcher,
  entries,
  folders,
  onOpenEntry,
}: CardProps) {
  const [over, setOver] = useState(false)
  // The note is read from storage, not from the chapter list, which may be outdated.
  const [loaded, setLoaded] = useState<{ text: string; version: number } | null>(null)
  const [conflict, setConflict] = useState(false)
  const conflictRef = useRef(false)
  /** The note as storage last had it, as far as this card knows. */
  const expected = useRef(chapter.outline ?? '')
  /** The text currently in the field. */
  const mine = useRef<string | null>(null)
  const dirty = useRef(false)

  const load = useCallback(async () => {
    let text = chapter.outline ?? ''
    try {
      const stored = await getChapter(chapter.id)
      if (stored) text = stored.outline ?? ''
    } catch {
      // Fall back to what the list had.
    }
    expected.current = text
    mine.current = text
    dirty.current = false
    setLoaded((current) => ({ text, version: (current?.version ?? 0) + 1 }))
    // Loading is tied to the chapter, not to each new chapter object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id])

  useEffect(() => {
    void load()
  }, [load])

  const { change, failed } = useAutosave<{ outline: string }>(
    async (patch) => {
      if (conflictRef.current || patch.outline === undefined) return
      try {
        await updateChapter(chapter.id, patch, { expectedOutline: expected.current })
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error
        // Someone else changed the note. Keep both and let the writer decide.
        conflictRef.current = true
        setConflict(true)
        return
      }
      expected.current = patch.outline
      if (mine.current === patch.outline) dirty.current = false
    },
    { onFailedAfterClose: onError },
  )

  // Pick up a note changed in another tab, as long as nothing is being typed here.
  useEffect(() => {
    const refresh = async () => {
      if (dirty.current || conflictRef.current) return
      try {
        const stored = await getChapter(chapter.id)
        if (stored && (stored.outline ?? '') !== expected.current && !dirty.current) await load()
      } catch {
        // Not reachable right now; the next save reports real problems.
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    window.addEventListener(SYNCED_EVENT, onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(SYNCED_EVENT, onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [chapter.id, load])

  const keepMine = async () => {
    const text = mine.current ?? ''
    try {
      await updateChapter(chapter.id, { outline: text })
      expected.current = text
      if (mine.current === text) dirty.current = false
      conflictRef.current = false
      setConflict(false)
      // Anything typed while the question was open is saved normally now.
      if (mine.current !== text) change({ outline: mine.current ?? '' })
    } catch {
      onError()
    }
  }

  const loadOther = async () => {
    conflictRef.current = false
    setConflict(false)
    await load()
  }

  const mentionGroups = useMemo(
    () => groupByTopFolder(entriesIn(chapter, matcher), entries, folders),
    [chapter, matcher, entries, folders],
  )

  return (
    <li
      id={`outline-${chapter.id}`}
      className={`outline-row${dragging ? ' dragging' : ''}${over ? ' drop-target' : ''}`}
      // Capture phase: while a card is dragged, the note field inside must not
      // treat the drop as text to insert.
      onDragOverCapture={(event) => {
        if (!reordering) return
        event.preventDefault()
        event.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDropCapture={(event) => {
        if (!reordering) return
        event.preventDefault()
        event.stopPropagation()
        setOver(false)
        onDropHere()
      }}
    >
      <DateField chapter={chapter} onError={onError} />
      <div className="outline-card">
        <header className="outline-card-header">
          <span
            className="outline-handle"
            draggable={!busy}
            title="Ziehen zum Umsortieren"
            aria-hidden="true"
            onDragStart={(event) => {
              // A private type: nothing that accepts text will take it.
              event.dataTransfer?.setData('application/x-minyunwriter-chapter', chapter.id)
              if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
              onDragStart()
            }}
            onDragEnd={onDragEnd}
          >
            ⠿
          </span>
          <span className="outline-number">{index + 1}</span>
          <Link to={`/book/${book.id}/chapters/${chapter.id}`} className="outline-title">
            {chapter.title}
          </Link>
          <span className="outline-words muted">{formatWordCount(countWords(chapter.content))}</span>
          <button
            className="ghost icon"
            aria-label={`${chapter.title} nach oben`}
            title="Nach oben"
            disabled={busy || index === 0}
            onClick={() => onMove('up')}
          >
            ↑
          </button>
          <button
            className="ghost icon"
            aria-label={`${chapter.title} nach unten`}
            title="Nach unten"
            disabled={busy || index === count - 1}
            onClick={() => onMove('down')}
          >
            ↓
          </button>
        </header>
        <Tags tags={chapter.tags ?? []} suggestions={tagSuggestions} onChange={onTagsChange} onFilter={onFilter} />
        {mentionGroups.length > 0 && (
          <div className="outline-mentions">
            {mentionGroups.map((group) => {
              const label = group.folder?.name ?? 'Weitere'
              return (
                <div key={group.folder?.id ?? 'none'} role="group" aria-label={label} className="outline-mentions-group">
                  <span className="outline-mentions-folder" aria-hidden="true">
                    {label}
                  </span>
                  {group.entries.map((entry) => (
                    <button key={entry.id} className="outline-mention" onClick={() => onOpenEntry?.(entry.id)}>
                      {entry.name}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
        {failed && !conflict && (
          <p className="status-error" role="alert">
            Speichern fehlgeschlagen, neuer Versuch läuft.
          </p>
        )}
        {conflict && (
          <div className="outline-conflict" role="alertdialog" aria-label="Notiz wurde an anderer Stelle geändert">
            <p>
              <strong>Diese Notiz wurde an anderer Stelle geändert.</strong>
            </p>
            <p className="muted">Deine Fassung hier ist noch nicht gespeichert. Es wird nichts überschrieben.</p>
            <div className="outline-conflict-actions">
              <button onClick={() => void keepMine()}>Meine Fassung behalten</button>
              <button onClick={() => void loadOther()}>Andere Fassung laden</button>
            </div>
          </div>
        )}
        {loaded && (
          // The field takes its text once per load; list reloads never reset what is being typed.
          <MarkdownField
            key={loaded.version}
            value={loaded.text}
            ariaLabel={`Notizen zu ${chapter.title}`}
            placeholder="Was passiert hier? Wetter, Ort, Stimmung …"
            onChange={(outline) => {
              mine.current = outline
              dirty.current = true
              change({ outline })
            }}
          />
        )}
      </div>
    </li>
  )
}

export function Outline({ book, chapters, onChanged, onError, onCreateChapter, entries = [], folders = [], onOpenEntry }: Props) {
  const [zoom] = useZoom('outline')
  const [dragId, setDragId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const matcher = useMemo(() => buildMatcher(entries), [entries])
  const allTags = useMemo(
    () => [...new Set(chapters.flatMap((chapter) => chapter.tags ?? []))].sort((a, b) => a.localeCompare(b, 'de')),
    [chapters],
  )
  const visible = filter ? chapters.filter((chapter) => chapter.tags?.includes(filter)) : chapters

  const setTags = async (chapterId: string, change: { add: string } | { remove: string }) => {
    try {
      await changeChapterTags(chapterId, change)
    } catch {
      onError()
    }
    await onChanged()
  }

  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  /** Moves a chapter next to another one. One move at a time; the order is rebuilt from storage. */
  const move = async (chapterId: string, target: { before: string } | { after: string }) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await moveChapter(book.id, chapterId, target)
    } catch {
      onError()
    }
    try {
      await onChanged()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const step = (index: number, direction: 'up' | 'down') => {
    const neighbour = chapters[direction === 'up' ? index - 1 : index + 1]
    if (!neighbour) return
    void move(chapters[index].id, direction === 'up' ? { before: neighbour.id } : { after: neighbour.id })
  }

  const dropOn = (index: number) => {
    const from = chapters.findIndex((chapter) => chapter.id === dragId)
    if (dragId && from >= 0 && from !== index) {
      void move(dragId, from > index ? { before: chapters[index].id } : { after: chapters[index].id })
    }
    setDragId(null)
  }

  return (
    <div className="outline" style={{ fontSize: `calc(15px * ${zoom / 100})` }}>
      <header className="outline-header">
        <h2>Outline</h2>
        <ZoomControl area="outline" />
      </header>

      {filter && (
        <div className="outline-filter">
          <span>Filter: {filter}</span>
          <button className="ghost" aria-label="Filter aufheben" onClick={() => setFilter(null)}>
            ×
          </button>
        </div>
      )}

      {chapters.length === 0 ? (
        <div className="outline-empty">
          <p className="muted">Noch keine Kapitel</p>
          <button className="primary" onClick={onCreateChapter}>
            Erstes Kapitel anlegen
          </button>
        </div>
      ) : (
        <ol className="outline-list">
          {visible.map((chapter) => {
            const index = chapters.indexOf(chapter)
            return (
              <OutlineCard
                key={chapter.id}
                book={book}
                chapter={chapter}
                index={index}
                count={chapters.length}
                dragging={dragId === chapter.id}
                reordering={dragId !== null}
                // While filtered, neighbours on screen are not neighbours in the book: no moving.
                busy={busy || filter !== null}
                onMove={(direction) => step(index, direction)}
                onDragStart={() => setDragId(chapter.id)}
                onDragEnd={() => setDragId(null)}
                onDropHere={() => dropOn(index)}
                onError={onError}
                tagSuggestions={allTags}
                onTagsChange={(change) => void setTags(chapter.id, change)}
                onFilter={setFilter}
                matcher={matcher}
                entries={entries}
                folders={folders}
                onOpenEntry={onOpenEntry}
              />
            )
          })}
        </ol>
      )}

      {chapters.length > 0 && (
        <button className="outline-add" onClick={onCreateChapter}>
          Neues Kapitel
        </button>
      )}
    </div>
  )
}
