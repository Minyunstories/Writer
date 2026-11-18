import type { Book, Chapter, WikiEntry } from '../types'
import { FormEditor } from './FormEditor'
import type { AddressChange } from '../types'
import { addressHistory, resolveAddress, type Resolved } from './resolve'

/** Column headings above a list of rows (hidden on a phone, where each value has its own label). */
export function AddressHead() {
  return (
    <div className="address-head" aria-hidden="true">
      <span />
      <span>Öffentlich / dienstlich</span>
      <span>Privat</span>
      <span />
    </div>
  )
}

/** Public and private in one line; private only when it differs. */
export const both = (item: { public: string; private: string }) => `${item.public || '–'}${item.private && item.private !== item.public ? ` · ${item.private}` : ''}`

/** A change not applied yet ("noch offen" or in a deleted chapter): the address it would give, its name and note. */
export function pendingText(change: AddressChange, resolved: Resolved, chapterOrder: string[]): string {
  const gone = !!change.chapterId && !chapterOrder.includes(change.chapterId)
  const form = { public: change.public || resolved.public, private: change.private || resolved.private }
  return `später${change.label ? ` (${change.label})` : ''}${gone ? ' – Kapitel gelöscht' : ''}: ${both(form)}${change.note ? ` (${change.note})` : ''}`
}

/** Where an address comes from, in words. */
export function sourceOf(resolved: Resolved): string {
  if (resolved.source === 'form') return 'Abweichung'
  if (resolved.source === 'rule') return `Regel: ${resolved.rankName}`
  return 'Kein Rang festgelegt'
}

interface Props {
  book: Book
  from: WikiEntry
  to: WikiEntry
  /** The name shown at the start of the row. */
  name: string
  chapters: Chapter[]
  chapterId: string | null
  editing: boolean
  onEdit: () => void
  onDone: (changed: boolean) => void
}

/** One direction: the address that holds, where it comes from, notes, what comes later; and its editor. */
export function AddressRow({ book, from, to, name, chapters, chapterId, editing, onEdit, onDone }: Props) {
  const order = chapters.map((chapter) => chapter.id)
  const titleOf = (id: string | null) => chapters.find((chapter) => chapter.id === id)?.title ?? ''
  const resolved = resolveAddress(book.address, from, to, order, chapterId)
  const current = chapterId ? order.indexOf(chapterId) : -1
  const later = addressHistory(book.address, from, to, order).filter((item) => item.chapterId && order.indexOf(item.chapterId) > current)
  return (
    <li className="address-row">
      <div className="address-row-main">
        <span className="address-row-name">{name}</span>
        <span className="address-row-public">
          <span className="address-cap">öffentlich</span>
          {resolved.public || '–'}
        </span>
        <span className="address-row-private">
          <span className="address-cap">privat</span>
          {resolved.private}
        </span>
        <button type="button" className="ghost icon address-edit" aria-label={`${from.name} spricht ${to.name} an – bearbeiten`} title="Bearbeiten" onClick={onEdit}>
          ✎
        </button>
      </div>
      <div className="address-row-meta">
        <span className="address-source">{sourceOf(resolved)}</span>
        {resolved.notes.map((note, index) => (
          <span key={index} className="address-note">
            {note.source === sourceOf(resolved) ? note.text : `${note.source}: ${note.text}`}
          </span>
        ))}
        {resolved.pending.map((change) => (
          <span key={change.id} className="address-later">
            {pendingText(change, resolved, order)}
          </span>
        ))}
        {later.map((item) => (
          <span key={item.chapterId} className="address-later">
            ab {titleOf(item.chapterId)}
            {item.label ? ` (${item.label})` : ''}: {item.public}
            {item.private !== item.public ? ` · ${item.private}` : ''}
          </span>
        ))}
      </div>
      {editing && <FormEditor book={book} from={from} to={to} chapters={chapters} chapterId={chapterId} onDone={onDone} />}
    </li>
  )
}
