import type { Book, BookRelations, Relation, RelationType } from '../types'
import { announceChange, db, newId } from './connection'

const empty = (): BookRelations => ({ types: [], relations: [] })

async function change(bookId: string, update: (relations: BookRelations) => BookRelations): Promise<void> {
  const tx = (await db()).transaction('books', 'readwrite')
  const book = await tx.store.get(bookId)
  if (book) await tx.store.put({ ...book, relations: update(book.relations ?? empty()) })
  await tx.done
  if (book) announceChange()
}

const forget = (relations: BookRelations, ids: string[]): string[] => [...new Set([...(relations.deleted ?? []), ...ids])]

export async function addRelationType(bookId: string, forward: string, backward?: string): Promise<RelationType> {
  const type: RelationType = { id: newId(), forward: forward.trim() }
  if (backward?.trim() && backward.trim() !== type.forward) type.backward = backward.trim()
  await change(bookId, (relations) => ({ ...relations, types: [...relations.types, type] }))
  return type
}

export async function updateRelationType(bookId: string, id: string, forward: string, backward?: string): Promise<void> {
  await change(bookId, (relations) => ({
    ...relations,
    types: relations.types.map((type) => {
      if (type.id !== id) return type
      const next: RelationType = { id, forward: forward.trim() || type.forward }
      if (backward?.trim() && backward.trim() !== next.forward) next.backward = backward.trim()
      return next
    }),
  }))
}

/** Removes the kind and every relationship of that kind. */
export async function deleteRelationType(bookId: string, id: string): Promise<void> {
  await change(bookId, (relations) => {
    const gone = relations.relations.filter((relation) => relation.typeId === id).map((relation) => relation.id)
    return {
      types: relations.types.filter((type) => type.id !== id),
      relations: relations.relations.filter((relation) => relation.typeId !== id),
      deleted: forget(relations, [id, ...gone]),
    }
  })
}

export async function addRelation(bookId: string, input: { from: string; to: string; typeId: string; note?: string }): Promise<Relation> {
  const now = Date.now()
  const relation: Relation = { id: newId(), from: input.from, to: input.to, typeId: input.typeId, createdAt: now, updatedAt: now }
  if (input.note?.trim()) relation.note = input.note.trim()
  await change(bookId, (relations) => ({ ...relations, relations: [...relations.relations, relation] }))
  return relation
}

export async function updateRelation(bookId: string, id: string, patch: { note?: string }): Promise<void> {
  await change(bookId, (relations) => ({
    ...relations,
    relations: relations.relations.map((relation) => {
      if (relation.id !== id) return relation
      const next: Relation = { ...relation, updatedAt: Date.now() }
      if (patch.note?.trim()) next.note = patch.note.trim()
      else delete next.note
      return next
    }),
  }))
}

export async function deleteRelation(bookId: string, id: string): Promise<void> {
  await change(bookId, (relations) => ({
    ...relations,
    relations: relations.relations.filter((relation) => relation.id !== id),
    deleted: forget(relations, [id]),
  }))
}

export interface SeenRelation {
  id: string
  /** The name from this entry's side. */
  label: string
  other: string
  note?: string
}

/** An entry's relationships, each named from its own side, in the order they were made. */
export function relationsOf(book: Pick<Book, 'relations'>, entryId: string): SeenRelation[] {
  const types = new Map((book.relations?.types ?? []).map((type) => [type.id, type]))
  return (book.relations?.relations ?? []).flatMap((relation) => {
    const type = types.get(relation.typeId)
    if (!type || (relation.from !== entryId && relation.to !== entryId)) return []
    const forward = relation.from === entryId
    const seen: SeenRelation = { id: relation.id, label: forward ? type.forward : (type.backward ?? type.forward), other: forward ? relation.to : relation.from }
    if (relation.note) seen.note = relation.note
    return [seen]
  })
}

/** Remembers where entries were placed in the relationship network. */
export async function placeInGraph(bookId: string, places: Record<string, { x: number; y: number }>): Promise<void> {
  const tx = (await db()).transaction('books', 'readwrite')
  const book = await tx.store.get(bookId)
  if (book) {
    const rounded = Object.fromEntries(Object.entries(places).map(([id, point]) => [id, { x: Math.round(point.x), y: Math.round(point.y) }]))
    await tx.store.put({ ...book, graph: { ...book.graph, ...rounded } })
  }
  await tx.done
  if (book) announceChange()
}

/** Forgets every placement: the network arranges itself again. */
export async function clearGraph(bookId: string): Promise<void> {
  const tx = (await db()).transaction('books', 'readwrite')
  const book = await tx.store.get(bookId)
  if (book?.graph) {
    const next = { ...book }
    delete next.graph
    await tx.store.put(next)
  }
  await tx.done
  if (book) announceChange()
}
