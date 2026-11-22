import { cleanDate, cleanPlace, isColor } from '../lib/bookStyle'
import { cleanSpelling } from '../storage/spelling'
import { isStatus } from '../lib/chapterStatus'
import { modulesFile, parseModules } from '../modules/modulesFile'
import { parseShelf, shelfFile } from '../shelf/shelfFile'
import { parseVocabulary, vocabularyFile } from '../vocabulary/vocabularyFile'
import { addressFile, parseAddress } from '../address/addressFile'
import type { Book, BookNote, BookRelations, Relation, RelationType, Chapter, ChapterComment, ChapterGroup, ChapterStatus, ChapterVersion, FontId, TrashItem, WikiEntry, WikiFolder, WikiImage, WikiProperty } from '../types'
import type { FileData } from './hash'

export type { FileData } from './hash'
export type FileSet = Map<string, FileData>

export interface BookBundle {
  book: Book
  chapters: Chapter[]
  folders: WikiFolder[]
  entries: WikiEntry[]
  images: WikiImage[]
  /** Named versions travel; automatic ones stay on the device. */
  versions?: ChapterVersion[]
  /** Deleted chapters and entries, each as the exact text of its file. */
  trash?: TrashItem[]
}

const ROOT = 'books/'
/** The collection shared by all books: outside books/, so older app versions leave it alone. */
export const COLLECTION_PATH = 'collection/collection.json'
/** Favourites of the collection: a file of their own, so older versions cannot drop them. */
export const FAVORITES_PATH = 'collection/favorites.json'
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
  blocks?: string[]
  images: { id: string; type: string; width: number; height: number }[]
  createdAt: number
  updatedAt: number
}

/** Turns one book into repository files. The same book always gives the same bytes. */
export function bundleToFiles({ book, chapters, folders, entries, images, versions = [], trash = [] }: BookBundle): FileSet {
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
  const status = statusFile(ordered)
  if (status) files.set(`${prefix}status.json`, status)
  const comments = commentsFile(ordered)
  if (comments) files.set(`${prefix}comments.json`, comments)
  const groups = groupsFile(book, ordered)
  if (groups) files.set(`${prefix}groups.json`, groups)
  const place = placeFile(book)
  if (place) files.set(`${prefix}place.json`, place)
  const order = orderFile(book)
  if (order) files.set(`${prefix}wiki/order.json`, order)
  const blocks = templateBlocksFile(folders)
  if (blocks) files.set(`${prefix}wiki/template-blocks.json`, blocks)
  const colors = colorsFile(folders)
  if (colors) files.set(`${prefix}wiki/colors.json`, colors)
  if (book.notes?.length) files.set(`${prefix}notes.json`, notesFile(book.notes))
  const relations = book.relations && relationsFile(book.relations)
  if (relations) files.set(`${prefix}wiki/relations.json`, relations)
  const graph = book.graph && graphFile(book.graph)
  if (graph) files.set(`${prefix}wiki/graph.json`, graph)
  const modules = book.modules && modulesFile(book.modules)
  if (modules) files.set(`${prefix}modules.json`, modules)
  const shelf = book.shelf && shelfFile(book.shelf)
  if (shelf) files.set(`${prefix}shelf.json`, shelf)
  // Written whether or not the module is on: switching it off only hides it.
  const vocabulary = book.vocabulary && vocabularyFile(book.vocabulary)
  if (vocabulary) files.set(`${prefix}vocabulary.json`, vocabulary)
  const address = book.address && addressFile(book.address)
  if (address) files.set(`${prefix}address.json`, address)
  for (const version of versions) {
    if (!version.auto) files.set(`${prefix}versions/${version.chapterId}/${version.id}.json`, versionFile(version))
  }
  // Written once when deleted and passed on unchanged, so every device has the same bytes.
  for (const item of trash) files.set(`${prefix}trash/${item.id}.json`, item.file)
  if (book.wikiStars?.length) files.set(`${prefix}wiki/stars.json`, json(book.wikiStars))
  if (book.spelling) files.set(`${prefix}spelling.json`, json(book.spelling))

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
      properties: entry.properties.map(({ id, key, value, group }) => (group ? { id, key, value, group } : { id, key, value })),
      ...(entry.blocks?.length ? { blocks: entry.blocks } : {}),
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

/** status.json: chapter id to how far it is, in chapter order. Undefined when none has one. */
export function statusFile(ordered: Chapter[]): string | undefined {
  const entries = ordered.filter((chapter) => chapter.status).map((chapter) => [chapter.id, chapter.status] as const)
  return entries.length > 0 ? json(Object.fromEntries(entries)) : undefined
}

/** The usable entries of a status.json; null when the file is not a JSON object. */
export function parseStatus(data: FileData | undefined): Record<string, ChapterStatus> | null {
  const value = parseJson<unknown>(data)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return Object.fromEntries(Object.entries(value).filter(([, status]) => isStatus(status))) as Record<string, ChapterStatus>
}

/** comments.json: chapter id to its comments, in chapter order. Undefined when there are none. */
export function commentsFile(ordered: Chapter[]): string | undefined {
  const entries = ordered
    .filter((chapter) => chapter.comments?.length)
    .map((chapter) => [chapter.id, chapter.comments!.map(({ id, from, to, quote, text, done, createdAt, updatedAt }) => ({ id, from, to, quote, text, done, createdAt, updatedAt }))] as const)
  return entries.length > 0 ? json(Object.fromEntries(entries)) : undefined
}

/** The usable comments of a comments.json; null when the file is not a JSON object. */
export function parseComments(data: FileData | undefined): Record<string, ChapterComment[]> | null {
  const value = parseJson<unknown>(data)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result: Record<string, ChapterComment[]> = {}
  for (const [chapterId, list] of Object.entries(value)) {
    if (!Array.isArray(list)) continue
    const comments = list.flatMap((raw): ChapterComment[] => {
      if (!raw || typeof raw !== 'object') return []
      const c = raw as Record<string, unknown>
      if (typeof c.id !== 'string' || typeof c.text !== 'string') return []
      return [
        {
          id: c.id,
          from: Math.max(0, Number(c.from) || 0),
          to: Math.max(0, Number(c.to) || 0),
          quote: typeof c.quote === 'string' ? c.quote : '',
          text: c.text,
          done: c.done === true,
          createdAt: Number(c.createdAt) || 0,
          updatedAt: Number(c.updatedAt) || 0,
        },
      ]
    })
    if (comments.length) result[chapterId] = comments
  }
  return result
}

/** wiki/relations.json: kinds of relationship and the relationships. Undefined when empty. */
export function relationsFile(relations: BookRelations): string | undefined {
  if (!relations.types.length && !relations.relations.length && !relations.deleted?.length) return undefined
  return json({
    types: relations.types.map(({ id, forward, backward }) => ({ id, forward, ...(backward ? { backward } : {}) })),
    relations: [...relations.relations]
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map(({ id, from, to, typeId, note, createdAt, updatedAt }) => ({ id, from, to, typeId, ...(note ? { note } : {}), createdAt, updatedAt })),
    ...(relations.deleted?.length ? { deleted: [...relations.deleted].sort() } : {}),
  })
}

export function parseRelations(data: FileData | undefined): BookRelations | null {
  const value = parseJson<Record<string, unknown>>(data)
  if (!value || typeof value !== 'object' || !Array.isArray(value.types) || !Array.isArray(value.relations)) return null
  const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
  const types = value.types.flatMap((raw): RelationType[] => {
    const t = raw as Record<string, unknown>
    if (!t || !str(t.id) || !str(t.forward)) return []
    return [{ id: t.id, forward: t.forward, ...(str(t.backward) ? { backward: t.backward } : {}) }]
  })
  const relations = value.relations.flatMap((raw): Relation[] => {
    const r = raw as Record<string, unknown>
    if (!r || !str(r.id) || !str(r.from) || !str(r.to) || !str(r.typeId)) return []
    return [{ id: r.id, from: r.from, to: r.to, typeId: r.typeId, ...(str(r.note) ? { note: r.note } : {}), createdAt: Number(r.createdAt) || 0, updatedAt: Number(r.updatedAt) || 0 }]
  })
  const result: BookRelations = { types, relations }
  const deleted = Array.isArray(value.deleted) ? value.deleted.filter(str) : []
  if (deleted.length) result.deleted = deleted
  return result
}

/** Both sides changed: everything from both, newer relationship versions win, deletions from either side kept. */
export function mergeRelations(mine: BookRelations, theirs: BookRelations): BookRelations {
  const deleted = [...new Set([...(mine.deleted ?? []), ...(theirs.deleted ?? [])])].sort()
  const gone = new Set(deleted)
  const types = new Map<string, RelationType>()
  for (const type of [...theirs.types, ...mine.types]) if (!gone.has(type.id)) types.set(type.id, type)
  const relations = new Map<string, Relation>()
  for (const relation of [...theirs.relations, ...mine.relations]) {
    if (gone.has(relation.id) || gone.has(relation.typeId)) continue
    const other = relations.get(relation.id)
    if (!other || other.updatedAt <= relation.updatedAt) relations.set(relation.id, relation)
  }
  const merged: BookRelations = { types: [...types.values()], relations: [...relations.values()].sort((a, b) => a.createdAt - b.createdAt) }
  if (deleted.length) merged.deleted = deleted
  return merged
}

/** wiki/graph.json: where entries were placed in the relationship network, sorted by id. */
export function graphFile(graph: Record<string, { x: number; y: number }>): string | undefined {
  const entries = Object.entries(graph).sort(([a], [b]) => a.localeCompare(b))
  return entries.length > 0 ? json(Object.fromEntries(entries.map(([id, { x, y }]) => [id, { x, y }]))) : undefined
}

export function parseGraph(data: FileData | undefined): Record<string, { x: number; y: number }> | null {
  const value = parseJson<unknown>(data)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result: Record<string, { x: number; y: number }> = {}
  for (const [id, point] of Object.entries(value)) {
    const p = point as { x?: unknown; y?: unknown }
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) result[id] = { x: Math.round(p.x as number), y: Math.round(p.y as number) }
  }
  return result
}

/** groups.json: the chapter groups and which chapter is in which. Undefined when there are no groups. */
export function groupsFile(book: Pick<Book, 'chapterGroups'>, ordered: Chapter[]): string | undefined {
  const groups = book.chapterGroups ?? []
  if (!groups.length) return undefined
  return json({
    groups: groups.map(({ id, name }) => ({ id, name })),
    chapters: Object.fromEntries(ordered.filter((chapter) => chapter.group).map((chapter) => [chapter.id, chapter.group])),
  })
}

export function parseGroups(data: FileData | undefined): { groups: ChapterGroup[]; chapters: Record<string, string> } | null {
  const value = parseJson<Record<string, unknown>>(data)
  if (!value || typeof value !== 'object' || !Array.isArray(value.groups)) return null
  const groups = value.groups.flatMap((raw): ChapterGroup[] => {
    const g = raw as Record<string, unknown>
    return g && typeof g.id === 'string' && typeof g.name === 'string' && g.name.trim() ? [{ id: g.id, name: g.name }] : []
  })
  const chapters: Record<string, string> = {}
  if (value.chapters && typeof value.chapters === 'object')
    for (const [id, group] of Object.entries(value.chapters as Record<string, unknown>)) if (typeof group === 'string') chapters[id] = group
  return { groups, chapters }
}

/** place.json: where text was last changed. */
export function placeFile(book: Pick<Book, 'place'>): string | undefined {
  return book.place ? json({ chapterId: book.place.chapterId, offset: book.place.offset, at: book.place.at }) : undefined
}

/** notes.json: the notepad, as stored. */
export function notesFile(notes: BookNote[]): string {
  return json(
    notes.map(({ id, text, chapterId, from, done, createdAt, updatedAt }) => ({
      id,
      text,
      ...(chapterId ? { chapterId } : {}),
      ...(from !== undefined ? { from } : {}),
      done,
      createdAt,
      updatedAt,
    })),
  )
}

/** The usable notes of a notes.json; null when the file is not a list. */
export function parseNotes(data: FileData | undefined): BookNote[] | null {
  const parsed = parseJson<unknown>(data)
  if (!Array.isArray(parsed)) return null
  return parsed.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const value = raw as Record<string, unknown>
    if (typeof value.id !== 'string' || typeof value.text !== 'string' || !value.text.trim()) return []
    const note: BookNote = {
      id: value.id,
      text: value.text,
      done: value.done === true,
      createdAt: Number(value.createdAt) || 0,
      updatedAt: Number(value.updatedAt) || 0,
    }
    if (typeof value.chapterId === 'string') note.chapterId = value.chapterId
    if (typeof value.from === 'number' && value.from >= 0) note.from = value.from
    return [note]
  })
}

/** wiki/template-blocks.json: folder id to its starred blocks and which template field is in which. */
export function templateBlocksFile(folders: WikiFolder[]): string | undefined {
  const entries = [...folders]
    .filter((folder) => folder.templateBlocks?.length)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((folder) => [folder.id, { blocks: folder.templateBlocks, fields: folder.templateGroups ?? {} }] as const)
  return entries.length > 0 ? json(Object.fromEntries(entries)) : undefined
}

/** The usable content of a wiki/template-blocks.json; null when the file is not a JSON object. */
export function parseTemplateBlocks(data: FileData | undefined): Record<string, { blocks: string[]; fields: Record<string, string> }> | null {
  const parsed = parseJson<unknown>(data)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const result: Record<string, { blocks: string[]; fields: Record<string, string> }> = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const blocks = stringList((value as { blocks?: unknown }).blocks)
    if (blocks.length === 0) continue
    const fields: Record<string, string> = {}
    const rawFields = (value as { fields?: unknown }).fields
    if (rawFields && typeof rawFields === 'object')
      for (const [key, block] of Object.entries(rawFields as Record<string, unknown>))
        if (typeof block === 'string' && blocks.includes(block)) fields[key] = block
    result[id] = { blocks, fields }
  }
  return result
}

/** wiki/colors.json: folder id to colour, by folder id. Undefined when no folder has one. */
export function colorsFile(folders: WikiFolder[]): string | undefined {
  const entries = [...folders]
    .filter((folder) => folder.color)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((folder) => [folder.id, folder.color] as const)
  return entries.length > 0 ? json(Object.fromEntries(entries)) : undefined
}

/** The usable colours of a wiki/colors.json; null when the file is not a JSON object. */
export function parseColors(data: FileData | undefined): Record<string, string> | null {
  const parsed = parseJson<unknown>(data)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const colors: Record<string, string> = {}
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) if (isColor(value)) colors[id] = value.trim()
  return colors
}

/** wiki/order.json: the writer's order of folders and entries. Undefined when there is none. */
export function orderFile(book: Pick<Book, 'wikiOrder'>): string | undefined {
  const keys = Object.keys(book.wikiOrder ?? {})
    .filter((key) => book.wikiOrder![key].length > 0)
    .sort((a, b) => (a === '_root' ? -1 : b === '_root' ? 1 : a.localeCompare(b)))
  return keys.length > 0 ? json(Object.fromEntries(keys.map((key) => [key, book.wikiOrder![key]]))) : undefined
}

/** The usable lists of a wiki/order.json; null when the file is not a JSON object. */
export function parseOrder(data: FileData | undefined): Record<string, string[]> | null {
  const parsed = parseJson<unknown>(data)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const order: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue
    const ids = value.filter((id): id is string => typeof id === 'string' && id.length > 0)
    if (ids.length > 0) order[key] = ids
  }
  return order
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
      properties: (Array.isArray(header.properties) ? header.properties : []).map((property: WikiProperty) => {
        const group = typeof property.group === 'string' && property.group.trim() ? property.group : undefined
        const { group: _ignored, ...rest } = property
        void _ignored
        return group ? { ...rest, group } : rest
      }),
      ...(stringList(header.blocks).length > 0 ? { blocks: stringList(header.blocks) } : {}),
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
  const statusMap = parseStatus(files.get(`${prefix}status.json`)) ?? {}
  const commentMap = parseComments(files.get(`${prefix}comments.json`)) ?? {}
  const groupFile = parseGroups(files.get(`${prefix}groups.json`))
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
    const status = statusMap[meta.id]
    if (status) chapter.status = status
    const comments = commentMap[meta.id]
    if (comments) chapter.comments = comments
    const group = groupFile?.chapters[meta.id]
    if (group) chapter.group = group
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
  const spelling = cleanSpelling(parseJson<unknown>(files.get(`${prefix}spelling.json`)))
  if (spelling) book.spelling = spelling
  const notes = parseNotes(files.get(`${prefix}notes.json`))
  if (notes?.length) book.notes = notes
  const relations = parseRelations(files.get(`${prefix}wiki/relations.json`))
  if (relations) book.relations = relations
  if (groupFile?.groups.length) book.chapterGroups = groupFile.groups
  const graph = parseGraph(files.get(`${prefix}wiki/graph.json`))
  if (graph && Object.keys(graph).length) book.graph = graph
  const modules = parseModules(files.get(`${prefix}modules.json`))
  if (modules && Object.keys(modules).length) book.modules = modules
  const shelf = parseShelf(files.get(`${prefix}shelf.json`))
  if (shelf && shelfFile(shelf)) book.shelf = shelf
  const vocabulary = parseVocabulary(files.get(`${prefix}vocabulary.json`))
  if (vocabulary && vocabularyFile(vocabulary)) book.vocabulary = vocabulary
  const address = parseAddress(files.get(`${prefix}address.json`))
  if (address && addressFile(address)) book.address = address
  const stars = stringList(parseJson<unknown>(files.get(`${prefix}wiki/stars.json`)))
  if (stars.length > 0) book.wikiStars = stars
  const wikiOrder = parseOrder(files.get(`${prefix}wiki/order.json`))
  if (wikiOrder && Object.keys(wikiOrder).length > 0) book.wikiOrder = wikiOrder

  const folderList = parseJson<Omit<WikiFolder, 'bookId'>[]>(files.get(`${prefix}wiki/folders.json`))
  const templateMap = parseJson<Record<string, unknown>>(files.get(`${prefix}wiki/templates.json`)) ?? {}
  const colorMap = parseColors(files.get(`${prefix}wiki/colors.json`)) ?? {}
  const blockMap = parseTemplateBlocks(files.get(`${prefix}wiki/template-blocks.json`)) ?? {}
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
      if (colorMap[folder.id]) parsed.color = colorMap[folder.id]
      const layout = blockMap[folder.id]
      if (layout) {
        parsed.templateBlocks = layout.blocks
        if (Object.keys(layout.fields).length > 0) parsed.templateGroups = layout.fields
      }
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

  const versions = own
    .filter((path) => classifyPath(path)?.kind === 'version')
    .flatMap((path) => {
      const version = parseVersion(bookId, files.get(path))
      return version ? [version] : []
    })
  const trash = own.flatMap((path) => {
    const info = classifyPath(path)
    const item = info?.kind === 'trash' ? parseTrash(bookId, info.id, files.get(path)) : null
    return item ? [item] : []
  })
  return { book, chapters, folders, entries, images, ...(versions.length ? { versions } : {}), ...(trash.length ? { trash } : {}) }
}

/** trash/<id>.json: something deleted, kept as its exact text. Null unless it names itself and its kind. */
export function parseTrash(bookId: string, id: string, data: FileData | undefined): TrashItem | null {
  if (data === undefined) return null
  const file = text(data)
  const value = parseJson<Record<string, unknown>>(file)
  if (!value || value.id !== id || typeof value.kind !== 'string') return null
  return {
    id,
    bookId,
    kind: value.kind,
    title: typeof value.title === 'string' ? value.title : '',
    deletedAt: Number(value.deletedAt) || 0,
    file,
  }
}

/** versions/<chapter>/<id>.json: a named version of a chapter. */
export function versionFile({ id, chapterId, label, createdAt, content }: ChapterVersion): string {
  return json({ id, chapterId, ...(label ? { label } : {}), createdAt, content })
}

export function parseVersion(bookId: string, data: FileData | undefined): ChapterVersion | null {
  const value = parseJson<Record<string, unknown>>(data)
  if (!value || typeof value.id !== 'string' || typeof value.chapterId !== 'string' || typeof value.content !== 'string') return null
  const version: ChapterVersion = { id: value.id, bookId, chapterId: value.chapterId, content: value.content, createdAt: Number(value.createdAt) || 0, auto: false }
  if (typeof value.label === 'string' && value.label.trim()) version.label = value.label.trim()
  return version
}

export type PathKind = 'book' | 'chapter' | 'outline' | 'folders' | 'entry' | 'image' | 'tags' | 'templates' | 'style' | 'dates' | 'place' | 'wikiOrder' | 'folderColors' | 'notes' | 'stars' | 'templateBlocks' | 'spelling' | 'collection' | 'favorites' | 'version' | 'status' | 'comments' | 'relations' | 'graph' | 'groups' | 'modules' | 'shelf' | 'vocabulary' | 'address' | 'trash'

/** What a repository path holds, or null for files the app does not manage. */
export function classifyPath(path: string): { bookId: string; kind: PathKind; id: string } | null {
  if (path === COLLECTION_PATH) return { bookId: '', kind: 'collection', id: 'collection' }
  if (path === FAVORITES_PATH) return { bookId: '', kind: 'favorites', id: 'favorites' }
  const bookId = bookIdOf(path)
  if (!bookId) return null
  const rest = path.slice(bookPrefix(bookId).length)
  const stem = (value: string) => value.replace(/\.[^./]+$/, '')
  if (rest === 'book.json') return { bookId, kind: 'book', id: bookId }
  if (rest === 'wiki/folders.json') return { bookId, kind: 'folders', id: bookId }
  if (rest === 'tags.json') return { bookId, kind: 'tags', id: bookId }
  if (rest === 'style.json') return { bookId, kind: 'style', id: bookId }
  if (rest === 'dates.json') return { bookId, kind: 'dates', id: bookId }
  if (rest === 'status.json') return { bookId, kind: 'status', id: bookId }
  if (rest === 'groups.json') return { bookId, kind: 'groups', id: bookId }
  if (rest === 'modules.json') return { bookId, kind: 'modules', id: bookId }
  if (rest === 'shelf.json') return { bookId, kind: 'shelf', id: bookId }
  if (rest === 'vocabulary.json') return { bookId, kind: 'vocabulary', id: bookId }
  if (rest === 'address.json') return { bookId, kind: 'address', id: bookId }
  if (rest === 'comments.json') return { bookId, kind: 'comments', id: bookId }
  if (rest === 'place.json') return { bookId, kind: 'place', id: bookId }
  if (rest === 'wiki/templates.json') return { bookId, kind: 'templates', id: bookId }
  if (rest === 'wiki/order.json') return { bookId, kind: 'wikiOrder', id: bookId }
  if (rest === 'wiki/relations.json') return { bookId, kind: 'relations', id: bookId }
  if (rest === 'wiki/graph.json') return { bookId, kind: 'graph', id: bookId }
  if (rest === 'wiki/colors.json') return { bookId, kind: 'folderColors', id: bookId }
  if (rest === 'wiki/template-blocks.json') return { bookId, kind: 'templateBlocks', id: bookId }
  if (rest === 'notes.json') return { bookId, kind: 'notes', id: bookId }
  if (rest === 'spelling.json') return { bookId, kind: 'spelling', id: bookId }
  if (rest === 'wiki/stars.json') return { bookId, kind: 'stars', id: bookId }
  const trash = /^trash\/([^/]+)\.json$/.exec(rest)
  if (trash) return { bookId, kind: 'trash', id: trash[1] }
  const version = /^versions\/[^/]+\/([^/]+)\.json$/.exec(rest)
  if (version) return { bookId, kind: 'version', id: version[1] }
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
