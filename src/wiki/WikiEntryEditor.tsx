import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ZoomControl } from '../book/ZoomControl'
import { useZoom } from '../lib/zoom'
import { SYNCED_EVENT } from '../storage/connection'
import { ConflictError } from '../storage/connection'
import {
  addImage,
  createEntry,
  deleteEntry,
  getEntry,
  getImage,
  removeImage,
  updateEntry,
  type EntryPatch,
} from '../storage/wiki'
import type { WikiEntry, WikiFolder, WikiProperty, ZoomArea } from '../types'
import { ConfirmDialog } from '../ui/Dialogs'
import { prepareImage } from './image'
import { MarkdownField } from './MarkdownField'
import './wiki.css'

const SAVE_DELAY = 400
const RETRY_DELAY = 2000

interface Props {
  entryId: string
  folders: WikiFolder[]
  zoomArea: ZoomArea
  /** Called after every stored change. */
  onChanged: () => void
  onDeleted: () => void
  /** Called when a save fails after this editor was closed, so the failure is still shown somewhere. */
  onSaveFailed?: () => void
  prepare?: typeof prepareImage
}

/** Folders as a flat list with their full path, e.g. "Welt / Orte". */
export function folderPaths(folders: WikiFolder[]): { id: string; path: string }[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const pathOf = (folder: WikiFolder): string => {
    const parts: string[] = []
    const seen = new Set<string>()
    for (let current: WikiFolder | undefined = folder; current && !seen.has(current.id); ) {
      seen.add(current.id)
      parts.unshift(current.name)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
    return parts.join(' / ')
  }
  return folders
    .map((folder) => ({ id: folder.id, path: pathOf(folder) }))
    .sort((a, b) => a.path.localeCompare(b.path, 'de'))
}

function Thumbnail({ imageId, label, onRemove }: { imageId: string; label: string; onRemove: () => void }) {
  const [url, setUrl] = useState<string>()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let created: string | undefined
    let cancelled = false
    void getImage(imageId).then((image) => {
      if (cancelled || !image || typeof URL.createObjectURL !== 'function') return
      created = URL.createObjectURL(new Blob([image.data], { type: image.type }))
      setUrl(created)
    })
    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [imageId])

  return (
    <li className="wiki-image">
      <button className="wiki-image-open" onClick={() => setOpen(true)} title="Vergrößern">
        <img src={url} alt={label} />
      </button>
      <button className="ghost icon wiki-image-remove" aria-label="Bild entfernen" title="Bild entfernen" onClick={onRemove}>
        ×
      </button>
      {open && url && (
        <div className="dialog-backdrop wiki-lightbox" onClick={() => setOpen(false)}>
          <img src={url} alt={label} />
        </div>
      )}
    </li>
  )
}

export function WikiEntryEditor({
  entryId,
  folders,
  zoomArea,
  onChanged,
  onDeleted,
  onSaveFailed,
  prepare = prepareImage,
}: Props) {
  const [entry, setEntry] = useState<WikiEntry | null | undefined>(undefined)
  const [aliasDraft, setAliasDraft] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** Bumped when the notes were replaced from storage, so the notes field starts over with the new text. */
  const [notesVersion, setNotesVersion] = useState(0)
  const [imageToRemove, setImageToRemove] = useState<string | null>(null)
  const [zoom] = useZoom(zoomArea)
  const ids = useId()

  const pending = useRef<EntryPatch>({})
  /** The entry as shown, for use outside of render. */
  const entryRef = useRef<WikiEntry | null>(null)
  /** The stored entry's change time as this editor last saw it. */
  const expected = useRef<number | undefined>(undefined)
  const [replaced, setReplaced] = useState(false)
  const timer = useRef<number>()
  const running = useRef<Promise<void> | null>(null)
  const mounted = useRef(true)
  const deleted = useRef(false)
  const onChangedRef = useRef(onChanged)
  onChangedRef.current = onChanged
  const onSaveFailedRef = useRef(onSaveFailed)
  onSaveFailedRef.current = onSaveFailed

  /**
   * The entry was changed elsewhere (another tab or a sync run) while it was edited here.
   * Nothing is overwritten: what is on screen becomes its own entry, and the editor shows the stored one.
   */
  const keepMineAsCopy = async (patch: EntryPatch) => {
    const mine = entryRef.current ? { ...entryRef.current, ...patch, ...pending.current } : null
    pending.current = {}
    try {
      if (mine) {
        const copy = await createEntry(mine.bookId, `${mine.name.trim() || 'Unbenannt'} (meine Fassung)`, mine.folderId)
        await updateEntry(copy.id, { aliases: mine.aliases, properties: mine.properties, body: mine.body, autoLink: false })
      }
      const stored = await getEntry(entryId)
      expected.current = stored?.updatedAt
      if (mounted.current) {
        setEntry(stored ?? null)
        setNotesVersion((version) => version + 1)
        setReplaced(true)
      }
      onChangedRef.current()
    } catch {
      if (mounted.current) setSaveFailed(true)
      else onSaveFailedRef.current?.()
    }
  }

  // Saves run strictly one after another, so a failed save can never be retried
  // on top of a newer one that already succeeded.
  const flush = useCallback(async (): Promise<void> => {
    window.clearTimeout(timer.current)
    while (running.current) await running.current
    const patch = pending.current
    if (Object.keys(patch).length === 0 || deleted.current) return
    pending.current = {}
    const run = (async () => {
      try {
        const stored = await updateEntry(entryId, patch, { expectedUpdatedAt: expected.current })
        expected.current = stored.updatedAt
        if (mounted.current) setSaveFailed(false)
        onChangedRef.current()
      } catch (error) {
        if (error instanceof ConflictError) {
          await keepMineAsCopy(patch)
          return
        }
        // Nothing was stored. Keep it, but let edits made in the meantime win.
        pending.current = { ...patch, ...pending.current }
        if (mounted.current) setSaveFailed(true)
        else onSaveFailedRef.current?.()
        timer.current = window.setTimeout(() => void flush(), RETRY_DELAY)
      }
    })()
    running.current = run
    await run
    if (running.current === run) running.current = null
  }, [entryId])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const change = (patch: EntryPatch) => {
    setEntry((current) => (current ? { ...current, ...patch } : current))
    pending.current = { ...pending.current, ...patch }
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void flush(), SAVE_DELAY)
  }

  useEffect(() => {
    let cancelled = false
    void getEntry(entryId).then(
      (loaded) => {
        if (cancelled) return
        expected.current = loaded?.updatedAt
        setEntry(loaded ?? null)
      },
      () => !cancelled && setEntry(null),
    )
    return () => {
      cancelled = true
      void flush()
    }
  }, [entryId, flush])

  useEffect(() => {
    const onHide = () => void flush()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [flush])

  // A sync run may have changed this entry; show the new state unless something is being typed.
  useEffect(() => {
    const onSynced = () => {
      if (Object.keys(pending.current).length > 0 || running.current) return
      void getEntry(entryId).then((loaded) => {
        if (!loaded || Object.keys(pending.current).length > 0) return
        expected.current = loaded.updatedAt
        setEntry((current) => {
          if (current && current.body !== loaded.body) setNotesVersion((version) => version + 1)
          return loaded
        })
      })
    }
    window.addEventListener(SYNCED_EVENT, onSynced)
    return () => window.removeEventListener(SYNCED_EVENT, onSynced)
  }, [entryId])

  const paths = useMemo(() => folderPaths(folders), [folders])

  entryRef.current = entry ?? null

  if (entry === undefined) return <p className="wiki-entry-message muted">Lädt …</p>
  if (entry === null) return <p className="wiki-entry-message muted">Eintrag nicht gefunden</p>

  const addAlias = () => {
    const alias = aliasDraft.trim()
    setAliasDraft('')
    if (!alias || entry.aliases.includes(alias)) return
    change({ aliases: [...entry.aliases, alias] })
  }

  const onAliasKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addAlias()
    }
  }

  const setProperty = (id: string, patch: Partial<WikiProperty>) =>
    change({ properties: entry.properties.map((p) => (p.id === id ? { ...p, ...patch } : p)) })

  const reloadImages = async () => {
    const stored = await getEntry(entryId)
    if (stored) {
      // Attaching or removing an image is this editor's own change to the entry.
      expected.current = stored.updatedAt
      setEntry((current) => (current ? { ...current, imageIds: stored.imageIds } : current))
    }
    onChangedRef.current()
  }

  const attach = async (files: FileList | null) => {
    if (!files) return
    setImageError(false)
    for (const file of Array.from(files)) {
      try {
        await addImage(entryId, await prepare(file))
      } catch {
        setImageError(true)
      }
    }
    await reloadImages()
  }

  const detach = async (imageId: string) => {
    try {
      await removeImage(imageId)
    } catch {
      setSaveFailed(true)
    }
    await reloadImages()
  }

  const remove = async () => {
    setConfirmDelete(false)
    deleted.current = true
    window.clearTimeout(timer.current)
    try {
      await deleteEntry(entryId)
      onDeleted()
    } catch {
      deleted.current = false
      setSaveFailed(true)
    }
  }

  return (
    <div className="wiki-entry" style={{ fontSize: `calc(15px * ${zoom / 100})` }}>
      <div className="wiki-entry-tools">
        <ZoomControl area={zoomArea} />
      </div>

      {saveFailed && (
        <p className="status-error" role="alert">
          Speichern fehlgeschlagen, neuer Versuch läuft.
        </p>
      )}

      {replaced && (
        <p className="wiki-replaced" role="alert">
          Dieser Eintrag wurde an anderer Stelle geändert. Du siehst jetzt den gespeicherten Stand; deine Fassung steht als
          eigener Eintrag mit dem Zusatz „(meine Fassung)" im Wiki.
          <button className="ghost" onClick={() => setReplaced(false)}>
            Verstanden
          </button>
        </p>
      )}

      <input
        className="wiki-entry-name"
        type="text"
        aria-label="Name"
        value={entry.name}
        onChange={(event) => change({ name: event.target.value })}
        onBlur={() => {
          if (!entry.name.trim()) change({ name: 'Unbenannt' })
        }}
      />

      <div className="wiki-field">
        <label htmlFor={`${ids}-alias`}>Auch bekannt als</label>
        <div className="wiki-aliases">
          {entry.aliases.map((alias) => (
            <span key={alias} className="wiki-chip">
              {alias}
              <button
                className="ghost"
                aria-label={`„${alias}" entfernen`}
                onClick={() => change({ aliases: entry.aliases.filter((a) => a !== alias) })}
              >
                ×
              </button>
            </span>
          ))}
          <input
            id={`${ids}-alias`}
            type="text"
            value={aliasDraft}
            placeholder="Name eingeben, Enter"
            enterKeyHint="done"
            onChange={(event) => setAliasDraft(event.target.value)}
            onKeyDown={onAliasKey}
            onBlur={addAlias}
          />
        </div>
      </div>

      <div className="wiki-field wiki-field-row">
        <label htmlFor={`${ids}-folder`}>Ordner</label>
        <select
          id={`${ids}-folder`}
          value={entry.folderId ?? ''}
          onChange={(event) => change({ folderId: event.target.value || null })}
        >
          <option value="">Kein Ordner</option>
          {paths.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.path}
            </option>
          ))}
        </select>
      </div>

      <div className="wiki-field">
        <span className="wiki-label">Eigenschaften</span>
        {entry.properties.length > 0 && (
          <ul className="wiki-properties">
            {entry.properties.map((property) => (
              <li key={property.id}>
                <input
                  type="text"
                  aria-label="Eigenschaft"
                  placeholder="z. B. Augenfarbe"
                  value={property.key}
                  onChange={(event) => setProperty(property.id, { key: event.target.value })}
                />
                <input
                  type="text"
                  aria-label="Wert"
                  placeholder="Wert"
                  value={property.value}
                  onChange={(event) => setProperty(property.id, { value: event.target.value })}
                />
                <button
                  className="ghost icon"
                  aria-label="Eigenschaft entfernen"
                  title="Eigenschaft entfernen"
                  onClick={() => change({ properties: entry.properties.filter((p) => p.id !== property.id) })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          className="wiki-add"
          onClick={() =>
            change({ properties: [...entry.properties, { id: crypto.randomUUID(), key: '', value: '' }] })
          }
        >
          Eigenschaft hinzufügen
        </button>
      </div>

      <div className="wiki-field">
        <span className="wiki-label">Bilder</span>
        {entry.imageIds.length > 0 && (
          <ul className="wiki-images">
            {entry.imageIds.map((imageId, index) => (
              <Thumbnail
                key={imageId}
                imageId={imageId}
                label={`Bild ${index + 1} von ${entry.name}`}
                onRemove={() => setImageToRemove(imageId)}
              />
            ))}
          </ul>
        )}
        {imageError && (
          <p className="status-error" role="alert">
            Das Bild konnte nicht gelesen werden.
          </p>
        )}
        <label className="wiki-add wiki-upload">
          Bild hinzufügen
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="Bild hinzufügen"
            onChange={(event) => {
              const files = event.target.files
              void attach(files).finally(() => {
                event.target.value = ''
              })
            }}
          />
        </label>
      </div>

      <div className="wiki-field">
        <span className="wiki-label">Notizen</span>
        <MarkdownField
          key={`${entry.id}-${notesVersion}`}
          value={entry.body}
          ariaLabel="Notizen"
          placeholder="Freier Text …"
          onChange={(body) => change({ body })}
        />
      </div>

      <label className="wiki-check">
        <input
          type="checkbox"
          checked={entry.autoLink}
          onChange={(event) => change({ autoLink: event.target.checked })}
        />
        Im Text automatisch verlinken
      </label>

      <div className="wiki-entry-footer">
        <button className="ghost danger" onClick={() => setConfirmDelete(true)}>
          Eintrag löschen
        </button>
      </div>

      {imageToRemove && (
        <ConfirmDialog
          message="Bild wirklich löschen?"
          confirmLabel="Bild löschen"
          onCancel={() => setImageToRemove(null)}
          onConfirm={() => {
            const imageId = imageToRemove
            setImageToRemove(null)
            void detach(imageId)
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Eintrag „${entry.name}" wirklich löschen?`}
          confirmLabel="Endgültig löschen"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  )
}
