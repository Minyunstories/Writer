import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { Chapter, ChapterGroup } from '../types'

export type GroupChoice = { id: string | null } | { newName: string }

interface Props {
  chapter: Chapter
  groups: ChapterGroup[]
  onSave: (title: string, group: GroupChoice) => void
  onCancel: () => void
}

const NEW = '__new'

/** A chapter's title and the group it belongs to. */
export function ChapterDialog({ chapter, groups, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(chapter.title)
  const [group, setGroup] = useState(chapter.group && groups.some((g) => g.id === chapter.group) ? chapter.group : '')
  const [newName, setNewName] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const id = useId()

  useEffect(() => {
    titleRef.current?.focus()
    titleRef.current?.select()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSave(title, group === NEW ? (newName.trim() ? { newName } : { id: null }) : { id: group || null })
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <form className="dialog chapter-dialog" role="dialog" aria-modal="true" aria-label="Kapitel bearbeiten" onSubmit={submit}>
        <h2>Kapitel bearbeiten</h2>
        <label htmlFor={`${id}-title`}>Titel</label>
        <input id={`${id}-title`} ref={titleRef} type="text" value={title} onChange={(event) => setTitle(event.target.value)} />
        <label htmlFor={`${id}-group`}>Gruppe</label>
        <select id={`${id}-group`} value={group} onChange={(event) => setGroup(event.target.value)}>
          <option value="">Keine Gruppe</option>
          {groups.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
          <option value={NEW}>Neue Gruppe …</option>
        </select>
        {group === NEW && (
          <>
            <label htmlFor={`${id}-new`}>Name der neuen Gruppe</label>
            <input id={`${id}-new`} type="text" placeholder="z. B. Der Winterball" value={newName} onChange={(event) => setNewName(event.target.value)} />
          </>
        )}
        <p className="muted chapter-dialog-hint">Kapitel einer Gruppe stehen in der Kapitelliste unter einer gemeinsamen Überschrift.</p>
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="submit" className="primary">
            Speichern
          </button>
        </div>
      </form>
    </div>
  )
}
