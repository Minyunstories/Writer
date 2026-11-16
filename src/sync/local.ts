import type { IDBPTransaction } from 'idb'
import { cleanPlace } from '../lib/bookStyle'
import { cleanList, db, newId, type Schema } from '../storage/connection'
import type { Book, Chapter, FontId, WikiEntry, WikiFolder, WikiImage } from '../types'
import {
  bundleToFiles,
  classifyPath,
  colorsFile as colorsText,
  orderFile as orderText,
  parseColors,
  parseOrder,
  placeFile as placeText,
  styleFile as styleText,
  entryToFile,
  parseDates,
  parseEntry,
  parseJson,
  parseStyle,
  stringList,
  text,
  type BookFile,
  type FileData,
  type FileSet,
} from './files'
import type { ShaMap } from './plan'

const STORES = ['books', 'chapters', 'wikiFolders', 'wikiEntries', 'wikiImages'] as const
const FONTS: FontId[] = ['literata', 'inter', 'courier-prime']
const COPY_SUFFIX = ' (Fassung von diesem Gerät)'
const NOTE_SEPARATOR = '\n\n--- Fassung von diesem Gerät ---\n\n'
const IMAGE_TYPES: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif' }

type Tx = IDBPTransaction<Schema, typeof STORES extends readonly (infer S)[] ? S[] : never, 'readwrite'>

export interface ConflictNote {
  bookTitle: string
  kind: 'chapter' | 'entry' | 'outline' | 'book' | 'folders' | 'image' | 'tags' | 'templates' | 'style' | 'dates'
  name: string
}

export interface RemoteChange {
  /** Files that are new or changed in the repository. */
  write: FileSet
  /** Files deleted in the repository. */
  remove: string[]
  /** Files changed on both sides; the local version is whatever is stored now. */
  conflicts: { path: string; remote: FileData }[]
  /** The local files as they were when the run was planned. */
  snapshot: FileSet
}

/** Everything stored on this device, as repository files. */
export async function readLocalFiles(): Promise<FileSet> {
  const database = await db()
  const [books, chapters, folders, entries, images] = await Promise.all([
    database.getAll('books'),
    database.getAll('chapters'),
    database.getAll('wikiFolders'),
    database.getAll('wikiEntries'),
    database.getAll('wikiImages'),
  ])
  const files: FileSet = new Map()
  for (const book of books) {
    const own = <T extends { bookId: string }>(list: T[]) => list.filter((item) => item.bookId === book.id)
    const bundle = bundleToFiles({
      book,
      chapters: own(chapters),
      folders: own(folders),
      entries: own(entries),
      images: own(images),
    })
    for (const [path, data] of bundle) files.set(path, data)
  }
  return files
}

const KIND_ORDER = ['book', 'style', 'place', 'folders', 'templates', 'chapter', 'outline', 'tags', 'dates', 'entry', 'wikiOrder', 'folderColors', 'image']

/**
 * Applies changes from the repository to this device, file by file, in one transaction.
 * Only records whose file changed are touched. Where the stored text differs from what
 * the run saw when it was planned, both versions are kept. Returns one note per conflict
 * and the paths that could not be applied. If anything fails, nothing is changed.
 */
export async function applyRemoteFiles(change: RemoteChange): Promise<{ notes: ConflictNote[]; skipped: string[] }> {
  const tx = (await db()).transaction([...STORES], 'readwrite') as unknown as Tx
  const books = tx.objectStore('books')
  const chapters = tx.objectStore('chapters')
  const folders = tx.objectStore('wikiFolders')
  const entries = tx.objectStore('wikiEntries')
  const images = tx.objectStore('wikiImages')
  const pending: { bookId: string; kind: ConflictNote['kind']; name: string }[] = []
  const skipped: string[] = []
  const imageMeta = new Map<string, { entryId: string; type: string; width: number; height: number }>()
  const snapshotText = (path: string) => (change.snapshot.has(path) ? text(change.snapshot.get(path)) : undefined)
  const now = Date.now()

  const ensureBook = async (bookId: string): Promise<Book> => {
    const existing = await books.get(bookId)
    if (existing) return existing
    const created: Book = { id: bookId, title: 'Unbenannt', font: 'literata', chapterOrder: [], createdAt: now, updatedAt: now }
    await books.put(created)
    return created
  }

  const ensureChapter = async (bookId: string, id: string): Promise<Chapter> => {
    const existing = await chapters.get(id)
    if (existing) return existing
    const book = await ensureBook(bookId)
    const created: Chapter = { id, bookId, title: 'Unbenannt', content: '', outline: '', updatedAt: now }
    await chapters.put(created)
    if (!book.chapterOrder.includes(id)) await books.put({ ...book, chapterOrder: [...book.chapterOrder, id] })
    return created
  }

  const entryFile = async (entry: WikiEntry): Promise<string> =>
    entryToFile(entry, await images.index('entryId').getAll(entry.id))

  async function writeBook(path: string, bookId: string, data: FileData, conflict: boolean) {
    const file = parseJson<BookFile>(data)
    if (!file || !Array.isArray(file.chapters)) {
      skipped.push(path)
      return
    }
    await ensureBook(bookId)
    const listed = file.chapters.filter((item) => item && typeof item.id === 'string')
    for (const item of listed) {
      const chapter = await ensureChapter(bookId, item.id)
      const title = typeof item.title === 'string' && item.title.trim() ? item.title : chapter.title
      // Tags live in tags.json; a book.json never changes them.
      if (title !== chapter.title) await chapters.put({ ...chapter, title, updatedAt: now })
    }
    const book = (await books.get(bookId))!
    const listedIds = listed.map((item) => item.id)
    const localOnly = (await chapters.index('bookId').getAllKeys(bookId)).filter((id) => !listedIds.includes(id))
    // Local-only chapters keep their relative order and go to the end.
    localOnly.sort((a, b) => book.chapterOrder.indexOf(a) - book.chapterOrder.indexOf(b))
    const next: Book = {
      ...book,
      title: typeof file.title === 'string' && file.title.trim() ? file.title : book.title,
      font: FONTS.includes(file.font) ? file.font : book.font,
      createdAt: Number(file.createdAt) || book.createdAt,
      updatedAt: now,
      chapterOrder: [...listedIds, ...localOnly],
    }
    await books.put(next)
    if (conflict) pending.push({ bookId, kind: 'book', name: next.title })
  }

  async function writeChapter(path: string, bookId: string, id: string, data: FileData, conflict: boolean) {
    const remote = text(data)
    const chapter = await ensureChapter(bookId, id)
    const changedSincePlan = (snapshotText(path) ?? '') !== chapter.content
    if ((conflict || changedSincePlan) && chapter.content !== '' && chapter.content !== remote) {
      // Keep the local text as its own chapter right after this one.
      const copy: Chapter = { id: newId(), bookId, title: `${chapter.title}${COPY_SUFFIX}`, content: chapter.content, outline: '', updatedAt: now }
      await chapters.put(copy)
      const book = (await books.get(bookId))!
      const order = [...book.chapterOrder]
      order.splice(order.indexOf(id) + 1, 0, copy.id)
      await books.put({ ...book, chapterOrder: order, updatedAt: now })
      pending.push({ bookId, kind: 'chapter', name: chapter.title })
    }
    await chapters.put({ ...chapter, content: remote, updatedAt: now })
  }

  async function removeChapter(path: string, id: string) {
    const chapter = await chapters.get(id)
    if (!chapter) return
    // Changed since the run was planned: keep it; the next run uploads it again.
    if (snapshotText(path) !== chapter.content) return
    await chapters.delete(id)
    const book = await books.get(chapter.bookId)
    if (book) await books.put({ ...book, chapterOrder: book.chapterOrder.filter((item) => item !== id), updatedAt: now })
  }

  async function writeOutline(path: string, bookId: string, id: string, data: FileData, conflict: boolean) {
    const remote = text(data)
    const chapter = await ensureChapter(bookId, id)
    const local = chapter.outline ?? ''
    const changedSincePlan = (snapshotText(path) ?? '') !== local
    let outline = remote
    if ((conflict || changedSincePlan) && local !== '' && local !== remote) {
      outline = `${remote}${NOTE_SEPARATOR}${local}`
      pending.push({ bookId, kind: 'outline', name: chapter.title })
    }
    await chapters.put({ ...chapter, outline, updatedAt: now })
  }

  async function removeOutline(path: string, id: string) {
    const chapter = await chapters.get(id)
    if (!chapter || (snapshotText(path) ?? '') !== (chapter.outline ?? '')) return
    await chapters.put({ ...chapter, outline: '', updatedAt: now })
  }

  /** A file mapping ids to string lists (tags.json, wiki/templates.json); null when unreadable. */
  const listMap = (data: FileData | undefined): Record<string, string[]> | null => {
    if (data === undefined) return {}
    const parsed = parseJson<unknown>(data)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([id, list]) => [id, stringList(list)]))
  }
  const sameList = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b)

  /**
   * Takes over lists from the repository. Where this device changed a list since the run was
   * planned, or both sides changed the file, the two lists are merged so nothing is dropped.
   * Returns true when a merge kept something the repository did not have.
   */
  async function applyLists(
    path: string,
    data: FileData | undefined,
    conflict: boolean,
    items: { id: string; list: string[]; set: (list: string[]) => Promise<void> }[],
  ): Promise<boolean> {
    const remote = listMap(data)
    if (!remote) {
      skipped.push(path)
      return false
    }
    const planned = listMap(change.snapshot.get(path)) ?? {}
    let kept = false
    for (const item of items) {
      const theirs = remote[item.id] ?? []
      const changedHere = !sameList(planned[item.id] ?? [], item.list)
      const next = conflict || changedHere ? cleanList([...theirs, ...item.list]) : theirs
      if (!sameList(next, theirs)) kept = true
      if (!sameList(next, item.list)) await item.set(next)
    }
    return kept && conflict
  }

  async function writeTags(path: string, bookId: string, data: FileData | undefined, conflict: boolean) {
    const items = (await chapters.index('bookId').getAll(bookId)).map((chapter) => ({
      id: chapter.id,
      list: chapter.tags ?? [],
      set: async (tags: string[]) => {
        const next: Chapter = { ...chapter, updatedAt: now }
        if (tags.length > 0) next.tags = tags
        else delete next.tags
        await chapters.put(next)
      },
    }))
    if (await applyLists(path, data, conflict, items)) pending.push({ bookId, kind: 'tags', name: 'Tags' })
  }

  async function writeTemplates(path: string, bookId: string, data: FileData | undefined, conflict: boolean) {
    const items = (await folders.index('bookId').getAll(bookId)).map((folder) => ({
      id: folder.id,
      list: folder.template ?? [],
      set: async (template: string[]) => {
        const next: WikiFolder = { ...folder }
        if (template.length > 0) next.template = template
        else delete next.template
        await folders.put(next)
      },
    }))
    if (await applyLists(path, data, conflict, items)) pending.push({ bookId, kind: 'templates', name: 'Vorlagen' })
  }

  /** Cover and highlight: the repository's colours; on a conflict the other device wins, with a note. */
  async function writeStyle(path: string, bookId: string, data: FileData | undefined, conflict: boolean) {
    const style = parseStyle(data)
    if (!style) {
      skipped.push(path)
      return
    }
    const book = await books.get(bookId)
    if (!book) return
    // Picked here after the run was planned: this device's colours stay and go up next time.
    if (!conflict && (snapshotText(path) ?? '') !== (styleText(book) ?? '')) return
    const next: Book = { ...book }
    delete next.cover
    delete next.highlight
    if (style.cover) next.cover = style.cover
    if (style.highlight) next.highlight = style.highlight
    if (next.cover !== book.cover || next.highlight !== book.highlight) {
      await books.put(next)
      if (conflict) pending.push({ bookId, kind: 'style', name: next.title })
    }
  }

  async function removeStyle(path: string, bookId: string) {
    const book = await books.get(bookId)
    if (!book || (snapshotText(path) ?? '') !== (styleText(book) ?? '')) return
    const next: Book = { ...book }
    delete next.cover
    delete next.highlight
    await books.put(next)
  }

  /**
   * The wiki order: the repository's, unless it was changed here after the run was planned.
   * When both sides changed it, the other device's order wins; items it does not list stay
   * visible at the end of their folder.
   */
  async function writeOrder(path: string, bookId: string, data: FileData | undefined, conflict: boolean) {
    const order = parseOrder(data)
    if (!order) {
      skipped.push(path)
      return
    }
    const book = await books.get(bookId)
    if (!book) return
    if (!conflict && (snapshotText(path) ?? '') !== (orderText(book) ?? '')) return
    const next: Book = { ...book }
    if (Object.keys(order).length > 0) next.wikiOrder = order
    else delete next.wikiOrder
    await books.put(next)
  }

  /** Folder colours: the repository's, unless changed here after the run was planned. */
  async function writeColors(path: string, bookId: string, data: FileData | undefined, conflict: boolean) {
    const colors = parseColors(data)
    if (!colors) {
      skipped.push(path)
      return
    }
    const own = await folders.index('bookId').getAll(bookId)
    if (!conflict && (snapshotText(path) ?? '') !== (colorsText(own) ?? '')) return
    for (const folder of own) {
      if ((folder.color ?? undefined) === colors[folder.id]) continue
      const next: WikiFolder = { ...folder }
      if (colors[folder.id]) next.color = colors[folder.id]
      else delete next.color
      await folders.put(next)
    }
  }

  /** The last place: the newer one wins, from wherever it comes. */
  async function writePlace(path: string, bookId: string, data: FileData) {
    const place = cleanPlace(parseJson<unknown>(data))
    if (!place) {
      skipped.push(path)
      return
    }
    const book = await books.get(bookId)
    if (book && (book.place?.at ?? -Infinity) < place.at) await books.put({ ...book, place })
  }

  async function removePlace(path: string, bookId: string) {
    const book = await books.get(bookId)
    if (!book?.place || (snapshotText(path) ?? '') !== (placeText(book) ?? '')) return
    const next: Book = { ...book }
    delete next.place
    await books.put(next)
  }

  /**
   * Timeline dates per chapter. A date changed here since the run was planned stays. When both
   * sides changed the file and a chapter has two different dates, both are kept, joined.
   */
  async function writeDates(path: string, bookId: string, data: FileData | undefined, conflict: boolean) {
    const remote = parseDates(data)
    if (!remote) {
      skipped.push(path)
      return
    }
    const planned = parseDates(change.snapshot.get(path)) ?? {}
    let joined = false
    for (const chapter of await chapters.index('bookId').getAll(bookId)) {
      const local = chapter.date
      const theirs = remote[chapter.id]
      let next: string | undefined = theirs
      if (local !== planned[chapter.id]) next = local
      else if (conflict && local && theirs && local !== theirs) {
        next = `${theirs} / ${local}`
        joined = true
      } else if (conflict && local && !theirs) next = local
      if (next !== local) {
        const updated: Chapter = { ...chapter, updatedAt: now }
        if (next) updated.date = next
        else delete updated.date
        await chapters.put(updated)
      }
    }
    if (joined) pending.push({ bookId, kind: 'dates', name: 'Daten' })
  }

  async function writeFolders(path: string, bookId: string, data: FileData, conflict: boolean) {
    const list = parseJson<Omit<WikiFolder, 'bookId'>[]>(data)
    if (!Array.isArray(list)) {
      skipped.push(path)
      return
    }
    await ensureBook(bookId)
    const remote = list.filter((folder) => folder && typeof folder.id === 'string')
    const remoteIds = new Set(remote.map((folder) => folder.id))
    if (!conflict) {
      for (const key of await folders.index('bookId').getAllKeys(bookId)) {
        if (!remoteIds.has(key)) await folders.delete(key)
      }
    } else {
      pending.push({ bookId, kind: 'folders', name: 'Ordner' })
    }
    for (const folder of remote) {
      const next: WikiFolder = {
        id: folder.id,
        bookId,
        parentId: folder.parentId ?? null,
        name: typeof folder.name === 'string' && folder.name.trim() ? folder.name : 'Unbenannt',
        createdAt: Number(folder.createdAt) || now,
      }
      // Templates live in wiki/templates.json; folders.json never changes them.
      const existing = await folders.get(folder.id)
      if (existing?.template?.length) next.template = existing.template
      // Colours live in wiki/colors.json.
      if (existing?.color) next.color = existing.color
      await folders.put(next)
    }
  }

  async function writeEntry(path: string, bookId: string, data: FileData, conflict: boolean) {
    const remote = text(data)
    const parsed = parseEntry(bookId, remote)
    if (!parsed) {
      skipped.push(path)
      return
    }
    await ensureBook(bookId)
    const current = await entries.get(parsed.entry.id)
    if (current) {
      const currentFile = await entryFile(current)
      const changedSincePlan = snapshotText(path) !== currentFile
      if ((conflict || changedSincePlan) && currentFile !== remote) {
        await entries.put({ ...current, id: newId(), name: `${current.name}${COPY_SUFFIX}`, autoLink: false, imageIds: [], updatedAt: now })
        pending.push({ bookId, kind: 'entry', name: current.name })
      }
    }
    for (const meta of parsed.images) {
      imageMeta.set(meta.id, { entryId: parsed.entry.id, type: meta.type, width: Number(meta.width) || 0, height: Number(meta.height) || 0 })
    }
    await entries.put(parsed.entry)
  }

  async function removeEntry(path: string, id: string) {
    const current = await entries.get(id)
    if (!current || snapshotText(path) !== (await entryFile(current))) return
    for (const key of await images.index('entryId').getAllKeys(id)) await images.delete(key)
    await entries.delete(id)
  }

  async function writeImage(path: string, bookId: string, id: string, data: FileData) {
    if (typeof data === 'string') {
      skipped.push(path)
      return
    }
    let meta = imageMeta.get(id)
    if (!meta) {
      const existing = await images.get(id)
      const owner = (await entries.index('bookId').getAll(bookId)).find((entry) => entry.imageIds.includes(id))
      if (!existing && !owner) {
        skipped.push(path) // No entry refers to it: nothing to attach it to.
        return
      }
      const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
      meta = {
        entryId: existing?.entryId ?? owner!.id,
        type: existing?.type ?? IMAGE_TYPES[extension] ?? 'application/octet-stream',
        width: existing?.width ?? 0,
        height: existing?.height ?? 0,
      }
    }
    const image: WikiImage = { id, bookId, ...meta, data: data.slice().buffer as ArrayBuffer }
    await images.put(image)
  }

  async function removeImage(id: string) {
    const image = await images.get(id)
    if (!image) return
    await images.delete(id)
    const entry = await entries.get(image.entryId)
    if (entry?.imageIds.includes(id)) {
      await entries.put({ ...entry, imageIds: entry.imageIds.filter((item) => item !== id), updatedAt: now })
    }
  }

  /** True when something in the book was written after the run was planned. */
  async function bookChangedSincePlan(bookId: string): Promise<boolean> {
    for (const chapter of await chapters.index('bookId').getAll(bookId)) {
      const prefix = `books/${bookId}/`
      if (snapshotText(`${prefix}chapters/${chapter.id}.md`) !== chapter.content) return true
      if ((snapshotText(`${prefix}outline/${chapter.id}.md`) ?? '') !== (chapter.outline ?? '')) return true
    }
    for (const entry of await entries.index('bookId').getAll(bookId)) {
      if (snapshotText(`books/${bookId}/wiki/${entry.id}.md`) !== (await entryFile(entry))) return true
    }
    return false
  }

  async function removeBook(bookId: string) {
    for (const key of await chapters.index('bookId').getAllKeys(bookId)) await chapters.delete(key)
    for (const key of await folders.index('bookId').getAllKeys(bookId)) await folders.delete(key)
    for (const key of await entries.index('bookId').getAllKeys(bookId)) await entries.delete(key)
    for (const key of await images.index('bookId').getAllKeys(bookId)) await images.delete(key)
    await books.delete(bookId)
  }

  const notes: ConflictNote[] = []
  try {
    const byKind = <T extends { path: string }>(items: T[]) =>
      items
        .map((item) => ({ item, info: classifyPath(item.path) }))
        .filter((pair): pair is { item: T; info: NonNullable<ReturnType<typeof classifyPath>> } => pair.info !== null)
        .sort((a, b) => KIND_ORDER.indexOf(a.info.kind) - KIND_ORDER.indexOf(b.info.kind) || a.item.path.localeCompare(b.item.path))

    const writes = byKind([
      ...[...change.write].map(([path, data]) => ({ path, data, conflict: false })),
      ...change.conflicts.map(({ path, remote }) => ({ path, data: remote, conflict: true })),
    ])
    for (const { item, info } of writes) {
      const { path, data, conflict } = item
      if (info.kind === 'book') await writeBook(path, info.bookId, data, conflict)
      else if (info.kind === 'folders') await writeFolders(path, info.bookId, data, conflict)
      else if (info.kind === 'chapter') await writeChapter(path, info.bookId, info.id, data, conflict)
      else if (info.kind === 'outline') await writeOutline(path, info.bookId, info.id, data, conflict)
      else if (info.kind === 'entry') await writeEntry(path, info.bookId, data, conflict)
      else if (info.kind === 'tags') await writeTags(path, info.bookId, data, conflict)
      else if (info.kind === 'style') await writeStyle(path, info.bookId, data, conflict)
      else if (info.kind === 'place') await writePlace(path, info.bookId, data)
      else if (info.kind === 'dates') await writeDates(path, info.bookId, data, conflict)
      else if (info.kind === 'wikiOrder') await writeOrder(path, info.bookId, data, conflict)
      else if (info.kind === 'folderColors') await writeColors(path, info.bookId, data, conflict)
      else if (info.kind === 'templates') await writeTemplates(path, info.bookId, data, conflict)
      else await writeImage(path, info.bookId, info.id, data)
    }

    const removals = byKind(change.remove.map((path) => ({ path })))
    const removedBooks = new Set(removals.filter(({ info }) => info.kind === 'book').map(({ info }) => info.bookId))
    for (const bookId of removedBooks) {
      // Still being worked on here: the book stays, whole, and the next run uploads it again.
      if (!(await bookChangedSincePlan(bookId))) await removeBook(bookId)
    }
    for (const { item, info } of removals) {
      if (removedBooks.has(info.bookId)) continue
      if (info.kind === 'chapter') await removeChapter(item.path, info.id)
      else if (info.kind === 'outline') await removeOutline(item.path, info.id)
      else if (info.kind === 'entry') await removeEntry(item.path, info.id)
      else if (info.kind === 'image') await removeImage(info.id)
      // Removed there: an empty file, so lists unchanged here are cleared and changed ones kept.
      else if (info.kind === 'tags') await writeTags(item.path, info.bookId, '{}', false)
      else if (info.kind === 'dates') await writeDates(item.path, info.bookId, '{}', false)
      else if (info.kind === 'style') await removeStyle(item.path, info.bookId)
      else if (info.kind === 'place') await removePlace(item.path, info.bookId)
      else if (info.kind === 'wikiOrder') await writeOrder(item.path, info.bookId, '{}', false)
      else if (info.kind === 'folderColors') await writeColors(item.path, info.bookId, '{}', false)
      else if (info.kind === 'templates') await writeTemplates(item.path, info.bookId, '{}', false)
      else if (info.kind === 'folders') {
        for (const key of await folders.index('bookId').getAllKeys(info.bookId)) await folders.delete(key)
      }
    }

    for (const { bookId, kind, name } of pending) {
      notes.push({ bookTitle: (await books.get(bookId))?.title ?? 'Unbenannt', kind, name })
    }
    await tx.done
  } catch (error) {
    // Leave everything as it was rather than half-applied.
    try {
      tx.abort()
    } catch {
      // Already finished or aborted.
    }
    await tx.done.catch(() => {})
    throw error
  }
  return { notes, skipped }
}

const STATE_ID = 'state'

/** What was last synchronised with this repository, or undefined if nothing (or another repository) was. */
export async function loadSyncState(repository: string): Promise<{ base: ShaMap } | undefined> {
  const stored = await (await db()).get('syncState', STATE_ID)
  if (!stored || stored.repository !== repository) return undefined
  return { base: new Map(Object.entries(stored.base)) }
}

export async function saveSyncState(repository: string, base: ShaMap): Promise<void> {
  await (await db()).put('syncState', { id: STATE_ID, repository, base: Object.fromEntries(base) })
}

export async function clearSyncState(): Promise<void> {
  await (await db()).delete('syncState', STATE_ID)
}
