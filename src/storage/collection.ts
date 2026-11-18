import { DEFAULT_CATEGORY, type CatalogueItem } from '../collection/collectionFile'
import type { Collection, CollectionGuide, CollectionItem } from '../types'
import { announceChange, db, newId } from './connection'

export const COLLECTION_ID = 'collection'

const cleanOptional = (value: string | undefined) => value?.trim() || undefined

/** The collection shared by all books. */
export async function getCollection(): Promise<Collection> {
  const stored = await (await db()).get('shared', COLLECTION_ID)
  if (!stored) return { items: [] }
  const { id: _id, ...collection } = stored
  return collection
}

/** Changes the collection inside one transaction. */
async function changeCollection(change: (collection: Collection) => Collection): Promise<void> {
  const tx = (await db()).transaction('shared', 'readwrite')
  const stored = await tx.store.get(COLLECTION_ID)
  const { id: _id, ...current } = stored ?? { id: COLLECTION_ID, items: [] }
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

const sameKey = (item: { text: string; category: string }) => `${item.category.trim().toLowerCase()}\u0000${item.text.trim().toLowerCase()}`

/** Adds a catalogue: only what is not there yet. The catalogue's rules become the guide. */
export async function importIntoCollection(catalogue: { guide?: CollectionGuide; items: CatalogueItem[] }): Promise<{ added: number; known: number }> {
  let added = 0
  let known = 0
  await changeCollection((collection) => {
    const keys = new Set(collection.items.map(sameKey))
    const now = Date.now()
    const items = [...collection.items]
    for (const entry of catalogue.items) {
      const key = sameKey(entry)
      if (keys.has(key)) {
        known++
        continue
      }
      const item = makeItem(entry, now + added)
      if (!item) continue
      keys.add(key)
      items.push(item)
      added++
    }
    return { ...collection, items, ...(catalogue.guide ? { guide: catalogue.guide } : {}) }
  })
  return { added, known }
}
