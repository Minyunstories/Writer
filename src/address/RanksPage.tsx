import { useEffect, useRef, useState } from 'react'
import { addRank, deleteRank, moveRank, setFigureFolder, updateRank } from '../storage/address'
import type { AddressRank, Book, WikiFolder } from '../types'
import { ConfirmDialog } from '../ui/Dialogs'
import { figureFolderId } from './resolve'
import './address.css'

interface Props {
  book: Book
  folders: WikiFolder[]
  onChanged: () => void
}

const NEW_RANK = 'Neuer Rang'
type Field = 'name' | 'public' | 'private' | 'note'
const FIELDS: { key: Field; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'public', label: 'Öffentlich / dienstlich' },
  { key: 'private', label: 'Privat' },
  { key: 'note', label: 'Notiz' },
]

/** The wiki home's "Anreden" tab: where the figures are, and the rule for each rank. */
export function RanksPage({ book, folders, onChanged }: Props) {
  const ranks = book.address?.ranks ?? []
  const [arranging, setArranging] = useState(false)
  const [deleting, setDeleting] = useState<AddressRank | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const nameRefs = useRef(new Map<string, HTMLInputElement>())

  // A new rank: put the cursor in its name, with the placeholder name selected.
  useEffect(() => {
    if (!fresh) return
    const input = nameRefs.current.get(fresh)
    if (!input) return
    input.focus()
    input.select()
    setFresh(null)
  }, [fresh, ranks])

  const attempt = async (action: () => Promise<unknown>) => {
    setFailed(false)
    try {
      await action()
    } catch {
      setFailed(true)
    }
    onChanged()
  }
  const save = (rank: AddressRank, key: Field, value: string) => {
    if (key === 'name' && !value.trim()) return
    if (value.trim() === (rank[key] ?? '')) return
    void attempt(() => updateRank(book.id, rank.id, { [key]: value }))
  }
  const topFolders = folders.filter((folder) => !folder.parentId).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="ranks-page">
      <p className="muted ranks-hint">{'{Vorname} und {Nachname} werden mit den Namen der Figur gefüllt.'}</p>
      <label className="address-field ranks-folder">
        Figuren stehen im Ordner
        <select value={figureFolderId(book.address, folders) ?? '*'} onChange={(event) => void attempt(() => setFigureFolder(book.id, event.target.value))}>
          <option value="*">Alle Einträge</option>
          {topFolders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
      </label>

      {ranks.length === 0 && <p className="muted">Noch keine Ränge. Lege den ersten mit „+ Rang“ an.</p>}
      <ul className="ranks-list" aria-label="Ränge">
        {ranks.map((rank, index) => (
          <li key={rank.id} className="ranks-item" role="group" aria-label={rank.name}>
            {FIELDS.map(({ key, label }) => (
              <label key={key} className={`address-field${key === 'note' ? ' address-wide' : ''}`}>
                {label}
                <input
                  key={`${rank.id}-${key}-${rank[key] ?? ''}`}
                  ref={key === 'name' ? (input) => void (input ? nameRefs.current.set(rank.id, input) : nameRefs.current.delete(rank.id)) : undefined}
                  defaultValue={rank[key] ?? ''}
                  onBlur={(event) => save(rank, key, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                  }}
                />
              </label>
            ))}
            <div className="ranks-actions">
              {arranging && (
                <>
                  <button type="button" className="ghost icon" aria-label={`${rank.name} nach oben`} disabled={index === 0} onClick={() => void attempt(() => moveRank(book.id, rank.id, -1))}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className="ghost icon"
                    aria-label={`${rank.name} nach unten`}
                    disabled={index === ranks.length - 1}
                    onClick={() => void attempt(() => moveRank(book.id, rank.id, 1))}
                  >
                    ↓
                  </button>
                </>
              )}
              <button type="button" className="ghost icon danger" aria-label={`Rang „${rank.name}“ löschen`} title="Löschen" onClick={() => setDeleting(rank)}>
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
      {failed && (
        <p className="address-error" role="alert">
          Das hat nicht geklappt. Bitte versuche es noch einmal.
        </p>
      )}
      <div className="address-actions">
        <button
          type="button"
          className="ghost address-add"
          onClick={() =>
            void attempt(async () => {
              const rank = await addRank(book.id, NEW_RANK)
              setFresh(rank.id)
            })
          }
        >
          + Rang
        </button>
        {ranks.length > 1 && (
          <button type="button" className="ghost" onClick={() => setArranging(!arranging)}>
            {arranging ? 'Fertig' : 'Anordnen'}
          </button>
        )}
      </div>
      {deleting && (
        <ConfirmDialog
          message="Rang löschen?"
          detail={`Figuren mit dem Rang „${deleting.name}“ haben danach keinen Rang mehr.`}
          confirmLabel="Löschen"
          onConfirm={() => {
            const id = deleting.id
            setDeleting(null)
            void attempt(() => deleteRank(book.id, id))
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  )
}
