import { useEffect, useRef } from 'react'
import { replaceMatches } from '../search/find'
import { useRestoreFocus } from '../ui/useRestoreFocus'
import './rename.css'

/** How often a name stands in a text: whole words, exact spelling – the same as what gets linked. */
export function countName(text: string, name: string): number {
  return replaceMatches(text, name, name, { caseSensitive: true, wholeWord: true }).count
}

interface Props {
  oldName: string
  newName: string
  count: number
  onReplace: () => void
  onKeepAlias: () => void
  onClose: () => void
}

/** After renaming a wiki entry: change the old name in the text, or keep it as "also known as". */
export function RenameDialog({ oldName, newName, count, onReplace, onKeepAlias, onClose }: Props) {
  const windowRef = useRef<HTMLDivElement>(null)
  useRestoreFocus(windowRef)

  // Esc closes only this window, caught first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const title = `„${oldName}“ heißt jetzt „${newName}“`
  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog rename-dialog" role="dialog" aria-modal="true" aria-label={title} ref={windowRef}>
        <header className="rename-header">
          <h2>{title}</h2>
          {/* The safe choice has the focus: a quick Enter must not change the whole book. */}
          <button type="button" className="ghost icon" aria-label="Schließen" onClick={onClose} autoFocus>
            ✕
          </button>
        </header>
        <p>
          „{oldName}“ kommt {count === 1 ? 'einmal' : `${count}-mal`} in deinen Kapiteln vor.
        </p>
        <div className="dialog-actions rename-actions">
          <button type="button" className="ghost" onClick={onKeepAlias}>
            „{oldName}“ als „auch bekannt als“ behalten
          </button>
          <button type="button" className="primary" onClick={onReplace}>
            Überall durch „{newName}“ ersetzen
          </button>
        </div>
      </div>
    </div>
  )
}
