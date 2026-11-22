import { DEFAULT_CATEGORY, uniqueTags, type CatalogueItem } from '../collection/collectionFile'
import type { Collection, CollectionGuide, CollectionItem } from '../types'
import { announceChange, db, newId } from './connection'

export const COLLECTION_ID = 'collection'

const cleanOptional = (value: string | undefined) => value?.trim() || undefined

/** The collection shared by all books. */
export async function getCollection(): Promise<Collection> {
  const stored = await (await db()).get('shared', COLLECTION_ID)
  if (!stored || !('items' in stored)) return { items: [] }
  const { id: _id, ...collection } = stored
  return collection
}

/** Changes the collection inside one transaction. */
async function changeCollection(change: (collection: Collection) => Collection): Promise<void> {
  const tx = (await db()).transaction('shared', 'readwrite')
  const stored = await tx.store.get(COLLECTION_ID)
  const { id: _id, ...current } = stored && 'items' in stored ? stored : { id: COLLECTION_ID, items: [] }
  await tx.store.put({ ...change(current), id: COLLECTION_ID })
  await tx.done
  announceChange()
}

export interface NewCollectionItem {
  text: string
  category: string
  group?: string
  tags?: string[]
  note?: string
  source?: CollectionItem['source']
}

function makeItem(input: NewCollectionItem, now: number): CollectionItem | null {
  const text = input.text.trim()
  if (!text) return null
  const item: CollectionItem = { id: newId(), text, category: input.category.trim() || DEFAULT_CATEGORY, createdAt: now, updatedAt: now }
  const group = cleanOptional(input.group)
  if (group) item.group = group
  const note = cleanOptional(input.note)
  if (note) item.note = note
  const tags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean)
  if (tags.length) item.tags = tags
  if (input.source) item.source = input.source
  return item
}

export async function addToCollection(input: NewCollectionItem): Promise<CollectionItem | null> {
  const item = makeItem(input, Date.now())
  if (!item) return null
  await changeCollection((collection) => ({ ...collection, items: [...collection.items, item] }))
  return item
}

export async function updateCollectionItem(id: string, patch: Partial<Pick<CollectionItem, 'text' | 'category' | 'group' | 'note'>>): Promise<void> {
  await changeCollection((collection) => ({
    ...collection,
    items: collection.items.map((item) => {
      if (item.id !== id) return item
      const next: CollectionItem = { ...item, updatedAt: Date.now() }
      if (patch.text?.trim()) next.text = patch.text.trim()
      if (patch.category !== undefined) next.category = patch.category.trim() || DEFAULT_CATEGORY
      for (const key of ['group', 'note'] as const) {
        if (patch[key] === undefined) continue
        const value = cleanOptional(patch[key])
        if (value) next[key] = value
        else delete next[key]
      }
      return next
    }),
  }))
}

export async function deleteCollectionItem(id: string): Promise<void> {
  await changeCollection((collection) => ({
    ...collection,
    items: collection.items.filter((item) => item.id !== id),
    deleted: [...new Set([...(collection.deleted ?? []), id])],
  }))
}

/** Deletes every item of one category; their ids are remembered for the sync. Returns how many. */
export async function deleteCollectionCategory(category: string): Promise<number> {
  const current = await getCollection()
  const ids = current.items.filter((item) => item.category === category).map((item) => item.id)
  if (ids.length === 0) return 0
  let removed = 0
  await changeCollection((collection) => {
    const gone = collection.items.filter((item) => item.category === category).map((item) => item.id)
    removed = gone.length
    return {
      ...collection,
      items: collection.items.filter((item) => item.category !== category),
      deleted: [...new Set([...(collection.deleted ?? []), ...gone])],
    }
  })
  return removed
}

const sameKey = (item: { text: string; category: string }) => `${item.category.trim().toLowerCase()}\u0000${item.text.trim().toLowerCase()}`

/** Adds a catalogue: only what is not there yet. The catalogue's rules become the guide. */
export async function importIntoCollection(catalogue: {
  guide?: CollectionGuide
  items: CatalogueItem[]
  fillOnly?: boolean
}): Promise<{ added: number; known: number; updated: number }> {
  let added = 0
  let known = 0
  let updated = 0
  await changeCollection((collection) => {
    const now = Date.now()
    const items = [...collection.items]
    const at = new Map(items.map((item, index) => [sameKey(item), index]))
    const addedNow = new Set<string>()
    for (const entry of catalogue.items) {
      const key = sameKey(entry)
      // The same word twice in one file counts once.
      if (addedNow.has(key)) continue
      const index = at.get(key)
      if (index !== undefined) {
        known++
        // Known already: fill an empty hint and add missing markers, never replace anything.
        const item = items[index]
        const note = !item.note?.trim() && entry.note?.trim() ? entry.note.trim() : undefined
        const tags = uniqueTags([...(item.tags ?? []), ...(entry.tags ?? [])])
        const moreTags = tags.length > uniqueTags(item.tags ?? []).length
        if (note || moreTags) {
          // Only one step later: an edit on the other device (made at its real time) still wins the merge.
          items[index] = { ...item, ...(note ? { note } : {}), ...(moreTags ? { tags } : {}), updatedAt: item.updatedAt + 1 }
          updated++
        }
        continue
      }
      if (catalogue.fillOnly) continue
      const item = makeItem({ ...entry, tags: uniqueTags(entry.tags ?? []) }, now + added)
      if (!item) continue
      at.set(key, items.length)
      addedNow.add(key)
      items.push(item)
      added++
    }
    return { ...collection, items, ...(catalogue.guide ? { guide: catalogue.guide } : {}) }
  })
  return { added, known, updated }
}
