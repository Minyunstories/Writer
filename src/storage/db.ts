import { cleanDate, cleanPlace, COVERS, isColor } from '../lib/bookStyle'
import type { Book, BookPlace, Chapter, ChapterStatus, FontId } from '../types'
import { announceChange, cleanList, cleanTitle, ConflictError, db, newId } from './connection'

export { ConflictError, resetDatabaseForTests } from './connection'

export async function listBooks(): Promise<Book[]> {
  const books = await (await db()).getAll('books')
  return books.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function getBook(id: string): Promise<Book | undefined> {
  return (await db()).get('books', id)
}

/** The cover colour a new book gets next: the colours in turn. */
export async function nextCover(): Promise<string> {
  return COVERS[(await (await db()).count('books')) % COVERS.length].color
}

export async function createBook(title: string, style?: { cover?: string }): Promise<Book> {
  const now = Date.now()
  const font: FontId = 'literata'
  const book: Book = {
    id: newId(),
    title: cleanTitle(title),
    font,
    chapterOrder: [],
    createdAt: now,
    updatedAt: now,
  }
  if (isColor(style?.cover)) book.cover = style.cover
  await (await db()).put('books', book)
  announceChange()
  return book
}

export async function updateBook(
  id: string,
  patch: Partial<Pick<Book, 'title' | 'font' | 'chapterOrder'>>,
): Promise<Book> {
  const tx = (await db()).transaction('books', 'readwrite')
  const current = await tx.store.get(id)
  if (!current) throw new Error(`Book not found: ${id}`)
  const next: Book = { ...current, ...patch, updatedAt: Date.now() }
  if (patch.title !== undefined) next.title = cleanTitle(patch.title)
  await tx.store.put(next)
  await tx.done
  announceChange()
  return next
}

/** Sets the cover or highlight colour. Values that are not colours are ignored. */
export async function setBookStyle(id: string, style: { cover?: string; highlight?: string }): Promise<Book> {
  const tx = (await db()).transaction('books', 'readwrite')
  const current = await tx.store.get(id)
  if (!current) throw new Error(`Book not found: ${id}`)
  const next: Book = { ...current }
  if (isColor(style.cover)) next.cover = style.cover.trim()
  if (isColor(style.highlight)) next.highlight = style.highlight.trim()
  await tx.store.put(next)
  await tx.done
  announceChange()
  return next
}

/**
 * Remembers where text was last changed. An older place (e.g. from a slower device) never
 * replaces a newer one. The book's "last changed" date stays as it is.
 */
export async function savePlace(bookId: string, place: BookPlace): Promise<void> {
  const cleaned = cleanPlace(place)
  if (!cleaned) return
  const tx = (await db()).transaction('books', 'readwrite')
  const current = await tx.store.get(bookId)
  if (current && (current.place?.at ?? -Infinity) <= cleaned.at) await tx.store.put({ ...current, place: cleaned })
  await tx.done
  announceChange()
}

const BOOK_OWNED_STORES = ['chapters', 'wikiFolders', 'wikiEntries', 'wikiImages', 'versions', 'trash'] as const

export async function deleteBook(id: string): Promise<void> {
  const tx = (await db()).transaction(['books', ...BOOK_OWNED_STORES], 'readwrite')
  for (const name of BOOK_OWNED_STORES) {
    const store = tx.objectStore(name)
    const keys = await store.index('bookId').getAllKeys(id)
    await Promise.all(keys.map((key) => store.delete(key)))
  }
  await tx.objectStore('books').delete(id)
  await tx.done
  announceChange()
}

export async function listChapters(bookId: string): Promise<Chapter[]> {
  const database = await db()
  const [book, chapters] = await Promise.all([
    database.get('books', bookId),
    database.getAllFromIndex('chapters', 'bookId', bookId),
  ])
  if (!book) return []
  const byId = new Map(chapters.map((c) => [c.id, c]))
  const ordered: Chapter[] = []
  for (const id of book.chapterOrder) {
    const chapter = byId.get(id)
    if (chapter) {
      ordered.push(chapter)
      byId.delete(id)
    }
  }
  // Chapters missing from the order are appended rather than hidden.
  return [...ordered, ...byId.values()]
}

export async function getChapter(id: string): Promise<Chapter | undefined> {
  return (await db()).get('chapters', id)
}

export async function createChapter(bookId: string, title: string, content = ''): Promise<Chapter> {
  const tx = (await db()).transaction(['books', 'chapters'], 'readwrite')
  const book = await tx.objectStore('books').get(bookId)
  if (!book) throw new Error(`Book not found: ${bookId}`)
  const now = Date.now()
  const chapter: Chapter = {
    id: newId(),
    bookId,
    title: cleanTitle(title),
    content,
    outline: '',
    updatedAt: now,
  }
  await tx.objectStore('chapters').put(chapter)
  await tx.objectStore('books').put({
    ...book,
    chapterOrder: [...book.chapterOrder, chapter.id],
    updatedAt: now,
  })
  await tx.done
  announceChange()
  return chapter
}

export async function updateChapter(
  id: string,
  patch: Partial<Pick<Chapter, 'title' | 'content' | 'outline' | 'tags'>>,
  options?: { expectedContent?: string; expectedOutline?: string },
): Promise<Chapter> {
  const tx = (await db()).transaction(['books', 'chapters'], 'readwrite')
  const current = await tx.objectStore('chapters').get(id)
  if (!current) throw new Error(`Chapter not found: ${id}`)
  if (
    patch.content !== undefined &&
    options?.expectedContent !== undefined &&
    current.content !== options.expectedContent
  ) {
    // Another tab or device saved different text in the meantime.
    throw new ConflictError()
  }
  if (
    patch.outline !== undefined &&
    options?.expectedOutline !== undefined &&
    (current.outline ?? '') !== options.expectedOutline
  ) {
    throw new ConflictError()
  }
  const now = Date.now()
  const next: Chapter = { ...current, ...patch, updatedAt: now }
  if (patch.title !== undefined) next.title = cleanTitle(patch.title)
  if (patch.tags !== undefined) {
    const tags = cleanList(patch.tags)
    if (tags.length > 0) next.tags = tags
    else delete next.tags
  }
  await tx.objectStore('chapters').put(next)
  const book = await tx.objectStore('books').get(current.bookId)
  if (book) await tx.objectStore('books').put({ ...book, updatedAt: now })
  await tx.done
  announceChange()
  return next
}

/** Sets the free-text timeline date: one line, at most 40 characters; empty removes it. */
export async function setChapterDate(id: string, date: string): Promise<Chapter> {
  const tx = (await db()).transaction('chapters', 'readwrite')
  const current = await tx.store.get(id)
  if (!current) throw new Error(`Chapter not found: ${id}`)
  const next: Chapter = { ...current }
  const cleaned = cleanDate(date)
  if (cleaned) next.date = cleaned
  else delete next.date
  if (next.date === current.date) {
    await tx.done
    return current
  }
  next.updatedAt = Date.now()
  await tx.store.put(next)
  await tx.done
  announceChange()
  return next
}

/** Sets how far a chapter is; null clears it. */
export async function setChapterStatus(id: string, status: ChapterStatus | null): Promise<Chapter> {
  const tx = (await db()).transaction('chapters', 'readwrite')
  const current = await tx.store.get(id)
  if (!current) throw new Error(`Chapter not found: ${id}`)
  if ((current.status ?? null) === status) {
    await tx.done
    return current
  }
  const next: Chapter = { ...current, updatedAt: Date.now() }
  if (status) next.status = status
  else delete next.status
  await tx.store.put(next)
  await tx.done
  announceChange()
  return next
}

/**
 * Adds or removes one tag on the stored chapter, inside one transaction, so two quick
 * changes (or a change from another tab) never undo each other.
 */
export async function changeChapterTags(id: string, change: { add?: string; remove?: string }): Promise<Chapter> {
  const tx = (await db()).transaction(['books', 'chapters'], 'readwrite')
  const current = await tx.objectStore('chapters').get(id)
  if (!current) throw new Error(`Chapter not found: ${id}`)
  const removed = change.remove?.trim()
  const tags = cleanList([...(current.tags ?? []).filter((tag) => tag !== removed), change.add ?? ''])
  const next: Chapter = { ...current }
  if (tags.length > 0) next.tags = tags
  else delete next.tags
  if (JSON.stringify(next.tags ?? []) === JSON.stringify(current.tags ?? [])) {
    await tx.done
    return current
  }
  const now = Date.now()
  next.updatedAt = now
  await tx.objectStore('chapters').put(next)
  const book = await tx.objectStore('books').get(current.bookId)
  if (book) await tx.objectStore('books').put({ ...book, updatedAt: now })
  await tx.done
  announceChange()
  return next
}

/**
 * Moves a chapter next to another one. Works on the stored order inside one
 * transaction, so moves decided on an outdated screen never undo each other.
 * Ids of deleted chapters are dropped and chapters missing from the order are appended.
 */
export async function moveChapter(
  bookId: string,
  chapterId: string,
  target: { before: string } | { after: string },
): Promise<Book> {
  const tx = (await db()).transaction(['books', 'chapters'], 'readwrite')
  const book = await tx.objectStore('books').get(bookId)
  if (!book) throw new Error(`Book not found: ${bookId}`)
  const existing = new Set(await tx.objectStore('chapters').index('bookId').getAllKeys(bookId))
  const order = book.chapterOrder.filter((id) => existing.delete(id))
  order.push(...existing)

  const targetId = 'before' in target ? target.before : target.after
  if (chapterId !== targetId && order.includes(chapterId) && order.includes(targetId)) {
    order.splice(order.indexOf(chapterId), 1)
    order.splice(order.indexOf(targetId) + ('after' in target ? 1 : 0), 0, chapterId)
  }
  const next: Book = { ...book, chapterOrder: order, updatedAt: Date.now() }
  await tx.objectStore('books').put(next)
  await tx.done
  announceChange()
  return next
}

export async function deleteChapter(id: string): Promise<void> {
  const tx = (await db()).transaction(['books', 'chapters', 'versions'], 'readwrite')
  const chapter = await tx.objectStore('chapters').get(id)
  if (chapter) {
    await tx.objectStore('chapters').delete(id)
    const versions = tx.objectStore('versions')
    for (const key of await versions.index('chapterId').getAllKeys(id)) await versions.delete(key)
    const book = await tx.objectStore('books').get(chapter.bookId)
    if (book) {
      await tx.objectStore('books').put({
        ...book,
        chapterOrder: book.chapterOrder.filter((c) => c !== id),
        updatedAt: Date.now(),
      })
    }
  }
  await tx.done
  announceChange()
}
