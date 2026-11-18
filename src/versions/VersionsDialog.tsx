import { diffWordsWithSpace, type ChangeObject } from 'diff'
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { countWords } from '../lib/wordCount'
import { deleteVersion, listVersions, renameVersion, saveVersion, VERSION_EVENT } from '../storage/versions'
import type { Chapter, ChapterVersion } from '../types'
import './versions.css'

interface Props {
  chapter: Pick<Chapter, 'id' | 'bookId' | 'title'>
  /** The text as it is in the editor right now. */
  current: () => string
  /** Puts a version's text into the editor (undo brings the previous text back). */
  onRestore: (content: string) => void
  onClose: () => void
}

const when = (time: number) =>
  new Date(time).toLocaleString('de-DE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Comparing very long, very different texts could take long: then the version is shown plain. */
const DIFF_TIMEOUT = 1500

function Comparison({ before, now }: { before: string; now: string }) {
  const parts = useMemo<ChangeObject<string>[] | undefined>(() => diffWordsWithSpace(before, now, { timeout: DIFF_TIMEOUT }), [before, now])
  if (!parts) return <div className="versions-text">{before}</div>
  if (parts.every((part) => !part.added && !part.removed)) return <div className="versions-text">{before}<p className="muted versions-same">Gleich wie jetzt.</p></div>
  return (
    <div className="versions-text">
      {parts.map((part, index) =>
        part.removed ? <del key={index}>{part.value}</del> : part.added ? <ins key={index}>{part.value}</ins> : <span key={index}>{part.value}</span>,
      )}
    </div>
  )
}

/** Saved states of a chapter: save one now, compare one with the text, bring one back. */
export function VersionsDialog({ chapter, current, onRestore, onClose }: Props) {
  const [versions, setVersions] = useState<ChapterVersion[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [rename, setRename] = useState('')
  const [failed, setFailed] = useState(false)
  const [now] = useState(current)

  const load = useCallback(() => {
    listVersions(chapter.id).then(setVersions, () => setFailed(true))
  }, [chapter.id])
  useEffect(() => {
    load()
    const onChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === chapter.id) load()
    }
    window.addEventListener(VERSION_EVENT, onChange)
    return () => window.removeEventListener(VERSION_EVENT, onChange)
  }, [chapter.id, load])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const selected = versions?.find((version) => version.id === selectedId)
  useEffect(() => setRename(selected?.label ?? ''), [selected?.id, selected?.label])

  const attempt = (action: () => Promise<unknown>) =>
    void action().then(
      () => setFailed(false),
      () => setFailed(true),
    )

  const save = (event: FormEvent) => {
    event.preventDefault()
    attempt(async () => {
      const version = await saveVersion(chapter, current(), name)
      setName('')
      setSelectedId(version.id)
    })
  }

  const restore = (version: ChapterVersion) =>
    attempt(async () => {
      const text = current()
      if (text !== version.content) await saveVersion(chapter, text, 'Vor dem Wiederherstellen')
      onRestore(version.content)
      onClose()
    })

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="dialog versions-dialog" role="dialog" aria-modal="true" aria-label={`Fassungen von „${chapter.title}“`}>
        <header className="versions-header">
          <h2>Fassungen von „{chapter.title}“</h2>
          <button className="ghost" onClick={onClose}>
            Schließen
          </button>
        </header>
        <form className="versions-save" onSubmit={save}>
          <input type="text" aria-label="Name der Fassung" placeholder="Name, z. B. „Vor der Überarbeitung“ (optional)" value={name} onChange={(event) => setName(event.target.value)} />
          <button type="submit" className="primary">
            Jetzt sichern
          </button>
        </form>
        {failed && <p className="versions-error">Das hat nicht geklappt. Bitte noch einmal versuchen.</p>}
        <div className="versions-body">
          <ul className="versions-list" aria-label="Gesicherte Fassungen">
            {versions?.length === 0 && <li className="muted versions-empty">Noch keine Fassungen. Beim Öffnen eines Kapitels sichert Writer den Stand von selbst, höchstens alle 10 Minuten.</li>}
            {versions?.map((version) => (
              <li key={version.id}>
                <button className={version.id === selectedId ? 'versions-item selected' : 'versions-item'} aria-pressed={version.id === selectedId} onClick={() => setSelectedId(version.id)}>
                  <span className="versions-item-name">{version.label ?? (version.auto ? 'Automatisch' : 'Ohne Namen')}</span>
                  <span className="muted versions-item-meta">
                    {when(version.createdAt)} · {countWords(version.content)} Wörter{version.auto && version.label ? ' · automatisch' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <section className="versions-preview" aria-label="Vergleich mit dem jetzigen Text">
            {selected ? (
              <>
                <div className="versions-actions">
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      attempt(() => renameVersion(selected.id, rename))
                    }}
                  >
                    <input type="text" aria-label="Name dieser Fassung" placeholder="Name" value={rename} onChange={(event) => setRename(event.target.value)} onBlur={() => rename !== (selected.label ?? '') && attempt(() => renameVersion(selected.id, rename))} />
                  </form>
                  <button className="primary" onClick={() => restore(selected)}>
                    Diese Fassung wiederherstellen
                  </button>
                  <button
                    className="ghost danger"
                    onClick={() =>
                      attempt(async () => {
                        await deleteVersion(selected.id)
                        setSelectedId(null)
                      })
                    }
                  >
                    Löschen
                  </button>
                </div>
                <p className="muted versions-legend">
                  <del>durchgestrichen</del>: nur in dieser Fassung · <ins>unterstrichen</ins>: seitdem neu
                </p>
                <Comparison before={selected.content} now={now} />
              </>
            ) : (
              <p className="muted versions-hint">Wähle links eine Fassung, um sie mit dem jetzigen Text zu vergleichen.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
