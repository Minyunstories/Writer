import { useRef, useState } from 'react'
import { deleteForm, saveForm } from '../storage/address'
import type { Book, Chapter, WikiEntry } from '../types'
import { ConfirmDialog } from '../ui/Dialogs'
import { fill, formOf, personAt } from './resolve'
import './address.css'

interface Props {
  book: Book
  from: WikiEntry
  to: WikiEntry
  chapters: Chapter[]
  /** The open chapter; a new change starts there. Null in the wiki: a new change starts "noch offen". */
  chapterId: string | null
  /** Called when the form closes; true when something was stored. */
  onDone: (changed: boolean) => void
}

/** A change row while editing; chapterId '' means "noch offen". */
type Row = { id?: string; chapterId: string; label: string; public: string; private: string; note: string }

/** Editing how one figure addresses another: the exception and its changes. */
export function FormEditor({ book, from, to, chapters, chapterId, onDone }: Props) {
  const order = chapters.map((chapter) => chapter.id)
  const existing = formOf(book.address, from.id, to.id)
  const [main, setMain] = useState({ public: existing?.public ?? '', private: existing?.private ?? '', note: existing?.note ?? '' })
  const [rows, setRows] = useState<Row[]>(() =>
    (existing?.changes ?? []).map((change) => ({
      id: change.id,
      chapterId: change.chapterId ?? '',
      label: change.label ?? '',
      public: change.public ?? '',
      private: change.private ?? '',
      note: change.note ?? '',
    })),
  )
  const [confirming, setConfirming] = useState(false)
  const [failed, setFailed] = useState(false)
  // What the editor showed when it opened: saving that unchanged would override the other device.
  const opened = useRef(JSON.stringify({ main, rows })).current

  const person = personAt(book.address, to, order, chapterId)
  const rulePublic = person.rank ? fill(person.rank.public, person) : ''
  const rulePrivate = person.rank?.private ? fill(person.rank.private, person) : rulePublic
  const heading = `${from.name} spricht ${to.name} an`
  const known = new Set(order)

  const run = async (action: () => Promise<void>) => {
    setFailed(false)
    try {
      await action()
      onDone(true)
    } catch {
      setFailed(true)
    }
  }
  const save = () => {
    if (JSON.stringify({ main, rows }) === opened) return onDone(false)
    return run(() =>
      saveForm(
        book.id,
        { from: from.id, to: to.id, ...main, changes: rows.map(({ chapterId: chapter, ...row }) => ({ ...row, ...(chapter ? { chapterId: chapter } : {}) })) },
        order,
      ),
    )
  }
  const updateRow = (index: number, patch: Partial<Row>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  return (
    <div className="address-editor" role="group" aria-label={heading}>
      <h4 className="address-editor-heading">{heading}</h4>
      <p className="address-rule">{person.rank ? `Regel: ${person.rank.name} – ${rulePublic}` : 'Kein Rang festgelegt'}</p>
      <div className="address-editor-fields">
        <label className="address-field">
          Öffentlich / dienstlich
          <input value={main.public} placeholder={rulePublic} onChange={(event) => setMain({ ...main, public: event.target.value })} />
        </label>
        <label className="address-field">
          Privat
          <input value={main.private} placeholder={rulePrivate} onChange={(event) => setMain({ ...main, private: event.target.value })} />
        </label>
        <label className="address-field address-wide">
          Notiz
          <input value={main.note} onChange={(event) => setMain({ ...main, note: event.target.value })} />
        </label>
      </div>
      <div className="address-changes">
        <span className="address-sub">Wechsel</span>
        {rows.map((row, index) => (
          <div key={row.id ?? `new-${index}`} className="address-change" role="group" aria-label={`Wechsel ${index + 1}`}>
            <label className="address-field">
              Ab Kapitel
              <select value={row.chapterId} onChange={(event) => updateRow(index, { chapterId: event.target.value })}>
                <option value="">noch offen</option>
                {row.chapterId && !known.has(row.chapterId) && <option value={row.chapterId}>Kapitel gelöscht</option>}
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="address-field">
              Name
              <input value={row.label} placeholder="z. B. Phase 2" onChange={(event) => updateRow(index, { label: event.target.value })} />
            </label>
            <label className="address-field">
              Öffentlich / dienstlich
              <input value={row.public} onChange={(event) => updateRow(index, { public: event.target.value })} />
            </label>
            <label className="address-field">
              Privat
              <input value={row.private} onChange={(event) => updateRow(index, { private: event.target.value })} />
            </label>
            <label className="address-field address-wide">
              Notiz
              <input value={row.note} onChange={(event) => updateRow(index, { note: event.target.value })} />
            </label>
            <button type="button" className="ghost icon danger address-change-remove" aria-label="Wechsel entfernen" onClick={() => setRows(rows.filter((_, i) => i !== index))}>
              ×
            </button>
          </div>
        ))}
        <button type="button" className="ghost address-add" onClick={() => setRows([...rows, { chapterId: chapterId ?? '', label: '', public: '', private: '', note: '' }])}>
          + Wechsel
        </button>
      </div>
      {failed && (
        <p className="address-error" role="alert">
          Das hat nicht geklappt. Bitte versuche es noch einmal.
        </p>
      )}
      <div className="address-actions">
        <button type="button" className="primary" onClick={() => void save()}>
          Fertig
        </button>
        <button type="button" className="ghost" onClick={() => onDone(false)}>
          Abbrechen
        </button>
        {existing && (
          <button type="button" className="ghost danger address-delete" onClick={() => setConfirming(true)}>
            Abweichung löschen
          </button>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          message="Abweichung löschen?"
          detail="Danach gilt wieder die Regel."
          confirmLabel="Löschen"
          onConfirm={() => {
            setConfirming(false)
            void run(() => deleteForm(book.id, from.id, to.id))
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
