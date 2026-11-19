import { useState, type CSSProperties, type DragEvent, type ReactNode } from 'react'
import { COVERS } from '../lib/bookStyle'
import { Link } from 'react-router-dom'
import type { WikiItem } from '../storage/wiki'
import type { WikiEntry, WikiFolder } from '../types'
import { orderedChildren, starredFirst } from './order'

/** A private drag type: nothing that accepts text takes it, and nothing else is taken here. */
const DRAG_TYPE = 'application/x-writer-wiki'

interface Props {
  bookId: string
  folders: WikiFolder[]
  entries: WikiEntry[]
  /** The writer's order (Book.wikiOrder). */
  order?: Record<string, string[]>
  /** Starred entries (Book.wikiStars): first in their folder, with a star. */
  stars?: string[]
  activeEntryId?: string
  onNavigate: () => void
  onCreateFolder: (parentId: string | null) => void
  onCreateEntry: (folderId: string | null) => void
  onRenameFolder: (folder: WikiFolder) => void
  onDeleteFolder: (folder: WikiFolder) => void
  /** Into a folder (null: top level), before an item of the same kind or at the end. */
  onMove?: (item: WikiItem, target: { parentId: string | null; beforeId: string | null }) => void
  onStep?: (item: WikiItem, direction: 'up' | 'down') => void
  /** Sets or clears (null) the colour of a top-level folder. */
  onColor?: (folderId: string, color: string | null) => void
}

export function WikiSidebar({
  bookId,
  folders,
  entries,
  order,
  stars,
  activeEntryId,
  onNavigate,
  onCreateFolder,
  onCreateEntry,
  onRenameFolder,
  onDeleteFolder,
  onMove,
  onStep,
  onColor,
}: Props) {
  const [arranging, setArranging] = useState(false)
  const [palette, setPalette] = useState<string | null>(null)
  const [dragging, setDragging] = useState<WikiItem | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const folderIds = new Set(folders.map((folder) => folder.id))
  const parentOf = (id: string | null | undefined) => (id && folderIds.has(id) ? id : null)

  /** Drag source and drop target for one row. */
  const dragProps = (item: WikiItem, drop: () => { parentId: string | null; beforeId: string | null }) => ({
    draggable: Boolean(onMove),
    onDragStart: (event: DragEvent) => {
      event.stopPropagation()
      event.dataTransfer?.setData(DRAG_TYPE, JSON.stringify(item))
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
      setDragging(item)
    },
    onDragEnd: () => {
      setDragging(null)
      setOver(null)
    },
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return
      event.preventDefault()
      event.stopPropagation()
      setOver(item.id)
    },
    onDragLeave: () => setOver((current) => (current === item.id ? null : current)),
    onDrop: (event: DragEvent) => {
      const raw = event.dataTransfer?.getData(DRAG_TYPE)
      if (!raw) return
      event.preventDefault()
      event.stopPropagation()
      setOver(null)
      setDragging(null)
      const moved = JSON.parse(raw) as WikiItem
      if (moved.id !== item.id) onMove?.(moved, drop())
    },
  })

  const arrows = (item: WikiItem, name: string, index: number, count: number) => (
    <>
      <button
        className="ghost icon"
        aria-label={`${name} nach oben`}
        title="Nach oben"
        disabled={index === 0}
        onClick={() => onStep?.(item, 'up')}
      >
        ↑
      </button>
      <button
        className="ghost icon"
        aria-label={`${name} nach unten`}
        title="Nach unten"
        disabled={index === count - 1}
        onClick={() => onStep?.(item, 'down')}
      >
        ↓
      </button>
    </>
  )

  const renderChildren = (parentId: string | null, depth: number, color?: string): ReactNode => {
    const kids = orderedChildren(parentId, folders, entries, order)
    return (
      <>
        {kids.folders.map((folder, index) => renderFolder(folder, depth, index, kids.folders.length, color))}
        {starredFirst(kids.entries, stars).map((entry, index) => {
          const active = entry.id === activeEntryId
          const starred = stars?.includes(entry.id)
          const item: WikiItem = { kind: 'entry', id: entry.id }
          return (
            <li key={entry.id} className={`wiki-tree-entry${active ? ' active' : ''}`}>
              <div
                className={`wiki-tree-entry-row${over === entry.id ? ' drop-before' : ''}`}
                {...dragProps(item, () => ({ parentId: parentOf(entry.folderId), beforeId: entry.id }))}
              >
                <Link
                  to={`/book/${bookId}/wiki/${entry.id}`}
                  aria-current={active ? 'page' : undefined}
                  draggable={false}
                  onClick={onNavigate}
                >
                  {starred && <span className="wiki-tree-star">★ </span>}
                  {entry.name}
                </Link>
                {arranging && arrows(item, entry.name, index, kids.entries.length)}
              </div>
            </li>
          )
        })}
      </>
    )
  }

  const renderFolder = (folder: WikiFolder, depth: number, index: number, count: number, color?: string) => {
    const item: WikiItem = { kind: 'folder', id: folder.id }
    // Subfolders take the colour of their top-level folder.
    const tint = depth === 0 ? folder.color : color
    const label = `Farbe für „${folder.name}“`
    return (
      <li key={folder.id} data-folder={folder.id} className={`wiki-tree-folder depth-${Math.min(depth, 2)}`}>
        <div
          className={`wiki-tree-row${over === folder.id ? ' drop-into' : ''}${tint ? ' coloured' : ''}`}
          style={tint ? ({ '--folder': tint } as CSSProperties) : undefined}
          {...dragProps(item, () => ({ parentId: folder.id, beforeId: null }))}
        >
          <span className="wiki-tree-name">{folder.name}</span>
          {depth === 0 && onColor && !arranging && (
            <button
              className="ghost icon wiki-folder-color"
              aria-label={label}
              title="Farbe"
              aria-expanded={palette === folder.id}
              onClick={() => setPalette((open) => (open === folder.id ? null : folder.id))}
            >
              <span className="wiki-folder-dot" aria-hidden="true" />
            </button>
          )}
          {arranging ? (
            arrows(item, folder.name, index, count)
          ) : (
            <>
              <button
                className="ghost icon"
                aria-label={`Eintrag in „${folder.name}“ anlegen`}
                title="Neuer Eintrag in diesem Ordner"
                onClick={() => onCreateEntry(folder.id)}
              >
                +
              </button>
              {depth < 4 && (
                <button
                  className="ghost icon"
                  aria-label={`Unterordner in „${folder.name}“ anlegen`}
                  title="Neuer Unterordner"
                  onClick={() => onCreateFolder(folder.id)}
                >
                  ⊞
                </button>
              )}
              <button
                className="ghost icon"
                aria-label={`Ordner „${folder.name}“ umbenennen`}
                title="Umbenennen"
                onClick={() => onRenameFolder(folder)}
              >
                ✎
              </button>
              <button
                className="ghost icon danger"
                aria-label={`Ordner „${folder.name}“ löschen`}
                title="Löschen"
                onClick={() => onDeleteFolder(folder)}
              >
                ×
              </button>
            </>
          )}
        </div>
        {palette === folder.id && (
          <div className="wiki-folder-palette" role="dialog" aria-label={label}>
            {COVERS.map((swatch) => (
              <button
                key={swatch.color}
                className="book-menu-swatch"
                aria-label={swatch.name}
                title={swatch.name}
                aria-pressed={folder.color === swatch.color}
                style={{ background: swatch.color }}
                onClick={() => {
                  setPalette(null)
                  onColor?.(folder.id, swatch.color)
                }}
              />
            ))}
            <button
              className="ghost wiki-folder-nocolor"
              onClick={() => {
                setPalette(null)
                onColor?.(folder.id, null)
              }}
            >
              Keine Farbe
            </button>
          </div>
        )}
        <ul>{renderChildren(folder.id, depth + 1, tint)}</ul>
      </li>
    )
  }

  const empty = folders.length === 0 && entries.length === 0

  return (
    <>
      {empty ? (
        <p className="muted sidebar-empty">Noch keine Einträge</p>
      ) : (
        <ul className={`wiki-tree${arranging ? ' arranging' : ''}`}>{renderChildren(null, 0)}</ul>
      )}
      {dragging && (
        <div
          className={`wiki-tree-root-drop${over === '_root' ? ' active' : ''}`}
          onDragOver={(event) => {
            if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return
            event.preventDefault()
            setOver('_root')
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(event) => {
            const raw = event.dataTransfer?.getData(DRAG_TYPE)
            if (!raw) return
            event.preventDefault()
            setOver(null)
            setDragging(null)
            onMove?.(JSON.parse(raw) as WikiItem, { parentId: null, beforeId: null })
          }}
        >
          Hier ablegen: oberste Ebene
        </div>
      )}
      <div className="wiki-tree-actions">
        <button className="sidebar-add" onClick={() => onCreateEntry(null)}>
          Neuer Eintrag
        </button>
        <button className="sidebar-add" onClick={() => onCreateFolder(null)}>
          Neuer Ordner
        </button>
        {!empty && onStep && (
          <button className={`sidebar-add wiki-tree-arrange${arranging ? ' on' : ''}`} onClick={() => setArranging((on) => !on)}>
            {arranging ? 'Fertig' : 'Anordnen'}
          </button>
        )}
      </div>
    </>
  )
}
