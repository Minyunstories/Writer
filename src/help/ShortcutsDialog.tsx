import { useEffect, useState } from 'react'
import { SHORTCUT_GROUPS } from './shortcuts'
import './help.css'

/** All shortcuts at a glance. Esc, ✕ or a click beside it closes. */
export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  // Taken while rendering, before the ✕ button takes the focus.
  const [before] = useState(() => document.activeElement)
  // Back to where the writer was (usually the text), so typing can go on.
  useEffect(
    () => () => {
      if (before instanceof HTMLElement && before.isConnected) before.focus()
    },
    [before],
  )

  // Esc closes only the overview: caught first, so focus mode and the like stay as they are.
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

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog shortcuts-dialog" role="dialog" aria-modal="true" aria-label="Tastenkürzel">
        <header className="shortcuts-header">
          <h2>Tastenkürzel</h2>
          <button type="button" className="ghost icon" aria-label="Schließen" onClick={onClose} autoFocus>
            ✕
          </button>
        </header>
        <div className="shortcuts-body">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="shortcuts-group">
              <h3>{group.title}</h3>
              <dl>
                {group.items.map((item) => (
                  <div key={item.keys} className="shortcuts-row">
                    <dt>
                      <kbd>{item.keys}</kbd>
                    </dt>
                    <dd>{item.what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
