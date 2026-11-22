import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Collection } from '../types'
import type { NewCollectionItem } from '../storage/collection'
import { loadThesaurus, synonymGroups, type Thesaurus } from '../synonyms/thesaurus'
import { groupsFor } from './collectionComplete'
import { DEFAULT_CATEGORY } from './collectionFile'

interface Props {
  initialText: string
  collection: Collection
  onSave: (item: Omit<NewCollectionItem, 'source' | 'tags'>) => void
  onCancel: () => void
  /** Where the synonyms for "Passende Gruppen" come from (tests give their own). */
  loadSynonyms?: () => Promise<Thesaurus>
}

const MAX_SUGGESTIONS = 6
const SEPARATOR = ' — '
const splitKey = (key: string) => {
  const [category, group] = key.split('\u0000')
  return { category, group }
}

const NEW = '__new'
const LAST_KEY = 'mw:collection-last-category'

/** "In die Sammlung": the marked text, editable, with category, group and note. */
export function AddToCollectionDialog({ initialText, collection, onSave, onCancel, loadSynonyms = loadThesaurus }: Props) {
  const categories = useMemo(
    () => [...new Set(collection.items.map((item) => item.category))].sort((a, b) => a.localeCompare(b, 'de', { numeric: true })),
    [collection.items],
  )
  const remembered = (() => {
    try {
      return localStorage.getItem(LAST_KEY)
    } catch {
      return null
    }
  })()
  const [text, setText] = useState(initialText)
  const [category, setCategory] = useState(remembered && categories.includes(remembered) ? remembered : categories[0] ?? NEW)
  const [newCategory, setNewCategory] = useState('')
  const [group, setGroup] = useState('')
  const [note, setNote] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)
  const id = useId()
  const groups = useMemo(
    () => [...new Set(collection.items.filter((item) => item.category === category && item.group).map((item) => item.group!))],
    [collection.items, category],
  )
  // Every group of every category, as „group — category“, so picking one sets the category too.
  const allGroups = useMemo(() => {
    const labels = new Map<string, { category: string; group: string }>()
    for (const item of collection.items)
      if (item.group) labels.set(`${item.group}${SEPARATOR}${item.category}`, { category: item.category, group: item.group })
    return labels
  }, [collection.items])
  const [suggested, setSuggested] = useState<{ category: string; group: string }[]>([])
  const word = text.trim().toLowerCase()
  useEffect(() => {
    // Groups for the word itself (named after it or holding it, also inflected), then for its synonyms.
    let alive = true
    const direct = word ? [...groupsFor(collection.items, word)] : []
    const show = (keys: string[]) => alive && setSuggested([...new Set(keys)].slice(0, MAX_SUGGESTIONS).map(splitKey))
    show(direct)
    if (!word || /\s/.test(word)) return
    loadSynonyms().then(
      (thesaurus) => {
        const others = synonymGroups(thesaurus, word).flatMap((group) => group.words)
        show([...direct, ...others.flatMap((other) => [...groupsFor(collection.items, other.toLowerCase())])])
      },
      () => {},
    )
    return () => {
      alive = false
    }
  }, [word, collection.items, loadSynonyms])
  const choose = (pick: { category: string; group: string }) => {
    setCategory(pick.category)
    setGroup(pick.group)
  }

  useEffect(() => {
    textRef.current?.focus()
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return
    const chosen = (category === NEW ? newCategory : category).trim() || DEFAULT_CATEGORY
    try {
      localStorage.setItem(LAST_KEY, chosen)
    } catch {
      // Only a convenience.
    }
    onSave({ text: text.trim(), category: chosen, group: group.trim(), note: note.trim() })
  }

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <form className="dialog collection-dialog" role="dialog" aria-modal="true" aria-label="In die Sammlung" onSubmit={submit}>
        <h2>In die Sammlung</h2>
        <label htmlFor={`${id}-text`}>Text</label>
        <textarea id={`${id}-text`} ref={textRef} rows={3} value={text} onChange={(event) => setText(event.target.value)} />
        <label htmlFor={`${id}-category`}>Kategorie</label>
        <select id={`${id}-category`} value={category} onChange={(event) => setCategory(event.target.value)}>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
          <option value={NEW}>Neue Kategorie …</option>
        </select>
        {category === NEW && (
          <>
            <label htmlFor={`${id}-new`}>Neue Kategorie</label>
            <input id={`${id}-new`} type="text" value={newCategory} placeholder={DEFAULT_CATEGORY} onChange={(event) => setNewCategory(event.target.value)} />
          </>
        )}
        <label htmlFor={`${id}-group`}>Gruppe</label>
        <input
          id={`${id}-group`}
          type="text"
          list={`${id}-groups`}
          value={group}
          placeholder="optional"
          onChange={(event) => {
            const picked = allGroups.get(event.target.value)
            if (picked) choose(picked)
            else setGroup(event.target.value)
          }}
        />
        <datalist id={`${id}-groups`}>
          {groups.map((name) => (
            <option key={name} value={name} />
          ))}
          {[...allGroups.keys()]
            .filter((label) => allGroups.get(label)!.category !== category)
            .map((label) => (
              <option key={label} value={label} />
            ))}
        </datalist>
        {suggested.length > 0 && (
          <p className="collection-suggest" role="group" aria-label="Passende Gruppen">
            <span aria-hidden="true">Passende Gruppen:</span>
            {suggested.map((pick) => (
              <button key={`${pick.category}\u0000${pick.group}`} type="button" className="ghost collection-suggest-chip" onClick={() => choose(pick)}>
                {pick.group} · {pick.category}
              </button>
            ))}
          </p>
        )}
        <label htmlFor={`${id}-note`}>Notiz</label>
        <input id={`${id}-note`} type="text" value={note} placeholder="optional" onChange={(event) => setNote(event.target.value)} />
        <div className="dialog-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            Abbrechen
          </button>
          <button type="submit" className="primary" disabled={!text.trim()}>
            Aufnehmen
          </button>
        </div>
      </form>
    </div>
  )
}
