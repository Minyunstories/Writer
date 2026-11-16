import { cleanDate, cleanPlace, isColor } from '../lib/bookStyle'
import type { Book, Chapter, FontId, WikiEntry, WikiFolder, WikiImage, WikiProperty } from '../types'
import type { FileData } from './hash'

export type { FileData } from './hash'
export type FileSet = Map<string, FileData>

export interface BookBundle {
  book: Book
  chapters: Chapter[]
  folders: WikiFolder[]
  entries: WikiEntry[]
  images: WikiImage[]
}

const ROOT = 'books/'
const FONTS: FontId[] = ['literata', 'inter', 'courier-prime']
const EXTENSIONS: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' }
const HEADER_START = '---\n'
const HEADER_END = '\n---\n'

const decoder = new TextDecoder()
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
export const text = (data: FileData | undefined): string =>
  (data === undefined ? '' : typeof data === 'string' ? data : decoder.decode(data)).replace(/\r\n/g, '\n')

export function bookPrefix(bookId: string): string {
  return `${ROOT}${bookId}/`
}

/** The book a repository path belongs to, or null for files outside books/. */
export function bookIdOf(path: string): string | null {
  if (!path.startsWith(ROOT)) return null
  const rest = path.slice(ROOT.length)
  const slash = rest.indexOf('/')
  return slash > 0 ? rest.slice(0, slash) : null
}

export interface BookFile {
  id: string
  title: string
  font: FontId
  createdAt: number
  chapters: { id: string; title: string }[]
}

export interface EntryHeader {
  id: string
  name: string
  aliases: string[]
  folderId: string | null
  autoLink: boolean
  properties: WikiProperty[]
  images: { id: string; type: string; width: number; height: number }[]
  createdAt: number
  updatedAt: number
}

/** Turns one book into repository files. The same book always gives the same bytes. */
export function bundleToFiles({ book, chapters, folders, entries, images }: BookBundle): FileSet {
  const prefix = bookPrefix(book.id)
  const files: FileSet = new Map()
  const ordered = orderedChapters(book, chapters)

  const bookFile: BookFile = {
    id: book.id,
    title: book.title,
    font: book.font,
    createdAt: book.createdAt,
    // No "last changed" times here: they differ per device and would make every sync look like a change.
    chapters: ordered.map((chapter) => ({ id: chapter.id, title: chapter.title })),
  }
  files.set(`${prefix}book.json`, json(bookFile))

  // Tags and templates have files of their own: an older app version rewrites only the
  // files it knows, so it can never strip them.
  const tags = tagsFile(ordered)
  if (tags) files.set(`${prefix}tags.json`, tags)
  const templates = templatesFile(folders)
  if (templates) files.set(`${prefix}wiki/templates.json`, templates)
  const style = styleFile(book)
  if (style) files.set(`${prefix}style.json`, style)
  const dates = datesFile(ordered)
  if (dates) files.set(`${prefix}dates.json`, dates)
  const place = placeFile(book)
  if (place) files.set(`${prefix}place.json`, place)

  for (const chapter of ordered) {
    files.set(`${prefix}chapters/${chapter.id}.md`, chapter.content)
    if (chapter.outline) files.set(`${prefix}outline/${chapter.id}.md`, chapter.outline)
  }

  if (folders.length > 0) {
    const sorted = [...folders].sort((a, b) => a.id.localeCompare(b.id))
    files.set(
      `${prefix}wiki/folders.json`,
      json(sorted.map(({ id, name, parentId, createdAt }) => ({ id, name, parentId, createdAt }))),
    )
  }

  const imageById = new Map(images.map((image) => [image.id, image]))
  for (const entry of entries) {
    const header: EntryHeader = {
      id: entry.id,
      name: entry.name,
      aliases: entry.aliases,
      folderId: entry.folderId,
      autoLink: entry.autoLink,
      properties: entry.properties.map(({ id, key, value }) => ({ id, key, value })),
      images: entry.imageIds.flatMap((id) => {
        const image = imageById.get(id)
        return image ? [{ id, type: image.type, width: image.width, height: image.height }] : []
      }),
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }
    files.set(`${prefix}wiki/${entry.id}.md`, `${HEADER_START}${JSON.stringify(header, null, 2)}${HEADER_END}${entry.body}`)
  }

  for (const image of images) {
    const extension = EXTENSIONS[image.type] ?? 'bin'
    files.set(`${prefix}wiki/_images/${image.id}.${extension}`, new Uint8Array(image.data))
  }
  return files
}

/** Chapters in the book's order; chapters missing from the order follow. */
export function orderedChapters(book: Pick<Book, 'chapterOrder'>, chapters: Chapter[]): Chapter[] {
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]))
  return [
    ...book.chapterOrder.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    ...chapters.filter((chapter) => !book.chapterOrder.includes(chapter.id)),
  ]
}

/** tags.json: chapter id to tags, in chapter order. Undefined when no chapter has tags. */
export function tagsFile(ordered: Chapter[]): string | undefined {
  const entries = ordered.filter((chapter) => chapter.tags?.length).map((chapter) => [chapter.id, chapter.tags] as const)
  return entries.length > 0 ? json(Object.fromEntries(entries)) : undefined
}

/** style.json: cover and highlight colour. Undefined when neither is set. */
export function styleFile(book: Pick<Book, 'cover' | 'highlight'>): string | undefined {
  const style: { cover?: string; highlight?: string } = {}
  if (book.cover) style.cover = book.cover
  if (book.highlight) style.highlight = book.highlight
  return Object.keys(style).length > 0 ? json(style) : undefined
}

/** dates.json: chapter id to timeline date, in chapter order. Undefined when there are none. */
export function datesFile(ordered: Chapter[]): string | undefined {
  const entries = ordered.filter((chapter) => chapter.date).map((chapter) => [chapter.id, chapter.date] as const)
  return entries.length > 0 ? json(Object.fromEntries(entries)) : undefined
}

/** place.json: where text was last changed. */
export function placeFile(book: Pick<Book, 'place'>): string | undefined {
  return book.place ? json({ chapterId: book.place.chapterId, offset: book.place.offset, at: book.place.at }) : undefined
}

/** The usable colours of a style.json; null when the file is not a JSON object. */
export function parseStyle(data: FileData | undefined): { cover?: string; highlight?: string } | null {
  const parsed = parseJson<unknown>(data)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const { cover, highlight } = parsed as Record<string, unknown>
  const style: { cover?: string; highlight?: string } = {}
  if (isColor(cover)) style.cover = cover.trim()
  if (isColor(highlight)) style.highlight = highlight.trim()
  return style
}

/** The usable dates of a dates.json; null when the file is not a JSON object. */
export function parseDates(data: FileData | undefined): Record<string, string> | null {
  const parsed = parseJson<unknown>(data)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const dates: Record<string, string> = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    const date = cleanDate(value)
    if (date) dates[id] = date
  }
  return dates
}

/** wiki/templates.json: folder id to field names, by folder id. Undefined when there are none. */
export function templatesFile(folders: WikiFolder[]): string | undefined {
  const entries = [...folders]
    .filter((folder) => folder.template?.length)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((folder) => [folder.id, folder.template] as const)
  return entries.length > 0 ? json(Object.fromEntries(entries)) : undefined
}

/** Only the strings of a list that may come from a hand-edited file. */
export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []
}

export function parseJson<T>(data: FileData | undefined): T | undefined {
  if (data === undefined) return undefined
  try {
    return JSON.parse(text(data)) as T
  } catch {
    return undefined
  }
}

export function parseEntry(bookId: string, raw: string): { entry: WikiEntry; images: EntryHeader['images'] } | null {
  if (!raw.startsWith(HEADER_START)) return null
  const end = raw.indexOf(HEADER_END, HEADER_START.length - 1)
  if (end < 0) return null
  let header: EntryHeader
  try {
    header = JSON.parse(raw.slice(HEADER_START.length, end)) as EntryHeader
  } catch {
    return null
  }
  if (!header || typeof header.id !== 'string') return null
  const imagesMeta = Array.isArray(header.images) ? header.images : []
  return {
    images: imagesMeta,
    entry: {
      id: header.id,
      bookId,
      folderId: header.folderId ?? null,
      name: typeof header.name === 'string' && header.name.trim() ? header.name : 'Unbenannt',
      aliases: Array.isArray(header.aliases) ? header.aliases.filter((alias) => typeof alias === 'string') : [],
      properties: Array.isArray(header.properties) ? header.properties : [],
      imageIds: imagesMeta.map((image) => image.id),
      body: raw.slice(end + HEADER_END.length),
      autoLink: header.autoLink !== false,
      createdAt: Number(header.createdAt) || 0,
      updatedAt: Number(header.updatedAt) || 0,
    },
  }
}

/**
 * Rebuilds one book from repository files. Tolerant by design: files edited by
 * hand or half-synced must never make a book unreadable.
 */
export function filesToBundle(bookId: string, files: FileSet): BookBundle {
  const prefix = bookPrefix(bookId)
  const own = [...files.keys()].filter((path) => path.startsWith(prefix))
  const idOf = (path: string, folder: string) => path.slice(prefix.length + folder.length).replace(/\.[^./]+$/, '')

  const bookFile = parseJson<BookFile>(files.get(`${prefix}book.json`))
  const listed = Array.isArray(bookFile?.chapters) ? bookFile!.chapters.filter((c) => c && typeof c.id === 'string') : []
  const chapterFiles = own.filter((path) => path.startsWith(`${prefix}chapters/`) && path.endsWith('.md'))
  const unlisted = chapterFiles
    .map((path) => idOf(path, 'chapters/'))
    .filter((id) => !listed.some((chapter) => chapter.id === id))
    .sort()

  const tagMap = parseJson<Record<string, unknown>>(files.get(`${prefix}tags.json`)) ?? {}
  const dateMap = parseDates(files.get(`${prefix}dates.json`)) ?? {}
  const chapters: Chapter[] = [...listed, ...unlisted.map((id) => ({ id, title: 'Unbenannt' }))].map((meta) => {
    const chapter: Chapter = {
      id: meta.id,
      bookId,
      title: typeof meta.title === 'string' && meta.title.trim() ? meta.title : 'Unbenannt',
      content: text(files.get(`${prefix}chapters/${meta.id}.md`)),
      outline: text(files.get(`${prefix}outline/${meta.id}.md`)),
      updatedAt: 0,
    }
    const tags = stringList(tagMap[meta.id])
    if (tags.length > 0) chapter.tags = tags
    const date = dateMap[meta.id]
    if (date) chapter.date = date
    return chapter
  })

  const book: Book = {
    id: bookId,
    title: typeof bookFile?.title === 'string' && bookFile.title.trim() ? bookFile.title : 'Unbenannt',
    font: FONTS.includes(bookFile?.font as FontId) ? (bookFile!.font as FontId) : 'literata',
    chapterOrder: chapters.map((chapter) => chapter.id),
    createdAt: Number(bookFile?.createdAt) || 0,
    updatedAt: 0,
  }
  const style = parseStyle(files.get(`${prefix}style.json`)) ?? {}
  if (style.cover) book.cover = style.cover
  if (style.highlight) book.highlight = style.highlight
  const place = cleanPlace(parseJson<unknown>(files.get(`${prefix}place.json`)))
  if (place) book.place = place

  const folderList = parseJson<Omit<WikiFolder, 'bookId'>[]>(files.get(`${prefix}wiki/folders.json`))
  const templateMap = parseJson<Record<string, unknown>>(files.get(`${prefix}wiki/templates.json`)) ?? {}
  const folders: WikiFolder[] = (Array.isArray(folderList) ? folderList : [])
    .filter((folder) => folder && typeof folder.id === 'string')
    .map((folder) => {
      const parsed: WikiFolder = {
        id: folder.id,
        bookId,
        parentId: folder.parentId ?? null,
        name: typeof folder.name === 'string' && folder.name.trim() ? folder.name : 'Unbenannt',
        createdAt: Number(folder.createdAt) || 0,
      }
      const template = stringList(templateMap[folder.id])
      if (template.length > 0) parsed.template = template
      return parsed
    })

  const imagePaths = new Map(
    own.filter((path) => path.startsWith(`${prefix}wiki/_images/`)).map((path) => [idOf(path, 'wiki/_images/'), path]),
  )
  const entries: WikiEntry[] = []
  const images: WikiImage[] = []
  for (const path of own) {
    const rest = path.slice(prefix.length)
    if (!rest.startsWith('wiki/') || rest.includes('/', 'wiki/'.length) || !rest.endsWith('.md')) continue
    const parsed = parseEntry(bookId, text(files.get(path)))
    if (!parsed) continue
    // Only images whose bytes are present are kept, so an entry never points at nothing.
    const present = parsed.images.filter((image) => {
      const data = files.get(imagePaths.get(image.id) ?? '')
      return data !== undefined && typeof data !== 'string'
    })
    parsed.entry.imageIds = present.map((image) => image.id)
    entries.push(parsed.entry)
    for (const meta of present) {
      const bytes = files.get(imagePaths.get(meta.id)!) as Uint8Array
      images.push({
        id: meta.id,
        bookId,
        entryId: parsed.entry.id,
        type: meta.type,
        data: bytes.slice().buffer,
        width: Number(meta.width) || 0,
        height: Number(meta.height) || 0,
      })
    }
  }

  return { book, chapters, folders, entries, images }
}

export type PathKind = 'book' | 'chapter' | 'outline' | 'folders' | 'entry' | 'image' | 'tags' | 'templates' | 'style' | 'dates' | 'place'

/** What a repository path holds, or null for files the app does not manage. */
export function classifyPath(path: string): { bookId: string; kind: PathKind; id: string } | null {
  const bookId = bookIdOf(path)
  if (!bookId) return null
  const rest = path.slice(bookPrefix(bookId).length)
  const stem = (value: string) => value.replace(/\.[^./]+$/, '')
  if (rest === 'book.json') return { bookId, kind: 'book', id: bookId }
  if (rest === 'wiki/folders.json') return { bookId, kind: 'folders', id: bookId }
  if (rest === 'tags.json') return { bookId, kind: 'tags', id: bookId }
  if (rest === 'style.json') return { bookId, kind: 'style', id: bookId }
  if (rest === 'dates.json') return { bookId, kind: 'dates', id: bookId }
  if (rest === 'place.json') return { bookId, kind: 'place', id: bookId }
  if (rest === 'wiki/templates.json') return { bookId, kind: 'templates', id: bookId }
  const match = /^(chapters|outline|wiki\/_images|wiki)\/([^/]+)$/.exec(rest)
  if (!match) return null
  const [, folder, file] = match
  if (folder === 'wiki/_images') return { bookId, kind: 'image', id: stem(file) }
  if (!file.endsWith('.md')) return null
  const kind: PathKind = folder === 'chapters' ? 'chapter' : folder === 'outline' ? 'outline' : 'entry'
  return { bookId, kind, id: stem(file) }
}

/** The repository file of a single wiki entry. */
export function entryToFile(entry: WikiEntry, images: Pick<WikiImage, 'id' | 'type' | 'width' | 'height'>[]): string {
  const bundle: BookBundle = {
    book: { id: entry.bookId, title: '', font: 'literata', chapterOrder: [], createdAt: 0, updatedAt: 0 },
    chapters: [],
    folders: [],
    entries: [entry],
    images: images.map((image) => ({ ...image, bookId: entry.bookId, entryId: entry.id, data: new ArrayBuffer(0) })),
  }
  return bundleToFiles(bundle).get(`${bookPrefix(entry.bookId)}wiki/${entry.id}.md`) as string
}
