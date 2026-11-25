import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrashItem } from '../types'
import { SYNCED_EVENT } from '../storage/connection'
import { daysLeft, deleteTrash, listTrash, restoreTrash } from '../storage/trash'
import { useRestoreFocus } from '../ui/useRestoreFocus'
import './trash.css'

const KIND_LABEL: Record<string, string> = { chapter: 'Kapitel', entry: 'Wiki' }

function when(item: TrashItem, now: number): string {
  const date = new Date(item.deletedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
  const left = daysLeft(item, now)
  return `gelöscht am ${date.endsWith('.') ? date : `${date}.`} · ${left <= 1 ? 'noch heute' : `noch ${left} Tage`}`
}

interface Props {
  bookId: string
  onRestored: (result: { kind: 'chapter' | 'entry'; targetId: string }) => void
  onClose: () => void
}

/** The book's trash: restore, or delete for good (after asking). */
export function TrashDialog({ bookId, onRestored, onClose }: Props) {
  const [items, setItems] = useState<TrashItem[] | null>(null)
  const [asking, setAsking] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await listTrash(bookId)
      setItems(list)
      // A question about something that is gone (e.g. restored on the other device) goes too.
      setAsking((id) => (id && list.some((item) => item.id === id) ? id : null))
    } catch {
      setFailed(true)
    }
  }, [bookId])

  useEffect(() => {
    void load()
    // A sync run may bring restores and deletions from the other device.
    const reload = () => void load()
    window.addEventListener(SYNCED_EVENT, reload)
    return () => window.removeEventListener(SYNCED_EVENT, reload)
  }, [load])

  const windowRef = useRef<HTMLDivElement>(null)
  useRestoreFocus(windowRef)

  // Esc closes only this window: caught first, so focus mode and the like stay as they are.
  // While “Endgültig löschen?” is asked, Esc only takes the question back.
  const askingRef = useRef(asking)
  askingRef.current = asking
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (askingRef.current) setAsking(null)
      else onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const restore = async (item: TrashItem) => {
    setFailed(false)
    try {
      const result = await restoreTrash(item.id)
      if (result) return onRestored(result)
      setFailed(true)
    } catch {
      setFailed(true)
    }
    // Perhaps it is gone already (restored or deleted on the other device): show what is there now.
    await load()
  }

  const remove = async (item: TrashItem) => {
    setAsking(null)
    setFailed(false)
    try {
      await deleteTrash(item.id)
    } catch {
      setFailed(true)
    }
    await load()
  }

  const now = Date.now()
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog trash-dialog" role="dialog" ref={windowRef} aria-modal="true" aria-label="Papierkorb">
        <header className="trash-header">
          <h2>Papierkorb</h2>
          <button type="button" className="ghost icon" aria-label="Schließen" onClick={onClose} autoFocus>
            ✕
          </button>
        </header>
        <p className="muted trash-note">Gelöschtes bleibt 30 Tage, danach ist es endgültig weg.</p>
        {failed && (
          <p className="status-error" role="alert">
            Das hat nicht geklappt. Bitte noch einmal versuchen.
          </p>
        )}
        {items !== null && items.length === 0 && <p className="muted trash-empty">Der Papierkorb ist leer.</p>}
        {items !== null && items.length > 0 && (
          <ul className="trash-list">
            {items.map((item) => {
              const known = item.kind in KIND_LABEL
              return (
                <li key={item.id} className="trash-item">
                  <div className="trash-info">
                    <span className="trash-kind">{KIND_LABEL[item.kind] ?? 'Anderes'}</span>
                    <span className="trash-title">{item.title || 'Unbenannt'}</span>
                    <span className="trash-when">{when(item, now)}</span>
                  </div>
                  {asking === item.id ? (
                    <div className="trash-actions trash-asking">
                      <span className="trash-question">Endgültig löschen?</span>
                      <button type="button" className="ghost" onClick={() => setAsking(null)}>
                        Abbrechen
                      </button>
                      <button type="button" className="danger" onClick={() => void remove(item)}>
                        Ja, löschen
                      </button>
                    </div>
                  ) : (
                    <div className="trash-actions">
                      <button type="button" className="ghost trash-forever" aria-label={`„${item.title}“ endgültig löschen`} onClick={() => setAsking(item.id)}>
                        Endgültig löschen
                      </button>
                      {known && (
                        <button type="button" aria-label={`„${item.title}“ wiederherstellen`} onClick={() => void restore(item)}>
                          Wiederherstellen
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
