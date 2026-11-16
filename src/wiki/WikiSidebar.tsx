import { Link } from 'react-router-dom'
import type { WikiEntry, WikiFolder } from '../types'

interface Props {
  bookId: string
  folders: WikiFolder[]
  entries: WikiEntry[]
  activeEntryId?: string
  onNavigate: () => void
  onCreateFolder: (parentId: string | null) => void
  onCreateEntry: (folderId: string | null) => void
  onRenameFolder: (folder: WikiFolder) => void
  onDeleteFolder: (folder: WikiFolder) => void
}

export function WikiSidebar({
  bookId,
  folders,
  entries,
  activeEntryId,
  onNavigate,
  onCreateFolder,
  onCreateEntry,
  onRenameFolder,
  onDeleteFolder,
}: Props) {
  const folderIds = new Set(folders.map((folder) => folder.id))
  // Anything whose parent is missing is shown at the top level rather than hidden.
  const childFolders = (parentId: string | null) =>
    folders.filter((folder) =>
      parentId === null ? !folder.parentId || !folderIds.has(folder.parentId) : folder.parentId === parentId,
    )
  const childEntries = (folderId: string | null) =>
    entries.filter((entry) =>
      folderId === null ? !entry.folderId || !folderIds.has(entry.folderId) : entry.folderId === folderId,
    )

  const renderEntries = (folderId: string | null) =>
    childEntries(folderId).map((entry) => {
      const active = entry.id === activeEntryId
      return (
        <li key={entry.id} className={`wiki-tree-entry${active ? ' active' : ''}`}>
          <Link to={`/book/${bookId}/wiki/${entry.id}`} aria-current={active ? 'page' : undefined} onClick={onNavigate}>
            {entry.name}
          </Link>
        </li>
      )
    })

  const renderFolder = (folder: WikiFolder, depth: number) => (
    <li key={folder.id} data-folder={folder.id} className="wiki-tree-folder">
      <div className="wiki-tree-row">
        <span className="wiki-tree-name">{folder.name}</span>
        <button
          className="ghost icon"
          aria-label={`Eintrag in „${folder.name}" anlegen`}
          title="Neuer Eintrag in diesem Ordner"
          onClick={() => onCreateEntry(folder.id)}
        >
          +
        </button>
        {depth < 4 && (
          <button
            className="ghost icon"
            aria-label={`Unterordner in „${folder.name}" anlegen`}
            title="Neuer Unterordner"
            onClick={() => onCreateFolder(folder.id)}
          >
            ⊞
          </button>
        )}
        <button
          className="ghost icon"
          aria-label={`Ordner „${folder.name}" umbenennen`}
          title="Umbenennen"
          onClick={() => onRenameFolder(folder)}
        >
          ✎
        </button>
        <button
          className="ghost icon danger"
          aria-label={`Ordner „${folder.name}" löschen`}
          title="Löschen"
          onClick={() => onDeleteFolder(folder)}
        >
          ×
        </button>
      </div>
      <ul>
        {childFolders(folder.id).map((child) => renderFolder(child, depth + 1))}
        {renderEntries(folder.id)}
      </ul>
    </li>
  )

  const empty = folders.length === 0 && entries.length === 0

  return (
    <>
      {empty ? (
        <p className="muted sidebar-empty">Noch keine Einträge</p>
      ) : (
        <ul className="wiki-tree">
          {childFolders(null).map((folder) => renderFolder(folder, 0))}
          {renderEntries(null)}
        </ul>
      )}
      <div className="wiki-tree-actions">
        <button className="sidebar-add" onClick={() => onCreateEntry(null)}>
          Neuer Eintrag
        </button>
        <button className="sidebar-add" onClick={() => onCreateFolder(null)}>
          Neuer Ordner
        </button>
      </div>
    </>
  )
}
