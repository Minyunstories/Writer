import { useState, type ReactNode } from 'react'
import { createSketch, deleteSketch, renameSketch } from '../storage/sketches'
import type { Book, CustomStamp, WikiEntry } from '../types'
import { ConfirmDialog, PromptDialog } from '../ui/Dialogs'
import { SketchCanvas } from './SketchCanvas'

export type SketchesViewProps = {
  book: Book
  entries: WikiEntry[]
  stamps: CustomStamp[]
  /** Drawing tools (PC); without them the sketch can only be looked at (phone). */
  editable: boolean
  /** The chosen sketch (remembered per book); missing or gone: the first. */
  sketchId: string
  onSketch(id: string): void
  focus?: { x: number; y: number } | null
  onOpenEntry(id: string): void
  onChanged(): void
  /** More buttons in the bar (e.g. Vergrößern). */
  actions?: ReactNode
}

/** The choice of sketch with its buttons, and the chosen sketch: the same in the right panel and on the wiki page. */
export function SketchesView({ book, entries, stamps, editable, sketchId, onSketch, focus, onOpenEntry, onChanged, actions }: SketchesViewProps) {
  const sketches = book.sketches ?? []
  const current = sketches.find((sketch) => sketch.id === sketchId) ?? sketches[0]
  const [dialog, setDialog] = useState<'new' | 'rename' | 'delete' | null>(null)
  const [failed, setFailed] = useState(false)
  const attempt = (task: () => Promise<unknown>) =>
    void task().then(
      () => {
        setFailed(false)
        onChanged()
      },
      () => setFailed(true),
    )

  return (
    <div className="sketches">
      <div className="sketches-bar">
        {sketches.length > 0 && (
          <select aria-label="Skizze" value={current?.id} onChange={(event) => onSketch(event.target.value)}>
            {sketches.map((sketch) => (
              <option key={sketch.id} value={sketch.id}>
                {sketch.name}
              </option>
            ))}
          </select>
        )}
        {editable && (
          <button className="ghost" onClick={() => setDialog('new')}>
            Neue Skizze
          </button>
        )}
        {editable && current && (
          <>
            <button className="ghost" onClick={() => setDialog('rename')}>
              Umbenennen
            </button>
            <button className="ghost danger" onClick={() => setDialog('delete')}>
              Löschen
            </button>
          </>
        )}
        <span className="sketches-bar-space" />
        {actions}
      </div>
      {failed && (
        <p className="muted sketches-error" role="alert">
          Das hat nicht geklappt. Bitte noch einmal versuchen.
        </p>
      )}

      {current ? (
        <SketchCanvas key={current.id} bookId={book.id} sketch={current} entries={entries} stamps={stamps} editable={editable} focus={focus} onOpenEntry={onOpenEntry} onChanged={onChanged} />
      ) : (
        <p className="muted sketches-none">{editable ? 'Noch keine Skizzen.' : 'Noch keine Skizzen. Gezeichnet wird am PC.'}</p>
      )}

      {dialog === 'new' && (
        <PromptDialog
          heading="Neue Skizze"
          confirmLabel="Anlegen"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => {
            setDialog(null)
            attempt(async () => onSketch((await createSketch(book.id, name)).id))
          }}
        />
      )}
      {dialog === 'rename' && current && (
        <PromptDialog
          heading="Skizze umbenennen"
          initialValue={current.name}
          confirmLabel="Umbenennen"
          onCancel={() => setDialog(null)}
          onConfirm={(name) => {
            setDialog(null)
            attempt(() => renameSketch(book.id, current.id, name))
          }}
        />
      )}
      {dialog === 'delete' && current && (
        <ConfirmDialog
          message="Skizze löschen?"
          detail={`„${current.name}“ mit allen Strichen und Stempeln. Das lässt sich nicht rückgängig machen.`}
          confirmLabel="Löschen"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            attempt(() => deleteSketch(book.id, current.id))
          }}
        />
      )}
    </div>
  )
}
