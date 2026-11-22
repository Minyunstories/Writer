import { useMemo, useState, type ReactNode } from 'react'
import type { Collection, CollectionItem } from '../types'
import { inlineMarkdown } from './inlineMarkdown'
import './collection.css'

interface Props {
  collection: Collection
  /** Tabs to switch between notepad and collection. */
  tabs?: ReactNode
  onInsert: (text: string) => void
  onAddSelection: () => void
  onDelete: (id: string) => void
  /** Deletes every entry of a category (after asking in its heading). */
  onDeleteCategory?: (category: string) => void
  onImport: (source: string) => Promise<{ added: number; known: number } | null>
  onOpenSource: (source: NonNullable<CollectionItem['source']>) => void
  onClose: () => void
}

const GUIDE_KEY = 'mw:collection-guide-open'
const readGuideOpen = () => {
  try {
    return localStorage.getItem(GUIDE_KEY) !== 'false'
  } catch {
    return true
  }
}

/** Categories in order of their first item, each with its groups (items without group first). */
function arrange(items: CollectionItem[]) {
  const categories = new Map<string, Map<string, CollectionItem[]>>()
  for (const item of items) {
    const groups = categories.get(item.category) ?? new Map<string, CollectionItem[]>()
    categories.set(item.category, groups)
    const key = item.group ?? ''
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...categories].sort(([a], [b]) => a.localeCompare(b, 'de', { numeric: true }))
}

/** Phrases, beats and words shared by all books: put in at the cursor or copied. */
export function CollectionPanel({ collection, tabs, onInsert, onAddSelection, onDelete, onDeleteCategory, onImport, onOpenSource, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [guideOpen, setGuideOpen] = useState(readGuideOpen)
  const [report, setReport] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [asking, setAsking] = useState<string | null>(null)

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase()
    const items = words
      ? collection.items.filter((item) =>
          [item.text, item.category, item.group ?? '', item.note ?? '', ...(item.tags ?? [])].some((field) => field.toLowerCase().includes(words)),
        )
      : collection.items
    return arrange(items)
  }, [collection.items, query])

  const toggleGuide = () => {
    setGuideOpen((open) => {
      try {
        localStorage.setItem(GUIDE_KEY, String(!open))
      } catch {
        // Only a convenience.
      }
      return !open
    })
  }

  const copy = (item: CollectionItem) => {
    void navigator.clipboard?.writeText(item.text).then(
      () => setCopied(item.id),
      () => setCopied(null),
    )
  }

  const importFile = async (file: File | undefined) => {
    if (!file) return
    const result = await onImport(await file.text())
    setReport(result ? `${result.added} neu, ${result.known} schon vorhanden.` : 'Diese Datei ist kein Katalog, den Writer lesen kann.')
  }

  // The question always counts the whole category, not only what the search shows.
  const sizeOf = (category: string) => collection.items.filter((item) => item.category === category).length

  const guide = collection.guide
  return (
    <aside className="book-panel notes-panel collection-panel" aria-label="Sammlung">
      <header className="book-panel-header">
        {tabs ?? <span className="notes-title">Sammlung</span>}
        <button className="ghost icon panel-close" aria-label="Schließen" title="Schließen" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="book-panel-body notes-body">
        <div className="collection-tools">
          <input
            type="search"
            className="collection-search"
            aria-label="Sammlung durchsuchen"
            placeholder="Suchen …"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button onClick={onAddSelection} title="Markierten Text aufnehmen (Strg+Umschalt+K)">
            + Aus dem Text
          </button>
          <label className="collection-import ghost" title="Den Reaction-Beat-Katalog (HTML-Datei) einlesen; Doppeltes wird übersprungen">
            Katalog importieren
            <input type="file" accept=".html,.htm,.json,text/html,application/json" onChange={(event) => void importFile(event.target.files?.[0])} />
          </label>
        </div>
        {report && (
          <p className="muted collection-report" role="status">
            {report}
          </p>
        )}

        {guide && (
          <section className="collection-guide">
            <button className="ghost collection-guide-toggle" aria-expanded={guideOpen} onClick={toggleGuide}>
              {guideOpen ? '▾' : '▸'} {guide.title}: Regeln & Selbstcheck
            </button>
            {guideOpen && (
              <div className="collection-guide-body">
                {guide.rules.length > 0 && (
                  <ol>
                    {guide.rules.map((rule, index) => (
                      <li key={index}>{inlineMarkdown(rule)}</li>
                    ))}
                  </ol>
                )}
                {guide.selfcheck.length > 0 && (
                  <>
                    <p className="collection-guide-heading">Selbstcheck</p>
                    <ul>
                      {guide.selfcheck.map((question, index) => (
                        <li key={index}>{inlineMarkdown(question)}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
          </section>
        )}

        {collection.items.length === 0 ? (
          <p className="muted notes-empty">
            Noch leer. Markiere Text im Kapitel und drücke Strg+Umschalt+K, oder importiere den Katalog. Im Text holt „//Suchwort“ Einträge hervor.
          </p>
        ) : shown.length === 0 ? (
          <p className="muted notes-empty">Nichts gefunden.</p>
        ) : (
          shown.map(([category, groups]) => (
            <section key={category} className="collection-category">
              <div className="collection-category-head">
                <h3>{category}</h3>
                {onDeleteCategory &&
                  (asking === category ? (
                    <div className="collection-category-asking">
                      <span className="collection-category-question">
                        {sizeOf(category) === 1 ? 'Den einen Eintrag löschen?' : `Alle ${sizeOf(category)} Einträge löschen?`}
                      </span>
                      <span className="collection-category-choices">
                        <button type="button" className="ghost" onClick={() => setAsking(null)} autoFocus>
                          Abbrechen
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            setAsking(null)
                            onDeleteCategory(category)
                          }}
                        >
                          Ja, löschen
                        </button>
                      </span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="ghost collection-category-delete"
                      aria-label={`Bereich „${category}“ löschen`}
                      onClick={() => setAsking(category)}
                    >
                      Bereich löschen
                    </button>
                  ))}
              </div>
              {guide?.notes?.[category] && <p className="muted collection-category-note">{guide.notes[category]}</p>}
              {[...groups].map(([group, items]) => (
                <div key={group} className="collection-group">
                  {group && <p className="collection-group-label">{group}</p>}
                  <ul className="collection-items">
                    {items.map((item) => (
                      <li key={item.id} className="collection-item">
                        <button className="collection-item-text" title="An der Cursorposition einfügen" onClick={() => onInsert(item.text)}>
                          {item.text}
                        </button>
                        <span className="collection-item-actions">
                          <button className="ghost" aria-label="Kopieren" title="Kopieren" onClick={() => copy(item)}>
                            {copied === item.id ? '✓' : '⧉'}
                          </button>
                          <button className="ghost" aria-label="Aus der Sammlung löschen" title="Löschen" onClick={() => onDelete(item.id)}>
                            ×
                          </button>
                        </span>
                        {item.note && <p className="muted collection-item-note">{item.note}</p>}
                        {item.source && (
                          <button className="note-origin" onClick={() => onOpenSource(item.source!)}>
                            aus: {item.source.bookTitle || 'Buch'}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
    </aside>
  )
}
