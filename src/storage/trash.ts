import type { Chapter, ChapterVersion, TrashItem, WikiEntry, WikiImage } from '../types'
import { announceChange, db, newId } from './connection'

/** Deleted things stay this long, then they are gone for good. */
export const TRASH_DAYS = 30
const DAY = 24 * 60 * 60 * 1000

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

type StoredVersion = Pick<ChapterVersion, 'id' | 'content' | 'createdAt' | 'label' | 'auto'>
type StoredImage = Pick<WikiImage, 'id' | 'type' | 'width' | 'height'> & { data: string }

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  // In slices: very long argument lists overflow the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function fromBase64(text: string): ArrayBuffer {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function makeItem(bookId: string, kind: 'chapter' | 'entry', title: string, content: Record<string, unknown>): TrashItem {
  const id = newId()
  const deletedAt = Date.now()
  return { id, bookId, kind, title, deletedAt, file: json({ id, kind, title, deletedAt, ...content }) }
}

/** Moves a chapter, with its versions, into the trash. Null when there is no such chapter. */
export async function trashChapter(id: string): Promise<TrashItem | null> {
  const tx = (await db()).transaction(['books', 'chapters', 'versions', 'trash'], 'readwrite')
  const chapters = tx.objectStore('chapters')
  const chapter = await chapters.get(id)
  if (!chapter) {
    await tx.done
    return null
  }
  const books = tx.objectStore('books')
  const versionStore = tx.objectStore('versions')
  const book = await books.get(chapter.bookId)
  const position = book ? book.chapterOrder.indexOf(id) : -1
  const versions = (await versionStore.index('chapterId').getAll(id)).sort((a, b) => b.createdAt - a.createdAt)
  const stored: StoredVersion[] = versions.map(({ id, content, createdAt, label, auto }) => ({ id, content, createdAt, ...(label ? { label } : {}), auto }))
  const item = makeItem(chapter.bookId, 'chapter', chapter.title, {
    chapter,
    index: position >= 0 ? position : (book?.chapterOrder.length ?? 0),
    versions: stored,
  })

  await chapters.delete(id)
  for (const version of versions) await versionStore.delete(version.id)
  if (book) await books.put({ ...book, chapterOrder: book.chapterOrder.filter((c) => c !== id), updatedAt: Date.now() })
  await tx.objectStore('trash').put(item)
  await tx.done
  announceChange()
  return item
}

/** Moves a wiki entry, with its images, into the trash. Null when there is no such entry. */
export async function trashEntry(id: string): Promise<TrashItem | null> {
  const tx = (await db()).transaction(['wikiEntries', 'wikiImages', 'trash'], 'readwrite')
  const entries = tx.objectStore('wikiEntries')
  const entry = await entries.get(id)
  if (!entry) {
    await tx.done
    return null
  }
  const imageStore = tx.objectStore('wikiImages')
  const images = await imageStore.index('entryId').getAll(id)
  const stored: StoredImage[] = images.map(({ id, type, width, height, data }) => ({ id, type, width, height, data: toBase64(data) }))
  const item = makeItem(entry.bookId, 'entry', entry.name, { entry, images: stored })

  for (const image of images) await imageStore.delete(image.id)
  await entries.delete(id)
  await tx.objectStore('trash').put(item)
  await tx.done
  announceChange()
  return item
}

/** The book's trash, newest first. */
export async function listTrash(bookId: string): Promise<TrashItem[]> {
  const items = await (await db()).getAllFromIndex('trash', 'bookId', bookId)
  return items.sort((a, b) => b.deletedAt - a.deletedAt)
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isList = (value: unknown): value is unknown[] => value === undefined || Array.isArray(value)

/** The chapter of a trash file, if it has the shape this version knows. */
function chapterOf(parsed: Record<string, unknown>): { chapter: Chapter; versions: StoredVersion[] } | null {
  const chapter = parsed.chapter
  if (!isObject(chapter) || typeof chapter.id !== 'string' || typeof chapter.title !== 'string' || typeof chapter.content !== 'string') return null
  if (!isList(parsed.versions)) return null
  const versions = ((parsed.versions as unknown[] | undefined) ?? []).filter(
    (version): version is StoredVersion => isObject(version) && typeof version.id === 'string' && typeof version.content === 'string',
  )
  return { chapter: chapter as unknown as Chapter, versions }
}

/** The entry of a trash file, if it has the shape this version knows. */
function entryOf(parsed: Record<string, unknown>): { entry: WikiEntry; images: StoredImage[] } | null {
  const entry = parsed.entry
  if (!isObject(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string') return null
  if (!isList(parsed.images)) return null
  const images = ((parsed.images as unknown[] | undefined) ?? []).filter(
    (image): image is StoredImage => isObject(image) && typeof image.id === 'string' && typeof image.data === 'string' && typeof image.type === 'string',
  )
  return {
    entry: {
      ...(entry as unknown as WikiEntry),
      aliases: Array.isArray(entry.aliases) ? (entry.aliases as string[]) : [],
      properties: Array.isArray(entry.properties) ? (entry.properties as WikiEntry['properties']) : [],
      imageIds: Array.isArray(entry.imageIds) ? (entry.imageIds as string[]) : [],
      body: typeof entry.body === 'string' ? entry.body : '',
      folderId: typeof entry.folderId === 'string' ? entry.folderId : null,
    },
    images,
  }
}

const versionRecord = (version: StoredVersion, bookId: string, chapterId: string): ChapterVersion => ({
  id: version.id,
  bookId,
  chapterId,
  content: version.content,
  createdAt: Number(version.createdAt) || 0,
  auto: version.auto === true,
  ...(typeof version.label === 'string' && version.label ? { label: version.label } : {}),
})

/**
 * What the trashed chapter had that the current one lacks. When the other device kept editing a
 * chapter that was trashed here, the sync brings back its text but drops what was deleted with it
 * (outline, tags, date, status, comments, group); the trash file is then the only copy.
 */
function fillIn(current: Chapter, trashed: Chapter, groupExists: (id: string) => boolean): Chapter | null {
  const next: Chapter = { ...current }
  let changed = false
  if (!current.outline && typeof trashed.outline === 'string' && trashed.outline) {
    next.outline = trashed.outline
    changed = true
  }
  if (!current.tags?.length && Array.isArray(trashed.tags) && trashed.tags.length) {
    next.tags = trashed.tags
    changed = true
  }
  if (!current.date && typeof trashed.date === 'string' && trashed.date) {
    next.date = trashed.date
    changed = true
  }
  if (!current.status && trashed.status) {
    next.status = trashed.status
    changed = true
  }
  if (!current.group && typeof trashed.group === 'string' && groupExists(trashed.group)) {
    next.group = trashed.group
    changed = true
  }
  const known = new Set((current.comments ?? []).map((comment) => comment.id))
  const missing = (Array.isArray(trashed.comments) ? trashed.comments : []).filter((comment) => comment && !known.has(comment.id))
  if (missing.length) {
    next.comments = [...(current.comments ?? []), ...missing].sort((a, b) => a.from - b.from)
    changed = true
  }
  return changed ? next : null
}

/**
 * Puts a chapter or entry back, with the same id. If it exists again (the other device kept editing
 * it), its current text stays, and only what it lost on the way is added back: versions, images and
 * empty chapter details. Null for unknown kinds or files in a shape this version does not know.
 */
export async function restoreTrash(id: string): Promise<{ kind: 'chapter' | 'entry'; targetId: string } | null> {
  const tx = (await db()).transaction(['books', 'chapters', 'versions', 'wikiEntries', 'wikiImages', 'wikiFolders', 'trash'], 'readwrite')
  const trash = tx.objectStore('trash')
  const item = await trash.get(id)
  let parsed: unknown = null
  try {
    parsed = item ? JSON.parse(item.file) : null
  } catch {
    parsed = null
  }
  const chapterPart = item?.kind === 'chapter' && isObject(parsed) ? chapterOf(parsed) : null
  const entryPart = item?.kind === 'entry' && isObject(parsed) ? entryOf(parsed) : null
  const book = item ? await tx.objectStore('books').get(item.bookId) : undefined

  if (item && book && chapterPart) {
    const { chapter, versions } = chapterPart
    const chapters = tx.objectStore('chapters')
    const versionStore = tx.objectStore('versions')
    const groupExists = (group: string) => !!book.chapterGroups?.some((g) => g.id === group)
    const current = await chapters.get(chapter.id)
    if (current) {
      const filled = fillIn(current, chapter, groupExists)
      if (filled) await chapters.put(filled)
    } else {
      const restored: Chapter = { ...chapter, bookId: item.bookId }
      if (restored.group && !groupExists(restored.group)) delete restored.group
      await chapters.put(restored)
      const order = book.chapterOrder.filter((c) => c !== chapter.id)
      const at = Math.min(Math.max(0, Number((parsed as Record<string, unknown>).index) || 0), order.length)
      order.splice(at, 0, chapter.id)
      await tx.objectStore('books').put({ ...book, chapterOrder: order, updatedAt: Date.now() })
    }
    for (const version of versions) {
      if (!(await versionStore.get(version.id))) await versionStore.put(versionRecord(version, item.bookId, chapter.id))
    }
    await trash.delete(id)
    await tx.done
    announceChange()
    return { kind: 'chapter', targetId: chapter.id }
  }

  if (item && book && entryPart) {
    const { entry, images } = entryPart
    const entries = tx.objectStore('wikiEntries')
    const imageStore = tx.objectStore('wikiImages')
    const current = await entries.get(entry.id)
    const missing: StoredImage[] = []
    for (const image of images) if (!(await imageStore.get(image.id))) missing.push(image)
    for (const image of missing) {
      await imageStore.put({
        id: image.id,
        bookId: item.bookId,
        entryId: entry.id,
        type: image.type,
        width: Number(image.width) || 0,
        height: Number(image.height) || 0,
        data: fromBase64(image.data),
      })
    }
    if (current) {
      const lost = missing.map((image) => image.id).filter((imageId) => !current.imageIds.includes(imageId))
      if (lost.length) await entries.put({ ...current, imageIds: [...current.imageIds, ...lost], updatedAt: Date.now() })
    } else {
      const folderGone = entry.folderId !== null && !(await tx.objectStore('wikiFolders').get(entry.folderId))
      await entries.put({ ...entry, bookId: item.bookId, folderId: folderGone ? null : entry.folderId })
    }
    await trash.delete(id)
    await tx.done
    announceChange()
    return { kind: 'entry', targetId: entry.id }
  }

  await tx.done
  return null
}

/** Gone for good. */
export async function deleteTrash(id: string): Promise<void> {
  await (await db()).delete('trash', id)
  announceChange()
}

/** Removes what has been in the trash for 30 days or more. Returns how many went. */
export async function purgeTrash(bookId: string, now = Date.now()): Promise<number> {
  const tx = (await db()).transaction('trash', 'readwrite')
  let removed = 0
  for (const item of await tx.store.index('bookId').getAll(bookId)) {
    if (now - item.deletedAt >= TRASH_DAYS * DAY) {
      await tx.store.delete(item.id)
      removed++
    }
  }
  await tx.done
  if (removed > 0) announceChange()
  return removed
}

/** Whole days until it is gone for good, rounded up; 0 when the time is over. */
export function daysLeft(item: Pick<TrashItem, 'deletedAt'>, now: number): number {
  return Math.max(0, Math.ceil((item.deletedAt + TRASH_DAYS * DAY - now) / DAY))
}
