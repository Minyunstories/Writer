import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { WikiEntry, WikiFolder } from '../types'
import { orderedChildren } from './order'
import './wiki.css'

interface Props {
  bookId: string
  folders: WikiFolder[]
  entries: WikiEntry[]
  order?: Record<string, string[]>
  onCreateEntry: (folderId: string | null) => void
}

const RECENT = 5
const timeFormat = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** The wiki's start page: last edited entries, a search and every folder with its contents. */
export function WikiHome({ bookId, folders, entries, order, onCreateEntry }: Props) {
  const [query, setQuery] = useState('')
  const byId = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])

  /** The top-level folder an item belongs to, for its colour and label. */
  const topOf = (folderId: string | null): WikiFolder | undefined => {
    let folder = folderId ? byId.get(folderId) : undefined
    for (let guard = 0; folder?.parentId && byId.has(folder.parentId) && guard < 20; guard++) folder = byId.get(folder.parentId)
    return folder
  }
  const tint = (folder?: WikiFolder) => (folder?.color ? ({ '--folder': folder.color } as CSSProperties) : undefined)
  const link = (entry: WikiEntry, extra?: ReactNode) => (
    <Link to={`/book/${bookId}/wiki/${entry.id}`} className="wiki-home-entry">
      <span className="wiki-home-entry-name">{entry.name}</span>
      {extra}
    </Link>
  )
  const where = (entry: WikiEntry) => {
    const folder = entry.folderId ? byId.get(entry.folderId) : undefined
    return <span className="wiki-home-meta">{folder?.name ?? 'Ohne Ordner'}</span>
  }

  const recent = [...entries].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, RECENT)
  const needle = query.trim().toLocaleLowerCase('de')
  const found = needle
    ? entries.filter(
        (entry) =>
          entry.name.toLocaleLowerCase('de').includes(needle) ||
          entry.aliases.some((alias) => alias.toLocaleLowerCase('de').includes(needle)),
      )
    : []

  const renderFolder = (folder: WikiFolder): ReactNode => {
    const kids = orderedChildren(folder.id, folders, entries, order)
    return (
      <div key={folder.id} className="wiki-home-sub">
        <h4>{folder.name}</h4>
        <ul>
          {kids.entries.map((entry) => (
            <li key={entry.id}>{link(entry)}</li>
          ))}
        </ul>
        {kids.folders.map(renderFolder)}
      </div>
    )
  }

  const root = orderedChildren(null, folders, entries, order)

  return (
    <div className="wiki-home">
      <h2>Wiki</h2>
      <input
        type="search"
        className="wiki-home-search"
        aria-label="Wiki durchsuchen"
        placeholder="Wiki durchsuchen …"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      {needle ? (
        found.length > 0 ? (
          <ul className="wiki-home-results" aria-label="Suchergebnisse">
            {found.map((entry) => (
              <li key={entry.id} style={tint(topOf(entry.folderId))}>
                {link(entry, where(entry))}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nichts gefunden.</p>
        )
      ) : (
        <>
          {recent.length > 0 && (
            <section className="wiki-home-section">
              <h3 id="wiki-home-recent">Zuletzt bearbeitet</h3>
              <ul className="wiki-home-recent" aria-labelledby="wiki-home-recent">
                {recent.map((entry) => (
                  <li key={entry.id} style={tint(topOf(entry.folderId))}>
                    {link(
                      entry,
                      <span className="wiki-home-meta">
                        {(entry.folderId && byId.get(entry.folderId)?.name) || 'Ohne Ordner'} · {timeFormat.format(entry.updatedAt)}
                      </span>,
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="wiki-home-folders">
            {root.folders.map((folder) => {
              const kids = orderedChildren(folder.id, folders, entries, order)
              return (
                <section
                  key={folder.id}
                  className={`wiki-home-folder${folder.color ? ' coloured' : ''}`}
                  style={tint(folder)}
                  aria-labelledby={`wiki-home-${folder.id}`}
                >
                  <header>
                    <h3 id={`wiki-home-${folder.id}`}>{folder.name}</h3>
                    <button
                      className="ghost icon"
                      aria-label={`Eintrag in „${folder.name}" anlegen`}
                      title="Neuer Eintrag in diesem Ordner"
                      onClick={() => onCreateEntry(folder.id)}
                    >
                      +
                    </button>
                  </header>
                  <ul>
                    {kids.entries.map((entry) => (
                      <li key={entry.id}>{link(entry)}</li>
                    ))}
                  </ul>
                  {kids.folders.map(renderFolder)}
                  {kids.entries.length === 0 && kids.folders.length === 0 && <p className="muted">Noch leer</p>}
                </section>
              )
            })}
            {root.entries.length > 0 && (
              <section className="wiki-home-folder" aria-labelledby="wiki-home-loose">
                <header>
                  <h3 id="wiki-home-loose">Ohne Ordner</h3>
                </header>
                <ul>
                  {root.entries.map((entry) => (
                    <li key={entry.id}>{link(entry)}</li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  )
}
