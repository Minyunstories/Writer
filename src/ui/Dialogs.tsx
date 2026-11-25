import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'

function Backdrop({ onCancel, children }: { onCancel: () => void; children: ReactNode }) {
  useEffect(() => {
    // Caught first and marked as used: Esc closes only the dialog, focus mode stays on.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      {children}
    </div>
  )
}

interface PromptProps {
  heading: string
  initialValue?: string
  confirmLabel: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function PromptDialog({ heading, initialValue = '', confirmLabel, onConfirm, onCancel }: PromptProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onConfirm(value)
  }

  return (
    <Backdrop onCancel={onCancel}>
      <form className="dialog" role="dialog" aria-modal="true" aria-label={heading} onSubmit={submit}>
        <h2>{heading}</h2>
        <div>
          <label htmlFor={id} className="muted" style={{ display: 'block', marginBottom: 6, fontSize: 13 }}>
            Titel
          </label>
          <input id={id} ref={inputRef} type="text" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="submit" className="primary">
            {confirmLabel}
          </button>
        </div>
      </form>
    </Backdrop>
  )
}

interface ConfirmProps {
  message: string
  /** Replaces the default warning under the question. */
  detail?: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({ message, detail, confirmLabel, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Backdrop onCancel={onCancel}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={message}>
        <h2>{message}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {detail ?? 'Das lässt sich nicht rückgängig machen.'}
        </p>
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onCancel} autoFocus>
            Abbrechen
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Backdrop>
  )
}
