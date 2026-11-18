import type { IDBPTransaction } from 'idb'
import type { Book, WikiEntry, WikiFolder, WikiImage } from '../types'
import { isColor } from '../lib/bookStyle'
import { orderedChildren, orderKey } from '../wiki/order'
import { announceChange, cleanList, cleanTitle, ConflictError, db, newId, type Schema } from './connection'

/** The deepest folder level (0 is the top). */
const MAX_FOLDER_DEPTH = 4

type OrderTx = IDBPTransaction<Schema, ('books' | 'wikiFolders' | 'wikiEntries')[], 'readwrite'>

/** Puts a new folder or entry at the end of its folder in the book's wiki order. */
async function appendToOrder(tx: OrderTx, bookId: string, item: { kind: 'folder' | 'entry'; id: string }, parentId: string | null) {
  const book = await tx.objectStore('books').get(bookId)
  if (!book) return
  const folders = (await tx.objectStore('wikiFolders').index('bookId').getAll(bookId)).filter((folder) => folder.id !== item.id)
  const entries = (await tx.objectStore('wikiEntries').index('bookId').getAll(bookId)).filter((entry) => entry.id !== item.id)
  const kids = orderedChildren(parentId, folders, entries, book.wikiOrder)
  const folderIds = kids.folders.map((folder) => folder.id)
  const entryIds = kids.entries.map((entry) => entry.id)
  if (item.kind === 'folder') folderIds.push(item.id)
  else entryIds.push(item.id)
  await tx.objectStore('books').put({ ...book, wikiOrder: { ...book.wikiOrder, [orderKey(parentId)]: [...folderIds, ...entryIds] } })
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'de')

const cleanAliases = cleanList

export async function listFolders(bookId: string): Promise<WikiFolder[]> {
  return (await (await db()).getAllFromIndex('wikiFolders', 'bookId', bookId)).sort(byName)
}

export async function createFolder(bookId: string, name: string, parentId: string | null = null): Promise<WikiFolder> {
  const folder: WikiFolder = { id: newId(), bookId, parentId, name: cleanTitle(name), createdAt: Date.now() }
  const tx = (await db()).transaction(['books', 'wikiFolders', 'wikiEntries'], 'readwrite')
  await tx.objectStore('wikiFolders').put(folder)
  await appendToOrder(tx, bookId, { kind: 'folder', id: folder.id }, parentId)
  await tx.done
  announceChange()
  return folder
}

export async function renameFolder(id: string, name: string): Promise<WikiFolder> {
  const tx = (await db()).transaction('wikiFolders', 'readwrite')
  const current = await tx.store.get(id)
  if (!current) throw new Error(`Folder not found: ${id}`)
  const next = { ...current, name: cleanTitle(name) }
  await tx.store.put(next)
  await tx.done
  announceChange()
  return next
}

/** Sets the field names every entry in this folder shows. */
export async function setFolderTemplate(id: string, template: string[]): Promise<WikiFolder> {
  const tx = (await db()).transaction('wikiFolders', 'readwrite')
  const current = await tx.store.get(id)
  if (!current) throw new Error(`Folder not found: ${id}`)
  const next: WikiFolder = { ...current }
  const cleaned = cleanList(template)
  if (cleaned.length > 0) next.template = cleaned
  else delete next.template
  await tx.store.put(next)
  await tx.done
  announceChange()
  return next
}

/** Adds or removes one template field on the stored folder, inside one transaction. */
export async function changeTemplate(id: string, change: { add?: string; remove?: string }): Promise<WikiFolder> {
  const tx = (await db()).transaction('wikiFolders', 'readwrite')
  const current = await tx.store.get(id)
  if (!current) throw new Error(`Folder not found: ${id}`)
  const removed = change.remove?.trim()
  const template = cleanList([...(current.template ?? []).filter((key) => key !== removed), change.add ?? ''])
  const next: WikiFolder = { ...current }
  if (template.length > 0) next.template = template
  else delete next.template
  await tx.store.put(next)
  await tx.done
  announceChange()
  return next
}

/** Sets or clears (null) the colour of a folder. Values that are not colours are ignored. */
export async function setFolderColor(id: string, color: string | null): Promise<WikiFolder> {
  const tx = (await db()).transaction('wikiFolders', 'readwrite')
  const current = await tx.store.get(id)
  if (!current) throw new Error(`Folder not found: ${id}`)
  if (color !== null && !isColor(color)) {
    await tx.done
    return current
  }
  const next: WikiFolder = { ...current }
  if (color) next.color = color.trim()
  else delete next.color
  await tx.store.put(next)
  await tx.done
  announceChange()
  return next
}

export interface TemplateLayout {
  template: string[]
  blocks: string[]
  groups: Record<string, string>
}

/** Changes a folder's template fields and starred blocks together, inside one transaction. */
export async function updateTemplateLayout(id: string, update: (layout: TemplateLayout) => TemplateLayout): Promise<WikiFolder> {
  const tx = (await db()).transaction('wikiFolders', 'readwrite')
  const current = await tx.store.get(id)
  if (!current) throw new Error(`Folder not found: ${id}`)
  const layout = update({
    template: [...(current.template ?? [])],
    blocks: [...(current.templateBlocks ?? [])],
    groups: { ...current.templateGroups },
  })
  const next: WikiFolder = { ...current }
  const template = cleanList(layout.template)
  const blocks = cleanList(layout.blocks)
  const groups = Object.fromEntries(Object.entries(layout.groups).filter(([key, block]) => template.includes(key) && blocks.includes(block)))
  if (template.length > 0) next.template = template
  else delete next.template
  if (blocks.length > 0) next.templateBlocks = blocks
  else delete next.templateBlocks
  if (Object.keys(groups).length > 0) next.templateGroups = groups
  else delete next.templateGroups
  await tx.store.put(next)
  await tx.done
  announceChange()
  return next
}

/** Moves one template field a place up or down. */
export async function moveTemplateField(id: string, key: string, direction: 'up' | 'down'): Promise<WikiFolder> {
  const tx = (await db()).transaction('wikiFolders', 'readwrite')
  const current = await tx.store.get(id)
  if (!current) throw new Error(`Folder not found: ${id}`)
  const template = [...(current.template ?? [])]
  const index = template.indexOf(key.trim())
  const other = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || other < 0 || other >= template.length) {
    await tx.done
    return current
  }
  ;[template[index], template[other]] = [template[other], template[index]]
  const next: WikiFolder = { ...current, template }
  await tx.store.put(next)
  await tx.done
  announceChange()
  return next
}

/** Removes a folder. Its entries and subfolders move to its parent; nothing else is deleted. */
export async function deleteFolder(id: string): Promise<void> {
  const tx = (await db()).transaction(['wikiFolders', 'wikiEntries'], 'readwrite')
  const folders = tx.objectStore('wikiFolders')
  const entries = tx.objectStore('wikiEntries')
  const folder = await folders.get(id)
  if (folder) {
    for (const child of await folders.index('bookId').getAll(folder.bookId)) {
      if (child.parentId === id) await folders.put({ ...child, parentId: folder.parentId })
    }
    for (const entry of await entries.index('bookId').getAll(folder.bookId)) {
      if (entry.folderId === id) await entries.put({ ...entry, folderId: folder.parentId })
    }
    await folders.delete(id)
  }
  await tx.done
  announceChange()
}

export async function listEntries(bookId: string): Promise<WikiEntry[]> {
  return (await (await db()).getAllFromIndex('wikiEntries', 'bookId', bookId)).sort(byName)
}

export async function getEntry(id: string): Promise<WikiEntry | undefined> {
  return (await db()).get('wikiEntries', id)
}

export async function createEntry(bookId: string, name: string, folderId: string | null = null): Promise<WikiEntry> {
  const now = Date.now()
  const entry: WikiEntry = {
    id: newId(),
    bookId,
    folderId,
    name: cleanTitle(name),
    aliases: [],
    properties: [],
    imageIds: [],
    body: '',
    autoLink: true,
    createdAt: now,
    updatedAt: now,
  }
  const tx = (await db()).transaction(['books', 'wikiFolders', 'wikiEntries'], 'readwrite')
  await tx.objectStore('wikiEntries').put(entry)
  await appendToOrder(tx, bookId, { kind: 'entry', id: entry.id }, folderId)
  await tx.done
  announceChange()
  return entry
}

export type WikiItem = { kind: 'folder' | 'entry'; id: string }

/**
 * Moves a folder or entry into a folder (null: the top level), in front of `beforeId` or to the
 * end. Folders stay above entries. Returns false when refused: a folder into itself or its own
 * subfolder, or deeper than five levels.
 */
export async function moveWikiItem(bookId: string, item: WikiItem, target: { parentId: string | null; beforeId: string | null }): Promise<boolean> {
  const tx = (await db()).transaction(['books', 'wikiFolders', 'wikiEntries'], 'readwrite')
  const book = await tx.objectStore('books').get(bookId)
  const folders = await tx.objectStore('wikiFolders').index('bookId').getAll(bookId)
  const entries = await tx.objectStore('wikiEntries').index('bookId').getAll(bookId)
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const parentId = target.parentId && byId.has(target.parentId) ? target.parentId : null
  const depthOf = (id: string | null): number => {
    let depth = -1
    for (let at = id; at && byId.has(at) && depth < 50; at = byId.get(at)!.parentId) depth++
    return depth
  }
  const heightOf = (id: string): number =>
    Math.max(0, ...folders.filter((folder) => folder.parentId === id).map((child) => 1 + heightOf(child.id)))

  let oldParent: string | null
  if (item.kind === 'folder') {
    const folder = byId.get(item.id)
    if (!book || !folder) return finish(false)
    for (let at = parentId; at; at = byId.get(at)?.parentId ?? null) if (at === folder.id) return finish(false)
    if (depthOf(parentId) + 1 + heightOf(folder.id) > MAX_FOLDER_DEPTH) return finish(false)
    oldParent = folder.parentId && byId.has(folder.parentId) ? folder.parentId : null
    if (oldParent !== parentId) {
      const moved = { ...folder, parentId }
      await tx.objectStore('wikiFolders').put(moved)
      folders.splice(folders.indexOf(folder), 1, moved)
    }
  } else {
    const entry = entries.find((candidate) => candidate.id === item.id)
    if (!book || !entry) return finish(false)
    oldParent = entry.folderId && byId.has(entry.folderId) ? entry.folderId : null
    if (oldParent !== parentId) {
      const moved = { ...entry, folderId: parentId, updatedAt: Date.now() }
      await tx.objectStore('wikiEntries').put(moved)
      entries.splice(entries.indexOf(entry), 1, moved)
    }
  }

  const order = { ...book.wikiOrder }
  const kids = orderedChildren(parentId, folders, entries, order)
  const folderIds = kids.folders.map((folder) => folder.id)
  const entryIds = kids.entries.map((entry) => entry.id)
  const same = item.kind === 'folder' ? folderIds : entryIds
  same.splice(same.indexOf(item.id), 1)
  const at = target.beforeId ? same.indexOf(target.beforeId) : -1
  same.splice(at < 0 ? same.length : at, 0, item.id)
  order[orderKey(parentId)] = [...folderIds, ...entryIds]
  if (oldParent !== parentId) {
    const rest = (order[orderKey(oldParent)] ?? []).filter((id) => id !== item.id)
    if (rest.length > 0) order[orderKey(oldParent)] = rest
    else delete order[orderKey(oldParent)]
  }
  await tx.objectStore('books').put({ ...book, wikiOrder: order })
  return finish(true)

  async function finish(result: boolean): Promise<boolean> {
    await tx.done
    if (result) announceChange()
    return result
  }
}

/** Moves a folder or entry one place up or down among its own kind in its folder. */
export async function stepWikiItem(bookId: string, item: WikiItem, direction: 'up' | 'down'): Promise<void> {
  const database = await db()
  const [book, folders, entries] = await Promise.all([
    database.get('books', bookId),
    database.getAllFromIndex('wikiFolders', 'bookId', bookId),
    database.getAllFromIndex('wikiEntries', 'bookId', bookId),
  ])
  if (!book) return
  const folderIds = new Set(folders.map((folder) => folder.id))
  const own = item.kind === 'folder' ? folders.find((x) => x.id === item.id)?.parentId : entries.find((x) => x.id === item.id)?.folderId
  const parentId = own && folderIds.has(own) ? own : null
  const kids = orderedChildren(parentId, folders, entries, (book as Book).wikiOrder)
  const ids = (item.kind === 'folder' ? kids.folders : kids.entries).map((x) => x.id)
  const index = ids.indexOf(item.id)
  if (index < 0) return
  if (direction === 'up' && index > 0) await moveWikiItem(bookId, item, { parentId, beforeId: ids[index - 1] })
  if (direction === 'down' && index < ids.length - 1) await moveWikiItem(bookId, item, { parentId, beforeId: ids[index + 2] ?? null })
}

export type EntryPatch = Partial<Pick<WikiEntry, 'name' | 'aliases' | 'properties' | 'blocks' | 'body' | 'autoLink' | 'folderId'>>

export async function updateEntry(
  id: string,
  patch: EntryPatch,
  options?: { expectedUpdatedAt?: number },
): Promise<WikiEntry> {
  const tx = (await db()).transaction('wikiEntries', 'readwrite')
  const current = await tx.store.get(id)
  if (!current) throw new Error(`Entry not found: ${id}`)
  if (options?.expectedUpdatedAt !== undefined && current.updatedAt !== options.expectedUpdatedAt) {
    // Changed by another tab or a sync run since the caller last saw it.
    throw new ConflictError()
  }
  const next: WikiEntry = { ...current, ...patch, updatedAt: Date.now() }
  if (patch.name !== undefined) next.name = cleanTitle(patch.name)
  if (patch.aliases !== undefined) next.aliases = cleanAliases(patch.aliases)
  if (next.blocks && next.blocks.length === 0) delete next.blocks
  await tx.store.put(next)
  await tx.done
  announceChange()
  return next
}

export async function deleteEntry(id: string): Promise<void> {
  const tx = (await db()).transaction(['wikiEntries', 'wikiImages'], 'readwrite')
  const images = tx.objectStore('wikiImages')
  const keys = await images.index('entryId').getAllKeys(id)
  await Promise.all(keys.map((key) => images.delete(key)))
  await tx.objectStore('wikiEntries').delete(id)
  await tx.done
  announceChange()
}

export async function addImage(
  entryId: string,
  image: { type: string; data: ArrayBuffer; width: number; height: number },
): Promise<WikiImage> {
  const tx = (await db()).transaction(['wikiEntries', 'wikiImages'], 'readwrite')
  const entry = await tx.objectStore('wikiEntries').get(entryId)
  if (!entry) throw new Error(`Entry not found: ${entryId}`)
  const stored: WikiImage = { id: newId(), bookId: entry.bookId, entryId, ...image }
  await tx.objectStore('wikiImages').put(stored)
  await tx.objectStore('wikiEntries').put({
    ...entry,
    imageIds: [...entry.imageIds, stored.id],
    updatedAt: Date.now(),
  })
  await tx.done
  announceChange()
  return stored
}

export async function getImage(id: string): Promise<WikiImage | undefined> {
  return (await db()).get('wikiImages', id)
}

/** The first image is the entry's portrait: this one moves to the front. */
export async function setPortrait(id: string): Promise<void> {
  const tx = (await db()).transaction(['wikiEntries', 'wikiImages'], 'readwrite')
  const image = await tx.objectStore('wikiImages').get(id)
  const entry = image && (await tx.objectStore('wikiEntries').get(image.entryId))
  if (entry && entry.imageIds[0] !== id && entry.imageIds.includes(id)) {
    await tx.objectStore('wikiEntries').put({ ...entry, imageIds: [id, ...entry.imageIds.filter((other) => other !== id)], updatedAt: Date.now() })
  }
  await tx.done
  announceChange()
}

export async function removeImage(id: string): Promise<void> {
  const tx = (await db()).transaction(['wikiEntries', 'wikiImages'], 'readwrite')
  const image = await tx.objectStore('wikiImages').get(id)
  if (image) {
    await tx.objectStore('wikiImages').delete(id)
    const entry = await tx.objectStore('wikiEntries').get(image.entryId)
    if (entry) {
      await tx.objectStore('wikiEntries').put({
        ...entry,
        imageIds: entry.imageIds.filter((imageId) => imageId !== id),
        updatedAt: Date.now(),
      })
    }
  }
  await tx.done
  announceChange()
}
