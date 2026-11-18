import { useState } from 'react'
import type { Book, Chapter, WikiEntry, WikiFolder } from '../types'
import { AddressHead, both, pendingText, sourceOf } from './AddressRow'
import { FormEditor } from './FormEditor'
import { addressHistory, figuresOf, involved, resolveAddress } from './resolve'
import './address.css'

interface Props {
  book: Book
  entries: WikiEntry[]
  folders: WikiFolder[]
  chapters: Chapter[]
  /** The chapter open in the editor. */
  chapterId: string
  /** Wiki entries that appear in the open chapter, in order of appearance. */
  mentioned: string[]
  /** Who speaks; '' for nobody chosen. */
  speaker: string
  onSpeaker: (entryId: string) => void
  onChanged: () => void
}

/** One figure the speaker talks to: the address in this chapter; opened: the other way round and the history. */
function DrawerRow({ book, from, to, chapters, chapterId, onChanged }: { book: Book; from: WikiEntry; to: WikiEntry; chapters: Chapter[]; chapterId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const order = chapters.map((chapter) => chapter.id)
  const resolved = resolveAddress(book.address, from, to, order, chapterId)
  const back = resolveAddress(book.address, to, from, order, chapterId)
  const history = addressHistory(book.address, from, to, order)
  const current = order.indexOf(chapterId)
  let now = 0
  history.forEach((item, index) => {
    if (item.chapterId === null || order.indexOf(item.chapterId) <= current) now = index
  })
  const earlier = history.slice(0, now).flatMap((item, index) => {
    const end = chapters[order.indexOf(history[index + 1].chapterId!) - 1]
    return end ? [`bis ${end.title}: ${both(item)}`] : []
  })
  const later = history.slice(now + 1).map((item) => `ab ${chapters[order.indexOf(item.chapterId!)]?.title ?? ''}${item.label ? ` (${item.label})` : ''}: ${both(item)}`)
  return (
    <li className="address-row">
      <div className="address-row-main">
        <button type="button" className="address-row-name address-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          {to.name}
          <span className="address-caret" aria-hidden="true">
            {open ? ' ▾' : ' ▸'}
          </span>
        </button>
        <span className="address-row-public">
          <span className="address-cap">öffentlich</span>
          {resolved.public || '–'}
        </span>
        <span className="address-row-private">
          <span className="address-cap">privat</span>
          {resolved.private}
        </span>
        <button type="button" className="ghost icon address-edit" aria-label={`${from.name} spricht ${to.name} an – bearbeiten`} title="Bearbeiten" onClick={() => setEditing(!editing)}>
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
      </div>
      {open && (
        <div className="address-row-more">
          <span>
            {to.name} spricht {from.name} an: {both(back)}
          </span>
          {[...earlier, ...later].map((text) => (
            <span key={text} className="address-later">
              {text}
            </span>
          ))}
        </div>
      )}
      {editing && (
        <FormEditor
          book={book}
          from={from}
          to={to}
          chapters={chapters}
          chapterId={chapterId}
          onDone={(changed) => {
            setEditing(false)
            if (changed) onChanged()
          }}
        />
      )}
    </li>
  )
}

/** The address module in the drawer: who speaks, and how they address everyone in the chapter. */
export function AddressPanel({ book, entries, folders, chapters, chapterId, mentioned, speaker, onSpeaker, onChanged }: Props) {
  const [extra, setExtra] = useState<string[]>([])
  const address = book.address
  const figures = figuresOf(address, entries, folders)
  const byId = new Map(figures.map((figure) => [figure.id, figure]))
  const here = mentioned.flatMap((id) => byId.get(id) ?? [])
  const hereIds = new Set(here.map((figure) => figure.id))
  const elsewhere = figures.filter((figure) => !hereIds.has(figure.id) && involved(address, figure.id))
  const from = byId.get(speaker)
  const rows = from ? here.filter((figure) => figure.id !== from.id && involved(address, figure.id)) : []
  const rowIds = new Set(rows.map((figure) => figure.id))
  const looked = from ? extra.flatMap((id) => (id !== from.id && !rowIds.has(id) ? (byId.get(id) ?? []) : [])) : []
  const lookable = figures.filter((figure) => figure.id !== from?.id && !rowIds.has(figure.id) && !extra.includes(figure.id))

  return (
    <div className="address-panel">
      <div className="address-panel-bar">
        <label className="address-speaker">
          Wer spricht
          <select value={from ? from.id : ''} onChange={(event) => onSpeaker(event.target.value)}>
            <option value="">Figur wählen …</option>
            {here.length > 0 && (
              <optgroup label="In diesem Kapitel">
                {here.map((figure) => (
                  <option key={figure.id} value={figure.id}>
                    {figure.name}
                  </option>
                ))}
              </optgroup>
            )}
            {(elsewhere.length > 0 || (from && !hereIds.has(from.id) && !elsewhere.includes(from))) && (
              <optgroup label="Weitere">
                {[...elsewhere, ...(from && !hereIds.has(from.id) && !elsewhere.includes(from) ? [from] : [])].map((figure) => (
                  <option key={figure.id} value={figure.id}>
                    {figure.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      </div>
      {!from ? (
        <p className="muted address-empty">Wähle, wer spricht.</p>
      ) : (
        <>
          {rows.length === 0 && looked.length === 0 ? (
            <p className="muted address-empty">In diesem Kapitel kommt niemand mit Rang vor. Ränge legst du im Wiki unter „Anreden“ fest.</p>
          ) : (
            <>
            <AddressHead />
            <ul className="address-list" aria-label="Anreden im Kapitel">
              {[...rows, ...looked].map((to) => (
                <DrawerRow key={to.id} book={book} from={from} to={to} chapters={chapters} chapterId={chapterId} onChanged={onChanged} />
              ))}
            </ul>
            </>
          )}
          {lookable.length > 0 && (
            <label className="address-other">
              <span className="sr-only">Andere Figur</span>
              <select aria-label="Andere Figur" value="" onChange={(event) => event.target.value && setExtra([...extra, event.target.value])}>
                <option value="">Andere Figur …</option>
                {lookable.map((figure) => (
                  <option key={figure.id} value={figure.id}>
                    {figure.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
    </div>
  )
}
