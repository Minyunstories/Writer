import { useState, type ReactNode } from 'react'
import type { Matcher } from './linker'

interface Props {
  id?: string
  value: string
  ariaLabel?: string
  placeholder?: string
  matcher: Matcher
  onChange: (value: string) => void
  onOpen?: (entryId: string) => void
}

/**
 * A one-line value. Names of wiki entries in it are shown as links; a click
 * anywhere else switches to editing.
 */
export function LinkedValue({ id, value, ariaLabel, placeholder, matcher, onChange, onOpen }: Props) {
  const [editing, setEditing] = useState(false)
  const matches = onOpen ? matcher.find(value) : []

  if (editing || matches.length === 0) {
    return (
      <input
        id={id}
        type="text"
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={value}
        autoFocus={editing}
        // Typing a name must not turn the field into links under the cursor.
        onFocus={() => setEditing(true)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setEditing(false)}
      />
    )
  }

  const parts: ReactNode[] = []
  let at = 0
  for (const match of matches) {
    if (match.from > at) parts.push(value.slice(at, match.from))
    parts.push(
      <button
        key={match.from}
        type="button"
        className="wiki-inline-link"
        onClick={(event) => {
          event.stopPropagation()
          onOpen?.(match.entryId)
        }}
      >
        {value.slice(match.from, match.to)}
      </button>,
    )
    at = match.to
  }
  if (at < value.length) parts.push(value.slice(at))

  return (
    <div
      className="wiki-linked-value"
      role="textbox"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={() => setEditing(true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === 'F2') setEditing(true)
      }}
    >
      {parts}
    </div>
  )
}
