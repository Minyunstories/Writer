import { planAddressImport, type AddressImport, type ImportReport } from '../address/importFile'
import type { AddressChange, AddressForm, AddressPerson, AddressPersonChange, AddressRank, BookAddress, WikiEntry } from '../types'
import { announceChange, db, newId } from './connection'

const empty = (): BookAddress => ({ ranks: [], people: [], forms: [] })

/** Changes the address data of one book in a single transaction; an update returning null leaves it as it is. */
async function change(bookId: string, update: (address: BookAddress) => BookAddress | null): Promise<void> {
  const tx = (await db()).transaction('books', 'readwrite')
  const book = await tx.store.get(bookId)
  const next = book ? update(book.address ?? empty()) : null
  if (book && next) await tx.store.put({ ...book, address: next })
  await tx.done
  if (book && next) announceChange()
}

/** Trimmed text, or undefined when there is none. */
const clean = (text: string | undefined) => text?.trim() || undefined

/** Sets or removes optional text fields on a copy. */
function setTexts<T extends object>(target: T, fields: Partial<Record<keyof T, string | undefined>>): T {
  const next = { ...target } as Record<string, unknown>
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    const text = clean(value as string)
    if (text) next[key] = text
    else delete next[key]
  }
  return next as T
}

const forget = (address: BookAddress, ids: string[]) => [...new Set([...(address.deleted ?? []), ...ids])]
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Dated changes in chapter order; open ones (or in deleted chapters) after them, as they were. */
function byChapter<T extends { chapterId?: string }>(changes: T[], chapterOrder: string[]): T[] {
  const place = (change: T) => (change.chapterId && chapterOrder.includes(change.chapterId) ? chapterOrder.indexOf(change.chapterId) : chapterOrder.length)
  return changes.map((change, index) => ({ change, index })).sort((a, b) => place(a.change) - place(b.change) || a.index - b.index).map(({ change }) => change)
}

export async function setFigureFolder(bookId: string, folder: string): Promise<void> {
  await change(bookId, (address) => (address.folder === folder ? null : { ...address, folder }))
}

export async function addRank(bookId: string, name: string): Promise<AddressRank> {
  const text = name.trim()
  if (!text) throw new Error('A rank needs a name')
  const rank: AddressRank = { id: newId(), name: text, public: '', updatedAt: Date.now() }
  await change(bookId, (address) => ({ ...address, ranks: [...address.ranks, rank] }))
  return rank
}

export async function updateRank(bookId: string, id: string, patch: { name?: string; public?: string; private?: string; note?: string }): Promise<void> {
  await change(bookId, (address) => {
    const current = address.ranks.find((rank) => rank.id === id)
    if (!current) return null
    let next: AddressRank = { ...current }
    if (patch.name?.trim()) next.name = patch.name.trim()
    if (patch.public !== undefined) next.public = patch.public.trim()
    next = setTexts(next, { private: patch.private, note: patch.note })
    const content = (rank: AddressRank) => [rank.name, rank.public, rank.private, rank.note]
    if (same(content(current), content(next))) return null
    next.updatedAt = Math.max(Date.now(), current.updatedAt + 1)
    return { ...address, ranks: address.ranks.map((rank) => (rank.id === id ? next : rank)) }
  })
}

/** Removes a rank. Figures that had it count as having no rank. */
export async function deleteRank(bookId: string, id: string): Promise<void> {
  await change(bookId, (address) =>
    address.ranks.some((rank) => rank.id === id) ? { ...address, ranks: address.ranks.filter((rank) => rank.id !== id), deleted: forget(address, [id]) } : null,
  )
}

export async function moveRank(bookId: string, id: string, step: -1 | 1): Promise<void> {
  await change(bookId, (address) => {
    const index = address.ranks.findIndex((rank) => rank.id === id)
    const target = index + step
    if (index < 0 || target < 0 || target >= address.ranks.length) return null
    const ranks = [...address.ranks]
    ;[ranks[index], ranks[target]] = [ranks[target], ranks[index]]
    return { ...address, ranks }
  })
}

type PersonChangeInput = { id?: string; chapterId: string; rankId?: string; first?: string; last?: string }

export async function setPerson(
  bookId: string,
  entryId: string,
  /** changes: the whole list, or how to change the stored one (so quick edits build on each other). */
  patch: { rankId?: string | null; first?: string; last?: string; changes?: PersonChangeInput[] | ((current: AddressPersonChange[]) => PersonChangeInput[]) },
  chapterOrder: string[],
): Promise<void> {
  await change(bookId, (address) => {
    const current: AddressPerson = address.people.find((person) => person.entryId === entryId) ?? { entryId, changes: [], updatedAt: 0 }
    let next: AddressPerson = { ...current }
    if (patch.rankId === null) delete next.rankId
    else if (patch.rankId) next.rankId = patch.rankId
    next = setTexts(next, { first: patch.first, last: patch.last })
    if (patch.changes) {
      const inputs = typeof patch.changes === 'function' ? patch.changes(current.changes) : patch.changes
      const changes = inputs.flatMap((input): AddressPersonChange[] => {
        if (!input.chapterId) return []
        const before = current.changes.find((item) => item.id === input.id)
        const item = setTexts<AddressPersonChange>({ ...(before?.extra ? { extra: before.extra } : {}), id: input.id || newId(), chapterId: input.chapterId }, { rankId: input.rankId, first: input.first, last: input.last })
        return item.rankId || item.first || item.last ? [item] : []
      })
      next.changes = byChapter(changes, chapterOrder)
    }
    const content = (person: AddressPerson) => [person.rankId, person.first, person.last, person.changes.map(({ id, chapterId, rankId, first, last }) => [id, chapterId, rankId, first, last])]
    if (same(content(current), content(next))) return null
    next.updatedAt = Math.max(Date.now(), current.updatedAt + 1)
    const people = address.people.some((person) => person.entryId === entryId) ? address.people.map((person) => (person.entryId === entryId ? next : person)) : [...address.people, next]
    return { ...address, people }
  })
}

type ChangeInput = { id?: string; chapterId?: string; label?: string; public?: string; private?: string; note?: string }

/**
 * Stores how `from` addresses `to`. One form per direction: the newest is updated and older ones from
 * another device are removed. A form without any content is deleted instead.
 */
export async function saveForm(
  bookId: string,
  input: { from: string; to: string; public?: string; private?: string; note?: string; changes: ChangeInput[] },
  chapterOrder: string[],
): Promise<void> {
  const now = Date.now()
  await change(bookId, (address) => {
    const mine = address.forms.filter((form) => form.from === input.from && form.to === input.to).sort((a, b) => b.updatedAt - a.updatedAt)
    const [existing, ...older] = mine
    const changes = byChapter(
      input.changes.flatMap((item): AddressChange[] => {
        const before = existing?.changes.find((old) => old.id === item.id)
        const next = setTexts<AddressChange>({ ...(before?.extra ? { extra: before.extra } : {}), id: item.id || newId(), ...(item.chapterId ? { chapterId: item.chapterId } : {}) }, {
          label: item.label,
          public: item.public,
          private: item.private,
          note: item.note,
        })
        return next.label || next.public || next.private || next.note ? [next] : []
      }),
      chapterOrder,
    )
    const base: AddressForm = existing ?? { id: newId(), from: input.from, to: input.to, changes: [], createdAt: now, updatedAt: now }
    const next = setTexts<AddressForm>({ ...base, changes }, { public: input.public ?? '', private: input.private ?? '', note: input.note ?? '' })
    if (!next.public && !next.private && !next.note && !next.changes.length) {
      if (!mine.length) return null
      return { ...address, forms: address.forms.filter((form) => !mine.includes(form)), deleted: forget(address, mine.map((form) => form.id)) }
    }
    const content = (form: AddressForm) => [form.public, form.private, form.note, form.changes.map(({ id, chapterId, label, public: p, private: q, note }) => [id, chapterId, label, p, q, note])]
    if (existing && !older.length && same(content(existing), content(next))) return null
    if (existing) next.updatedAt = Math.max(now, existing.updatedAt + 1)
    const forms = [...address.forms.filter((form) => !mine.includes(form)), next]
    return { ...address, forms, ...(older.length ? { deleted: forget(address, older.map((form) => form.id)) } : {}) }
  })
}

export async function deleteForm(bookId: string, from: string, to: string): Promise<void> {
  await change(bookId, (address) => {
    const gone = address.forms.filter((form) => form.from === from && form.to === to)
    if (!gone.length) return null
    return { ...address, forms: address.forms.filter((form) => !gone.includes(form)), deleted: forget(address, gone.map((form) => form.id)) }
  })
}

/** Replaces the book's ranks, figure details and exceptions with an import file's (see importFile.ts). */
export async function importAddress(bookId: string, data: AddressImport, figures: WikiEntry[]): Promise<ImportReport> {
  let report: ImportReport = { ranks: 0, people: 0, forms: 0, missing: [] }
  await change(bookId, (address) => {
    const planned = planAddressImport(address, data, figures, { id: newId, now: Date.now() })
    report = planned.report
    return planned.address
  })
  return report
}
