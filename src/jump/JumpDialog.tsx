import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Chapter, WikiEntry, WikiFolder } from '../types'
import { searchJump, type JumpHit } from './jump'
import { useRestoreFocus } from '../ui/useRestoreFocus'
import './jump.css'

interface Props {
  /** In book order. */
  chapters: Pick<Chapter, 'id' | 'title'>[]
  entries: Pick<WikiEntry, 'id' | 'name' | 'aliases' | 'folderId'>[]
  folders: Pick<WikiFolder, 'id' | 'name'>[]
  onPick: (hit: JumpHit) => void
  onClose: () => void
}

/** Strg+O: a few letters, then Enter, and the chapter or wiki entry opens. */
export function JumpDialog({ chapters, entries, folders, onPick, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const hits = useMemo(() => searchJump(query, chapters, entries, folders), [query, chapters, entries, folders])
  const ids = useId()
  const listRef = useRef<HTMLUListElement>(null)

  const windowRef = useRef<HTMLDivElement>(null)
  useRestoreFocus(windowRef)

  // Esc closes only this window: caught first, so focus mode and the like stay as they are.
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

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [selected, hits])

  const current = Math.min(selected, hits.length - 1)
  const optionId = (index: number) => `${ids}-option-${index}`

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelected(Math.min(current + 1, hits.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelected(Math.max(current - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (hits[current]) onPick(hits[current])
    }
  }

  return (
    <div
      className="dialog-backdrop jump-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog jump-dialog" role="dialog" ref={windowRef} aria-modal="true" aria-label="Schnellsprung">
        <input
          type="text"
          role="combobox"
          aria-label="Kapitel oder Wiki-Eintrag suchen"
          aria-expanded="true"
          aria-controls={`${ids}-list`}
          aria-activedescendant={hits.length > 0 ? optionId(current) : undefined}
          aria-autocomplete="list"
          placeholder="Kapitel oder Wiki-Eintrag …"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
        />
        {hits.length === 0 ? (
          <p className="muted jump-empty">Nichts gefunden.</p>
        ) : (
          <ul className="jump-list" role="listbox" id={`${ids}-list`} aria-label="Treffer" ref={listRef}>
            {hits.map((hit, index) => (
              <li
                key={`${hit.kind}-${hit.id}`}
                id={optionId(index)}
                role="option"
                aria-selected={index === current}
                className="jump-hit"
                // Keep the focus in the field.
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setSelected(index)}
                onClick={() => onPick(hit)}
              >
                <span className="jump-title">{hit.title}</span>
                {hit.alias && <span className="jump-alias">auch: {hit.alias}</span>}
                <span className="jump-label">{hit.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
