import { useEffect, useRef, useState } from 'react'
import { addRank, deleteRank, importAddress, moveRank, setFigureFolder, updateRank } from '../storage/address'
import type { AddressRank, Book, WikiEntry, WikiFolder } from '../types'
import { ConfirmDialog } from '../ui/Dialogs'
import { parseAddressImport, type AddressImport, type ImportReport } from './importFile'
import { figureFolderId, figuresOf } from './resolve'
import './address.css'

interface Props {
  book: Book
  folders: WikiFolder[]
  entries: WikiEntry[]
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

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const reportText = (report: ImportReport) =>
  `Eingelesen: ${count(report.ranks, 'Rang', 'Ränge')}, ${count(report.people, 'Figur', 'Figuren')}, ${count(report.forms, 'Abweichung', 'Abweichungen')}.` +
  (report.missing.length ? ` Nicht gefunden: ${report.missing.join(', ')}.` : '')

/** The wiki home's "Anreden" tab: where the figures are, and the rule for each rank. */
export function RanksPage({ book, folders, entries, onChanged }: Props) {
  const ranks = book.address?.ranks ?? []
  const [arranging, setArranging] = useState(false)
  const [deleting, setDeleting] = useState<AddressRank | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [pending, setPending] = useState<AddressImport | null>(null)
  const [report, setReport] = useState<string | null>(null)
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
  const readImport = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const data = parseAddressImport(await file.text())
    setReport(data ? null : 'Diese Datei kann Writer nicht als Anreden einlesen.')
    setPending(data)
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

      {report && (
        <p className="muted ranks-report" role="status">
          {report}
        </p>
      )}
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
        <label className="ghost ranks-import" title="Anreden aus einer Datei übernehmen; ersetzt die bisherigen">
          Anreden einlesen
          <input type="file" accept=".json,application/json" onChange={(event) => void readImport(event.target)} />
        </label>
      </div>
      {pending && (
        <ConfirmDialog
          message="Anreden einlesen?"
          detail="Das ersetzt alle Ränge, Angaben zu Figuren und Abweichungen, die bisher unter „Anreden“ stehen."
          confirmLabel="Einlesen"
          onConfirm={() => {
            const data = pending
            setPending(null)
            void attempt(async () => setReport(reportText(await importAddress(book.id, data, figuresOf(book.address, entries, folders)))))
          }}
          onCancel={() => setPending(null)}
        />
      )}
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
