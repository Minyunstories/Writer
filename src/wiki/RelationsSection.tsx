import { useId, useState, type FormEvent } from 'react'
import { addRelation, addRelationType, deleteRelation, deleteRelationType, relationsOf, updateRelationType } from '../storage/relations'
import type { Book, RelationType, WikiEntry } from '../types'

interface Props {
  book: Pick<Book, 'id' | 'relations'>
  entryId: string
  entries: WikiEntry[]
  onOpenEntry: (entryId: string) => void
  /** After every stored change, so the book is read again. */
  onChanged?: () => void
}

const NEW = '__new'

/** Every kind once per side: "Lehrer von" and "Schüler von"; a kind that is the same both ways only once. */
function sides(types: RelationType[]) {
  return types.flatMap((type) => [
    { value: `${type.id}:f`, label: type.forward },
    ...(type.backward ? [{ value: `${type.id}:b`, label: type.backward }] : []),
  ])
}

function TypeRow({ bookId, type, onFail, onDone }: { bookId: string; type: RelationType; onFail: () => void; onDone: () => void }) {
  const [forward, setForward] = useState(type.forward)
  const [backward, setBackward] = useState(type.backward ?? '')
  const save = () => {
    if (forward.trim() === type.forward && backward.trim() === (type.backward ?? '')) return
    updateRelationType(bookId, type.id, forward, backward).then(onDone, onFail)
  }
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      save()
    }
  }
  return (
    <li className="relation-type">
      <input aria-label={`Name von „${type.forward}“`} value={forward} onChange={(event) => setForward(event.target.value)} onBlur={save} onKeyDown={onKey} />
      <span aria-hidden="true">↔</span>
      <input
        aria-label={`Gegenstück von „${type.forward}“`}
        placeholder="gleich"
        value={backward}
        onChange={(event) => setBackward(event.target.value)}
        onBlur={save}
        onKeyDown={onKey}
      />
      <button className="ghost icon danger" aria-label={`Art „${type.forward}“ löschen`} title="Löschen (mit allen Beziehungen dieser Art)" onClick={() => deleteRelationType(bookId, type.id).then(onDone, onFail)}>
        ×
      </button>
    </li>
  )
}

/** Relationships of a wiki entry: who is what to whom, named from this entry's side. */
export function RelationsSection({ book, entryId, entries, onOpenEntry, onChanged }: Props) {
  const ids = useId()
  const [adding, setAdding] = useState(false)
  const [managing, setManaging] = useState(false)
  const [side, setSide] = useState('')
  const [other, setOther] = useState('')
  const [note, setNote] = useState('')
  const [newForward, setNewForward] = useState('')
  const [newBackward, setNewBackward] = useState('')
  const [failed, setFailed] = useState(false)
  const fail = () => setFailed(true)
  const done = () => {
    setFailed(false)
    onChanged?.()
  }

  const types = book.relations?.types ?? []
  const options = sides(types)
  const names = new Map(entries.map((entry) => [entry.id, entry.name]))
  const seen = relationsOf(book, entryId).filter((relation) => names.has(relation.other))
  const groups = new Map<string, typeof seen>()
  for (const relation of seen) groups.set(relation.label, [...(groups.get(relation.label) ?? []), relation])
  const others = entries.filter((entry) => entry.id !== entryId).sort((a, b) => a.name.localeCompare(b.name, 'de'))

  const startAdding = () => {
    setSide(options[0]?.value ?? NEW)
    setOther('')
    setNote('')
    setNewForward('')
    setNewBackward('')
    setAdding(true)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!other) return
    void (async () => {
      let typeId: string
      let backward = false
      if (side === NEW) {
        if (!newForward.trim()) return
        typeId = (await addRelationType(book.id, newForward, newBackward)).id
      } else {
        const [id, direction] = side.split(':')
        typeId = id
        backward = direction === 'b'
      }
      await addRelation(book.id, backward ? { from: other, to: entryId, typeId, note } : { from: entryId, to: other, typeId, note })
      setAdding(false)
      done()
    })().catch(fail)
  }

  return (
    <section className="wiki-field relations" aria-labelledby={`${ids}-label`}>
      <span className="wiki-label" id={`${ids}-label`}>
        Beziehungen
      </span>
      {seen.length === 0 && !adding && <p className="muted wiki-none">Noch keine Beziehungen</p>}
      {[...groups].map(([label, list]) => (
        <div key={label} className="relation-group">
          <span className="relation-label">{label}</span>
          <ul className="relation-list">
            {list.map((relation) => (
              <li key={relation.id}>
                <button className="relation-name" onClick={() => onOpenEntry(relation.other)}>
                  {names.get(relation.other)}
                </button>
                {relation.note && <span className="muted relation-note">{relation.note}</span>}
                <button
                  className="ghost icon danger relation-delete"
                  aria-label={`Beziehung zu ${names.get(relation.other)} löschen`}
                  title="Löschen"
                  onClick={() => deleteRelation(book.id, relation.id).then(done, fail)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {adding ? (
        <form className="relation-form" onSubmit={submit}>
          <label>
            <span className="muted">Art</span>
            <select aria-label="Art" value={side} onChange={(event) => setSide(event.target.value)}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              <option value={NEW}>Neue Art …</option>
            </select>
          </label>
          {side === NEW && (
            <>
              <input aria-label="Name der neuen Art" placeholder="z. B. Lehrer von" value={newForward} onChange={(event) => setNewForward(event.target.value)} />
              <input aria-label="Gegenstück" placeholder="z. B. Schüler von (leer: gleich in beide Richtungen)" value={newBackward} onChange={(event) => setNewBackward(event.target.value)} />
            </>
          )}
          <label>
            <span className="muted">Mit</span>
            <select aria-label="Mit" value={other} onChange={(event) => setOther(event.target.value)}>
              <option value="">Eintrag wählen …</option>
              {others.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <input aria-label="Notiz zur Beziehung" placeholder="Notiz (optional)" value={note} onChange={(event) => setNote(event.target.value)} />
          <div className="relation-actions">
            <button type="submit" className="primary" disabled={!other || (side === NEW && !newForward.trim())}>
              Hinzufügen
            </button>
            <button type="button" className="ghost" onClick={() => setAdding(false)}>
              Abbrechen
            </button>
          </div>
        </form>
      ) : (
        <div className="relation-actions">
          <button className="ghost" onClick={startAdding} disabled={others.length === 0}>
            + Beziehung
          </button>
          {types.length > 0 && (
            <button className="ghost" aria-expanded={managing} onClick={() => setManaging((on) => !on)}>
              Arten verwalten
            </button>
          )}
        </div>
      )}
      {managing && (
        <ul className="relation-types" aria-label="Beziehungsarten">
          {types.map((type) => (
            <TypeRow key={type.id} bookId={book.id} type={type} onFail={fail} onDone={done} />
          ))}
        </ul>
      )}
      {failed && <p className="relation-error">Das hat nicht geklappt. Bitte noch einmal versuchen.</p>}
    </section>
  )
}
