import { useId, useState } from 'react'

const HUES = [12, 40, 95, 150, 190, 225, 270, 320]

/** A fixed colour per tag text, so the same tag looks the same everywhere. */
export function tagColor(tag: string): string {
  let hash = 0
  for (const char of tag) hash = (hash * 31 + char.codePointAt(0)!) >>> 0
  return `hsl(${HUES[hash % HUES.length]} 55% 68%)`
}

interface Props {
  tags: string[]
  /** All tags used in the book, offered while typing. */
  suggestions: string[]
  /** One tag added or removed; stored against the saved tags, so quick changes never undo each other. */
  onChange: (change: { add: string } | { remove: string }) => void
  onFilter: (tag: string) => void
}

export function Tags({ tags, suggestions, onChange, onFilter }: Props) {
  const [draft, setDraft] = useState('')
  const listId = useId()

  const add = () => {
    const tag = draft.trim()
    setDraft('')
    if (tag && !tags.includes(tag)) onChange({ add: tag })
  }

  return (
    <div className="outline-tags">
      {tags.map((tag) => (
        <span key={tag} className="outline-tag" style={{ ['--tag' as string]: tagColor(tag) }}>
          <button className="outline-tag-name" aria-label={`Nach Tag „${tag}“ filtern`} onClick={() => onFilter(tag)}>
            {tag}
          </button>
          <button
            className="outline-tag-remove"
            aria-label={`Tag „${tag}“ entfernen`}
            onClick={() => onChange({ remove: tag })}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="outline-tag-input"
        type="text"
        aria-label="Tag hinzufügen"
        placeholder="+ Tag"
        list={listId}
        value={draft}
        enterKeyHint="done"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            add()
          }
        }}
        onBlur={add}
      />
      <datalist id={listId}>
        {suggestions
          .filter((tag) => !tags.includes(tag))
          .map((tag) => (
            <option key={tag} value={tag} />
          ))}
      </datalist>
    </div>
  )
}
