import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui/Icon'
import { isAddressCheckOn, isGrammarOn, isRepeatsOn, setAddressCheckOn, setGrammarOn, setRepeatsOn } from './grammarSetting'

interface Props {
  /** Puts the cursor back into the text (after Esc). */
  onReturn: () => void
  /** The forms-of-address module is on in this book: offer its check. */
  address?: boolean
}

/** The "Prüfung" button: a small menu to tick which checks run on this device. */
export function CheckMenu({ onReturn, address = false }: Props) {
  const [open, setOpen] = useState(false)
  const [grammar, setGrammar] = useState(isGrammarOn)
  const [repeats, setRepeats] = useState(isRepeatsOn)
  const [addressCheck, setAddressCheck] = useState(isAddressCheckOn)
  const ref = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const firstRef = useRef<HTMLInputElement>(null)
  // Opened with the keyboard: the focus goes into the menu. Opened with mouse or finger: it stays in the text.
  const focusInside = useRef(false)
  const menuId = useId()

  // The menu lives outside the toolbar (which scrolls sideways on small screens and would cut it off),
  // fixed under the button: right edge at the button's, moved in where it would leave the window.
  useLayoutEffect(() => {
    const menu = menuRef.current
    const anchor = buttonRef.current
    if (!open || !menu || !anchor) return
    const place = anchor.getBoundingClientRect()
    const margin = 8
    const width = menu.getBoundingClientRect().width
    const left = Math.min(Math.max(place.right - width, margin), Math.max(margin, window.innerWidth - margin - width))
    menu.style.left = `${Math.round(left)}px`
    menu.style.top = `${Math.round(place.bottom + 6)}px`
    if (focusInside.current) firstRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    // Capture phase: Esc closes only the menu; focus mode (which ends on Esc) stays.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      onReturn()
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false)
    }
    // A fixed menu would stay put while the window changes size: close it instead.
    const onResize = () => setOpen(false)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('resize', onResize)
    }
  }, [open, onReturn])

  // Tabbing out of the menu closes it (the menu sits at the end of the page, away from its button).
  const onFocusLeave = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null
    if (next && (menuRef.current?.contains(next) || buttonRef.current?.contains(next))) return
    setOpen(false)
  }

  return (
    <span ref={ref} className="editor-check">
      <button
        ref={buttonRef}
        type="button"
        className={`editor-grammar${grammar || repeats || (address && addressCheck) ? ' on' : ''}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Prüfungen auswählen (laufen nur auf diesem Gerät)"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          // detail 0: Enter or Space, not a click or tap.
          focusInside.current = !open && event.detail === 0
          setOpen(!open)
        }}
      >
        <Icon name="check" />
        <span className="tool-label">Prüfung</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className="editor-check-menu"
            role="group"
            aria-label="Prüfungen"
            // Ticking with mouse or finger leaves the cursor in the text (and the phone keyboard open).
            onMouseDown={(event) => event.preventDefault()}
            onBlur={onFocusLeave}
          >
            <label>
              <input
                ref={firstRef}
                type="checkbox"
                checked={grammar}
                onChange={(event) => {
                  setGrammarOn(event.target.checked)
                  setGrammar(event.target.checked)
                }}
              />
              Rechtschreibung und Grammatik
            </label>
            <label>
              <input
                type="checkbox"
                checked={repeats}
                onChange={(event) => {
                  setRepeatsOn(event.target.checked)
                  setRepeats(event.target.checked)
                }}
              />
              Wortwiederholungen
            </label>
            {address && (
              <label>
                <input
                  type="checkbox"
                  checked={addressCheck}
                  onChange={(event) => {
                    setAddressCheckOn(event.target.checked)
                    setAddressCheck(event.target.checked)
                  }}
                />
                Anreden
              </label>
            )}
            <p className="muted">Läuft nur auf diesem Gerät.</p>
          </div>,
          document.body,
        )}
    </span>
  )
}
