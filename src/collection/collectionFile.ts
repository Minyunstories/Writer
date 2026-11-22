import type { Collection, CollectionGuide, CollectionItem } from '../types'
import { text, type FileData } from '../sync/files'

export { COLLECTION_PATH } from '../sync/files'
export const DEFAULT_CATEGORY = 'Allgemein'

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''
const texts = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isText) : [])

function writeItem({ id, text, category, group, tags, note, source, createdAt, updatedAt }: CollectionItem) {
  return {
    id,
    text,
    category,
    ...(group ? { group } : {}),
    ...(tags?.length ? { tags } : {}),
    ...(note ? { note } : {}),
    ...(source ? { source: { bookId: source.bookId, bookTitle: source.bookTitle, chapterId: source.chapterId, offset: source.offset } } : {}),
    createdAt,
    updatedAt,
  }
}

/** True when there is anything to keep or synchronise. */
export const hasCollection = (collection: Collection) =>
  collection.items.length > 0 || (collection.deleted?.length ?? 0) > 0 || collection.guide !== undefined

/** collection/collection.json. The same collection always gives the same bytes. */
export function collectionFile(collection: Collection): string {
  const items = [...collection.items].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map(writeItem)
  return json({
    ...(collection.guide ? { guide: collection.guide } : {}),
    items,
    ...(collection.deleted?.length ? { deleted: [...collection.deleted].sort() } : {}),
  })
}

function readItem(raw: unknown): CollectionItem[] {
  if (!raw || typeof raw !== 'object') return []
  const value = raw as Record<string, unknown>
  if (!isText(value.id) || !isText(value.text)) return []
  const item: CollectionItem = {
    id: value.id,
    text: value.text,
    category: isText(value.category) ? value.category : DEFAULT_CATEGORY,
    createdAt: Number(value.createdAt) || 0,
    updatedAt: Number(value.updatedAt) || 0,
  }
  if (isText(value.group)) item.group = value.group
  const tags = texts(value.tags)
  if (tags.length) item.tags = tags
  if (isText(value.note)) item.note = value.note
  const source = value.source as Record<string, unknown> | undefined
  if (source && isText(source.bookId) && isText(source.chapterId) && typeof source.offset === 'number')
    item.source = {
      bookId: source.bookId,
      bookTitle: typeof source.bookTitle === 'string' ? source.bookTitle : '',
      chapterId: source.chapterId,
      offset: Math.max(0, source.offset),
    }
  return [item]
}

function readGuide(raw: unknown): CollectionGuide | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const guide: CollectionGuide = { title: isText(value.title) ? value.title : 'Hinweise', rules: texts(value.rules), selfcheck: texts(value.selfcheck) }
  if (value.notes && typeof value.notes === 'object') {
    const notes = Object.fromEntries(Object.entries(value.notes as Record<string, unknown>).filter(([, note]) => isText(note))) as Record<string, string>
    if (Object.keys(notes).length) guide.notes = notes
  }
  return guide.rules.length || guide.selfcheck.length ? guide : undefined
}

/** The usable part of a collection file; null when it is not one. */
export function parseCollection(data: FileData | undefined): Collection | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text(data))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const value = parsed as Record<string, unknown>
  if (!Array.isArray(value.items)) return null
  const collection: Collection = { items: value.items.flatMap(readItem) }
  const deleted = texts(value.deleted)
  if (deleted.length) collection.deleted = deleted
  const guide = readGuide(value.guide)
  if (guide) collection.guide = guide
  return collection
}

/** Both sides changed: every item in its newer version, deletions from either side kept. */
export function mergeCollections(mine: Collection, theirs: Collection): Collection {
  const deleted = [...new Set([...(mine.deleted ?? []), ...(theirs.deleted ?? [])])].sort()
  const gone = new Set(deleted)
  const byId = new Map<string, CollectionItem>()
  for (const item of [...theirs.items, ...mine.items]) {
    if (gone.has(item.id)) continue
    const other = byId.get(item.id)
    if (!other || other.updatedAt <= item.updatedAt) byId.set(item.id, item)
  }
  const merged: Collection = { items: [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)) }
  if (deleted.length) merged.deleted = deleted
  const guide = mine.guide ?? theirs.guide
  if (guide) merged.guide = guide
  return merged
}

export interface CatalogueItem {
  text: string
  category: string
  group?: string
  tags?: string[]
  /** A short hint (e.g. a German gloss) that comes with the entry. */
  note?: string
}

interface CatalogueData {
  rules?: unknown
  selfcheck?: unknown
  /** Only fill hints and markers of entries that exist; add nothing (so deleted words stay deleted). */
  fillOnly?: unknown
  categories?: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Tags without repeats; spellings that differ only in case count as one (the first stays). */
export function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>()
  return tags.map((tag) => tag.trim()).filter((tag) => tag && !seen.has(tag.toLowerCase()) && seen.add(tag.toLowerCase()))
}

/** The Reaction-Beat catalogue (its HTML page, or the data alone as JSON) as collection items. */
export function parseCatalogue(source: string): { guide: CollectionGuide; items: CatalogueItem[]; fillOnly?: boolean } | null {
  const match = /const DATA = (\{[\s\S]*?\n\});/.exec(source)
  let data: CatalogueData
  try {
    data = JSON.parse(match ? match[1] : source) as CatalogueData
  } catch {
    return null
  }
  if (!data || !Array.isArray(data.categories)) return null
  const items: CatalogueItem[] = []
  const notes: Record<string, string> = {}
  for (const category of data.categories) {
    if (!isRecord(category) || !isText(category.title)) continue
    const name = category.num !== undefined ? `${String(category.num)}. ${category.title}` : category.title
    const note = [category.target, category.note].filter(isText).join(' — ')
    if (note) notes[name] = note
    for (const group of Array.isArray(category.groups) ? category.groups : []) {
      if (!isRecord(group)) continue
      // An entry is its text, or an object with text, hint and markers.
      for (const entry of Array.isArray(group.items) ? (group.items as unknown[]) : []) {
        const raw = isRecord(entry) ? entry : { text: entry }
        if (!isText(raw.text)) continue
        const item: CatalogueItem = { text: raw.text.trim(), category: name }
        if (isText(group.label)) item.group = group.label
        const tags = uniqueTags([...(isText(category.part) ? [category.part] : []), ...texts(raw.tags)])
        if (tags.length) item.tags = tags
        if (isText(raw.note)) item.note = raw.note.trim()
        items.push(item)
      }
    }
  }
  const guide: CollectionGuide = { title: 'Reaction-Beat-Katalog', rules: texts(data.rules), selfcheck: texts(data.selfcheck) }
  if (Object.keys(notes).length) guide.notes = notes
  return { guide, items, ...(data.fillOnly === true ? { fillOnly: true } : {}) }
}
