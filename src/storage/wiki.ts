import type { WikiEntry, WikiFolder, WikiImage } from '../types'
import { announceChange, cleanTitle, ConflictError, db, newId } from './connection'

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'de')

function cleanAliases(aliases: string[]): string[] {
  const seen = new Set<string>()
  for (const alias of aliases) {
    const trimmed = alias.trim()
    if (trimmed) seen.add(trimmed)
  }
  return [...seen]
}

export async function listFolders(bookId: string): Promise<WikiFolder[]> {
  return (await (await db()).getAllFromIndex('wikiFolders', 'bookId', bookId)).sort(byName)
}

export async function createFolder(bookId: string, name: string, parentId: string | null = null): Promise<WikiFolder> {
  const folder: WikiFolder = { id: newId(), bookId, parentId, name: cleanTitle(name), createdAt: Date.now() }
  await (await db()).put('wikiFolders', folder)
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
  await (await db()).put('wikiEntries', entry)
  announceChange()
  return entry
}

export type EntryPatch = Partial<Pick<WikiEntry, 'name' | 'aliases' | 'properties' | 'body' | 'autoLink' | 'folderId'>>

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
