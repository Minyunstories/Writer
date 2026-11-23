import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ZoomControl } from '../book/ZoomControl'
import { useZoom } from '../lib/zoom'
import { SYNCED_EVENT } from '../storage/connection'
import { ConflictError } from '../storage/connection'
import {
  addImage,
  createEntry,
  getEntry,
  getImage,
  removeImage,
  setPortrait,
  updateEntry,
  updateTemplateLayout,
  type EntryPatch,
  type TemplateLayout,
} from '../storage/wiki'
import { trashEntry } from '../storage/trash'
import { listChapters } from '../storage/db'
import { countName, RenameDialog } from './RenameDialog'
import type { Chapter, WikiEntry, WikiFolder, ZoomArea } from '../types'
import { ConfirmDialog } from '../ui/Dialogs'
import { prepareImage } from './image'
import { buildMatcher } from './linker'
import { PropertyBlocks } from './PropertyBlocks'
import { Timeline } from './Timeline'
import { MarkdownField } from './MarkdownField'
import { mentionsOf, topFolderOf } from './mentions'
import { createWikiLinks } from './wikiLinks'
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
  /** All entries of the book, for links between entries. */
  entries?: WikiEntry[]
  /** All chapters of the book, for "Erwähnt in". */
  chapters?: Chapter[]
  onOpenEntry?: (entryId: string) => void
  onOpenChapter?: (chapterId: string, range: { from: number; to: number }) => void
  /** After a rename: change the old name to the new one in every chapter (with a version first). */
  onReplaceName?: (oldName: string, newName: string) => Promise<void>
  /** A new entry: put the cursor in its name, with the placeholder name selected. */
  focusName?: boolean
  /** Marked with a star, e.g. a main character. */
  starred?: boolean
  onStar?: (starred: boolean) => void
  /** The entry's relationships, shown below the properties. */
  relations?: ReactNode
  /** The address module's section (rank, names, who addresses whom how), below the relationships. */
  address?: ReactNode
  /** The sketches module's „Auf Skizzen“, below the forms of address. */
  sketches?: ReactNode
}

const TIMELINE_KEY = 'mw:wiki-timeline'

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

/** An object URL for a stored image, released again when no longer shown. */
function useImageUrl(imageId: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    setUrl(undefined)
    if (!imageId) return
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
  return url
}

function Lightbox({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="dialog-backdrop wiki-lightbox" onClick={onClose}>
      <img src={url} alt={label} />
    </div>
  )
}

/** The entry's first image, large beside the name. */
function Portrait({ imageId, name }: { imageId: string; name: string }) {
  const url = useImageUrl(imageId)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="wiki-portrait" onClick={() => setOpen(true)} title="Vergrößern">
        <img src={url} alt={`Porträt von ${name}`} />
      </button>
      {open && url && <Lightbox url={url} label={`Porträt von ${name}`} onClose={() => setOpen(false)} />}
    </>
  )
}

interface ThumbnailProps {
  imageId: string
  label: string
  portrait: boolean
  onPortrait: () => void
  onRemove: () => void
}

function Thumbnail({ imageId, label, portrait, onPortrait, onRemove }: ThumbnailProps) {
  const url = useImageUrl(imageId)
  const [open, setOpen] = useState(false)

  return (
    <li className="wiki-image">
      <button className="wiki-image-open" onClick={() => setOpen(true)} title="Vergrößern">
        <img src={url} alt={label} />
      </button>
      {portrait ? (
        <span className="wiki-image-badge">Porträt</span>
      ) : (
        <button className="wiki-image-badge wiki-image-portrait" onClick={onPortrait} title="Dieses Bild neben dem Namen zeigen">
          Als Porträt
        </button>
      )}
      <button className="ghost icon wiki-image-remove" aria-label="Bild entfernen" title="Bild entfernen" onClick={onRemove}>
        ×
      </button>
      {open && url && <Lightbox url={url} label={label} onClose={() => setOpen(false)} />}
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
  entries,
  chapters,
  onOpenEntry,
  onOpenChapter,
  focusName = false,
  starred = false,
  onStar,
  relations,
  address,
  sketches,
  onReplaceName,
}: Props) {
  const [entry, setEntry] = useState<WikiEntry | null | undefined>(undefined)
  const nameRef = useRef<HTMLInputElement>(null)
  /** The name when the field was entered; on leaving it, a change may ask about the old name in the text. */
  const nameAtFocus = useRef<string | null>(null)
  const [renamed, setRenamed] = useState<{ oldName: string; newName: string; count: number } | null>(null)
  const nameFocused = useRef(false)
  const loaded = Boolean(entry)
  useEffect(() => {
    if (!focusName || !loaded || nameFocused.current) return
    nameFocused.current = true
    nameRef.current?.focus()
    nameRef.current?.select()
  }, [focusName, loaded])
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
  const onOpenEntryRef = useRef(onOpenEntry)
  onOpenEntryRef.current = onOpenEntry

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

  // Links to other entries: never to this one.
  const allMatcher = useMemo(() => buildMatcher(entries ?? []), [entries])
  const otherMatcher = useMemo(() => buildMatcher((entries ?? []).filter((item) => item.id !== entryId)), [entries, entryId])
  const notesLinks = useMemo(() => createWikiLinks({ onOpen: (id) => onOpenEntryRef.current?.(id) }), [])
  const notesExtensions = useMemo(() => [notesLinks.extension], [notesLinks])
  useEffect(() => notesLinks.setMatcher(otherMatcher), [notesLinks, otherMatcher])
  const [timeline, setTimeline] = useState(() => {
    try {
      return localStorage.getItem(TIMELINE_KEY) === 'true'
    } catch {
      return false
    }
  })
  const switchTimeline = (on: boolean) => {
    setTimeline(on)
    try {
      localStorage.setItem(TIMELINE_KEY, String(on))
    } catch {
      // Only a convenience.
    }
  }
  const mentions = useMemo(() => (chapters ? mentionsOf(entryId, chapters, allMatcher) : []), [chapters, entryId, allMatcher])

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

  // Template fields and starred blocks come from the entry's top-level folder.
  const top = topFolderOf(entry.folderId, folders)
  const layout: TemplateLayout | null = top
    ? { template: top.template ?? [], blocks: top.templateBlocks ?? [], groups: top.templateGroups ?? {} }
    : null
  const changeLayout = async (update: (layout: TemplateLayout) => TemplateLayout) => {
    if (!top) return
    try {
      await updateTemplateLayout(top.id, update)
      onChangedRef.current()
    } catch {
      setSaveFailed(true)
    }
  }

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

  const makePortrait = async (imageId: string) => {
    try {
      await setPortrait(imageId)
    } catch {
      setSaveFailed(true)
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
      await trashEntry(entryId)
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
          eigener Eintrag mit dem Zusatz „(meine Fassung)“ im Wiki.
          <button className="ghost" onClick={() => setReplaced(false)}>
            Verstanden
          </button>
        </p>
      )}

      <div className={entry.imageIds[0] ? 'wiki-entry-head with-portrait' : 'wiki-entry-head'}>
        <div className="wiki-entry-head-main">
          <div className="wiki-entry-title">
            <input
              ref={nameRef}
              className="wiki-entry-name"
              type="text"
              aria-label="Name"
              value={entry.name}
              onChange={(event) => change({ name: event.target.value })}
              onFocus={() => {
                nameAtFocus.current = entry.name
              }}
              onBlur={() => {
                if (!entry.name.trim()) change({ name: 'Unbenannt' })
                const before = nameAtFocus.current?.trim() ?? ''
                const after = entry.name.trim()
                nameAtFocus.current = null
                // A new entry's placeholder is no name to keep.
                if (!onReplaceName || !before || before === 'Unbenannt' || !after || after === before) return
                // Count in what is stored: the list handed in is not reloaded on every save.
                const bookId = entry.bookId
                void listChapters(bookId)
                  .then((stored) => {
                    const count = stored.reduce((sum, chapter) => sum + countName(chapter.content, before), 0)
                    if (count > 0) setRenamed({ oldName: before, newName: after, count })
                  })
                  .catch(() => {})
              }}
            />
            {onStar && (
              <button
                className={`ghost icon wiki-star${starred ? ' on' : ''}`}
                aria-pressed={starred}
                aria-label={starred ? 'Stern entfernen' : 'Mit Stern markieren'}
                title={starred ? 'Stern entfernen' : 'Mit Stern markieren, z. B. für Hauptfiguren'}
                onClick={() => onStar(!starred)}
              >
                {starred ? '★' : '☆'}
              </button>
            )}
          </div>

          <div className="wiki-field">
            <label htmlFor={`${ids}-alias`}>Auch bekannt als</label>
            <div className="wiki-aliases">
              {entry.aliases.map((alias) => (
                <span key={alias} className="wiki-chip">
                  {alias}
                  <button
                    className="ghost"
                    aria-label={`„${alias}“ entfernen`}
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
        </div>
        {entry.imageIds[0] && <Portrait imageId={entry.imageIds[0]} name={entry.name} />}
      </div>

      <PropertyBlocks
        properties={entry.properties}
        blocks={entry.blocks ?? []}
        layout={layout}
        folderName={top?.name ?? ''}
        matcher={otherMatcher}
        onOpen={onOpenEntry}
        onEntry={(patch) => change(patch)}
        onLayout={(update) => void changeLayout(update)}
      />

      {relations}

      {address}

      {sketches}

      <div className="wiki-field">
        <span className="wiki-label">Notizen</span>
        <MarkdownField
          key={`${entry.id}-${notesVersion}`}
          value={entry.body}
          ariaLabel="Notizen"
          placeholder="Freier Text …"
          onChange={(body) => change({ body })}
          extensions={notesExtensions}
        />
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
                portrait={index === 0}
                onPortrait={() => void makePortrait(imageId)}
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

      <label className="wiki-check">
        <input
          type="checkbox"
          checked={entry.autoLink}
          onChange={(event) => change({ autoLink: event.target.checked })}
        />
        Im Text automatisch verlinken
      </label>

      {chapters && (
        <div className="wiki-field">
          <span className="wiki-label-row">
            <span className="wiki-label" id={`${ids}-mentions`}>
              Erwähnt in
            </span>
            {mentions.length > 0 && (
              <span className="wiki-view-switch">
                <button className="ghost" aria-pressed={!timeline} onClick={() => switchTimeline(false)}>
                  Liste
                </button>
                <button className="ghost" aria-pressed={timeline} onClick={() => switchTimeline(true)}>
                  Zeitleiste
                </button>
              </span>
            )}
          </span>
          {mentions.length === 0 ? (
            <p className="muted wiki-none">Noch in keinem Kapitel erwähnt</p>
          ) : timeline ? (
            <Timeline name={entry.name} chapters={chapters} mentions={mentions} onOpen={onOpenChapter} />
          ) : (
            <ul className="wiki-mentions" aria-labelledby={`${ids}-mentions`}>
              {mentions.map((mention) => {
                const index = chapters.findIndex((chapter) => chapter.id === mention.chapterId)
                return (
                  <li key={mention.chapterId}>
                    <button onClick={() => onOpenChapter?.(mention.chapterId, mention.first)}>
                      <span className="wiki-mention-number">{index + 1}</span>
                      <span className="wiki-mention-title">{chapters[index].title}</span>
                      <span className="wiki-mention-count">{mention.count}×</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

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

      {renamed && (
        <RenameDialog
          {...renamed}
          onClose={() => setRenamed(null)}
          onKeepAlias={() => {
            // Already an alias: nothing to save (no new updatedAt for nothing).
            if (!entry.aliases.includes(renamed.oldName)) change({ aliases: [...entry.aliases, renamed.oldName] })
            setRenamed(null)
          }}
          onReplace={() => {
            setRenamed(null)
            void onReplaceName?.(renamed.oldName, renamed.newName)
          }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Eintrag „${entry.name}“ in den Papierkorb legen?`}
          detail="Dort kannst du ihn 30 Tage lang wiederherstellen."
          confirmLabel="In den Papierkorb"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  )
}
