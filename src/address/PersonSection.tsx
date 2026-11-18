import { useState } from 'react'
import { isModuleOn } from '../modules/modules'
import { setPerson } from '../storage/address'
import type { AddressPersonChange, Book, Chapter, WikiEntry, WikiFolder } from '../types'
import { AddressHead, AddressRow } from './AddressRow'
import { figuresOf, involved } from './resolve'
import './address.css'

interface Props {
  book: Book
  entry: WikiEntry
  entries: WikiEntry[]
  folders: WikiFolder[]
  chapters: Chapter[]
  /** The chapter open beside the panel; null in the wiki. */
  chapterId: string | null
  onChanged: () => void
}

type ChangeDraft = { chapterId: string; rankId: string; first: string; last: string }

/** The address section of a figure's wiki entry: rank, names, changes, and who addresses whom how. */
export function PersonSection({ book, entry, entries, folders, chapters, chapterId, onChanged }: Props) {
  const [editing, setEditing] = useState<{ from: string; to: string } | null>(null)
  const [adding, setAdding] = useState<ChangeDraft | null>(null)
  const [failed, setFailed] = useState(false)
  if (!isModuleOn(book, 'address')) return null
  const address = book.address
  const figures = figuresOf(address, entries, folders)
  if (!figures.some((figure) => figure.id === entry.id)) return null

  const order = chapters.map((chapter) => chapter.id)
  const ranks = address?.ranks ?? []
  const person = address?.people.find((item) => item.entryId === entry.id)
  const words = entry.name.trim().split(/\s+/)
  const titleOf = (id: string) => chapters.find((chapter) => chapter.id === id)?.title
  const others = figures.filter((figure) => figure.id !== entry.id && involved(address, figure.id))

  const attempt = async (action: () => Promise<void>) => {
    setFailed(false)
    try {
      await action()
    } catch {
      setFailed(true)
    }
    onChanged()
  }
  const savePerson = (patch: Parameters<typeof setPerson>[2]) => attempt(() => setPerson(book.id, entry.id, patch, order))
  const saveChanges = (changes: (Omit<AddressPersonChange, 'id'> & { id?: string })[]) => savePerson({ changes })
  const changes = person?.changes ?? []
  const updateChange = (id: string, patch: Partial<AddressPersonChange>) => saveChanges(changes.map((change) => (change.id === id ? { ...change, ...patch } : change)))
  const done = (changed: boolean) => {
    setEditing(null)
    if (changed) onChanged()
  }
  const isEditing = (from: string, to: string) => editing?.from === from && editing.to === to

  const rankOptions = (
    <>
      {ranks.map((rank) => (
        <option key={rank.id} value={rank.id}>
          {rank.name}
        </option>
      ))}
    </>
  )
  const chapterOptions = (current?: string) => (
    <>
      {current && !titleOf(current) && <option value={current}>Kapitel gelöscht</option>}
      {chapters.map((chapter) => (
        <option key={chapter.id} value={chapter.id}>
          {chapter.title}
        </option>
      ))}
    </>
  )

  return (
    <section className="wiki-field address-section" aria-label="Anreden">
      <span className="wiki-label">Anreden</span>
      <div className="address-person">
        <label className="address-field">
          Rang
          <select value={person?.rankId && ranks.some((rank) => rank.id === person.rankId) ? person.rankId : ''} onChange={(event) => void savePerson({ rankId: event.target.value || null })}>
            <option value="">Kein Rang</option>
            {rankOptions}
          </select>
        </label>
        <label className="address-field">
          Vorname
          <input
            key={`first-${entry.id}-${person?.first ?? ''}`}
            defaultValue={person?.first ?? ''}
            placeholder={words[0]}
            onBlur={(event) => event.target.value.trim() !== (person?.first ?? '') && void savePerson({ first: event.target.value })}
          />
        </label>
        <label className="address-field">
          Nachname
          <input
            key={`last-${entry.id}-${person?.last ?? ''}`}
            defaultValue={person?.last ?? ''}
            placeholder={words[words.length - 1]}
            onBlur={(event) => event.target.value.trim() !== (person?.last ?? '') && void savePerson({ last: event.target.value })}
          />
        </label>
      </div>

      {(changes.length > 0 || adding) && <span className="address-sub">Änderungen</span>}
      {changes.map((change) => (
        <div key={change.id} className="address-person address-person-change" role="group" aria-label={`Änderung ab ${titleOf(change.chapterId) ?? 'Kapitel gelöscht'}`}>
          <label className="address-field">
            Ab Kapitel
            <select value={change.chapterId} onChange={(event) => void updateChange(change.id, { chapterId: event.target.value })}>
              {chapterOptions(change.chapterId)}
            </select>
          </label>
          <label className="address-field">
            Rang
            <select value={change.rankId ?? ''} onChange={(event) => void updateChange(change.id, { rankId: event.target.value || undefined })}>
              <option value="">unverändert</option>
              {rankOptions}
            </select>
          </label>
          <label className="address-field">
            Vorname
            <input key={`f-${change.id}-${change.first ?? ''}`} defaultValue={change.first ?? ''} onBlur={(event) => event.target.value.trim() !== (change.first ?? '') && void updateChange(change.id, { first: event.target.value })} />
          </label>
          <label className="address-field">
            Nachname
            <input key={`l-${change.id}-${change.last ?? ''}`} defaultValue={change.last ?? ''} onBlur={(event) => event.target.value.trim() !== (change.last ?? '') && void updateChange(change.id, { last: event.target.value })} />
          </label>
          <button type="button" className="ghost icon danger address-change-remove" aria-label="Änderung entfernen" onClick={() => void saveChanges(changes.filter((item) => item.id !== change.id))}>
            ×
          </button>
        </div>
      ))}
      {adding ? (
        <div className="address-person address-person-change" role="group" aria-label="Neue Änderung">
          <label className="address-field">
            Ab Kapitel
            <select value={adding.chapterId} onChange={(event) => setAdding({ ...adding, chapterId: event.target.value })}>
              {chapterOptions()}
            </select>
          </label>
          <label className="address-field">
            Rang
            <select value={adding.rankId} onChange={(event) => setAdding({ ...adding, rankId: event.target.value })}>
              <option value="">unverändert</option>
              {rankOptions}
            </select>
          </label>
          <label className="address-field">
            Vorname
            <input value={adding.first} onChange={(event) => setAdding({ ...adding, first: event.target.value })} />
          </label>
          <label className="address-field">
            Nachname
            <input value={adding.last} onChange={(event) => setAdding({ ...adding, last: event.target.value })} />
          </label>
          <div className="address-actions">
            <button
              type="button"
              className="primary"
              onClick={() => {
                const next = adding
                setAdding(null)
                void saveChanges([...changes, { chapterId: next.chapterId, rankId: next.rankId || undefined, first: next.first, last: next.last }])
              }}
            >
              Hinzufügen
            </button>
            <button type="button" className="ghost" onClick={() => setAdding(null)}>
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        chapters.length > 0 && (
          <button type="button" className="ghost address-add" onClick={() => setAdding({ chapterId: chapterId ?? chapters[0].id, rankId: '', first: '', last: '' })}>
            + Änderung ab Kapitel
          </button>
        )
      )}

      {failed && (
        <p className="address-error" role="alert">
          Das hat nicht geklappt. Bitte versuche es noch einmal.
        </p>
      )}

      {[
        { label: `Wie ${entry.name} andere anspricht`, outgoing: true },
        { label: `Wie andere ${entry.name} ansprechen`, outgoing: false },
      ].map(({ label, outgoing }) => (
        <div key={label} className="address-direction">
          <span className="address-sub">{label}</span>
          {others.length === 0 ? (
            <p className="muted wiki-none">Noch niemand mit Rang.</p>
          ) : (
            <>
            <AddressHead />
            <ul className="address-list" aria-label={label}>
              {others.map((other) => {
                const from = outgoing ? entry : other
                const to = outgoing ? other : entry
                return (
                  <AddressRow
                    key={other.id}
                    book={book}
                    from={from}
                    to={to}
                    name={other.name}
                    chapters={chapters}
                    chapterId={chapterId}
                    editing={isEditing(from.id, to.id)}
                    onEdit={() => setEditing({ from: from.id, to: to.id })}
                    onDone={done}
                  />
                )
              })}
            </ul>
            </>
          )}
        </div>
      ))}
    </section>
  )
}
