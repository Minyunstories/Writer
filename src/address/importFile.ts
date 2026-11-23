import { isObject, str, type Raw } from '../lib/fileFields'
import type { AddressChange, AddressForm, AddressPerson, AddressRank, BookAddress, WikiEntry } from '../types'

/**
 * A one-time import of forms of address (the author's own tables, transcribed into a file). Reading the file
 * replaces the book's ranks, the figures' rank and names, and all exceptions; the figure folder stays.
 */
export interface ImportRank {
  name: string
  public: string
  private?: string
  note?: string
}
export interface ImportPerson {
  name: string
  rank?: string
  first?: string
  last?: string
}
export interface ImportChange {
  label?: string
  public?: string
  private?: string
  note?: string
}
export interface ImportForm {
  from: string
  to: string
  public?: string
  private?: string
  note?: string
  changes: ImportChange[]
}
export interface AddressImport {
  ranks: ImportRank[]
  people: ImportPerson[]
  forms: ImportForm[]
}
export interface ImportReport {
  ranks: number
  people: number
  forms: number
  /** Names from the file that matched no figure (or more than one), sorted. */
  missing: string[]
}

/** The optional texts of a record that are present and not empty, trimmed. */
function texts<K extends string>(raw: Raw, keys: readonly K[]): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {}
  for (const key of keys) if (str(raw[key])) out[key] = (raw[key] as string).trim()
  return out
}

/** Reads an import file; anything that is not a version 1 address import gives null. */
export function parseAddressImport(text: string): AddressImport | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(raw) || raw.writer !== 'address-import' || raw.version !== 1) return null
  const { ranks, people, forms } = raw
  if (!Array.isArray(ranks) || !Array.isArray(people) || !Array.isArray(forms)) return null
  if (!ranks.every((rank) => isObject(rank) && str(rank.name) && str(rank.public))) return null
  if (!people.every((person) => isObject(person) && str(person.name))) return null
  if (!forms.every((form) => isObject(form) && str(form.from) && str(form.to) && (form.changes === undefined || Array.isArray(form.changes)))) return null
  return {
    ranks: (ranks as Raw[]).map((rank) => ({ ...texts(rank, ['private', 'note'] as const), name: (rank.name as string).trim(), public: (rank.public as string).trim() })),
    people: (people as Raw[]).map((person) => ({ ...texts(person, ['rank', 'first', 'last'] as const), name: (person.name as string).trim() })),
    forms: (forms as Raw[]).map((form) => ({
      ...texts(form, ['public', 'private', 'note'] as const),
      from: (form.from as string).trim(),
      to: (form.to as string).trim(),
      changes: ((form.changes as unknown[] | undefined) ?? []).filter(isObject).map((change) => texts(change, ['label', 'public', 'private', 'note'] as const)),
    })),
  }
}

const normal = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()
const firstWord = (text: string) => normal(text).split(' ')[0]

/**
 * The one figure a name from the file means: by name, then alias, then – for a one-word name only – the
 * first word of the figure's name ("Mira" → "Mira Hale"). Longer names never fall back to their first
 * word, or "Sir Ben" would find "Sir Pascal Berg". Ambiguous: none.
 */
export function matchFigure(name: string, figures: WikiEntry[]): WikiEntry | undefined {
  const wanted = normal(name)
  const tries = [
    (figure: WikiEntry) => normal(figure.name) === wanted,
    (figure: WikiEntry) => figure.aliases.some((alias) => normal(alias) === wanted),
    ...(wanted.includes(' ') ? [] : [(figure: WikiEntry) => firstWord(figure.name) === wanted]),
  ]
  for (const test of tries) {
    const found = figures.filter(test)
    if (found.length === 1) return found[0]
    if (found.length > 1) return undefined
  }
  return undefined
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** The book's address data after the import, and what was taken over. */
export function planAddressImport(
  address: BookAddress | undefined,
  data: AddressImport,
  figures: WikiEntry[],
  make: { id: () => string; now: number },
): { address: BookAddress; report: ImportReport } {
  const base: BookAddress = address ?? { ranks: [], people: [], forms: [] }
  const deleted = new Set(base.deleted ?? [])
  const missing = new Set<string>()
  const later = (updatedAt: number) => Math.max(make.now, updatedAt + 1)

  // Ranks: the file's, in its order. A rank of the same name keeps its id; all others go.
  const reused = new Set<string>()
  const ranks: AddressRank[] = []
  const rankId = new Map<string, string>()
  for (const item of data.ranks) {
    const key = normal(item.name)
    if (rankId.has(key)) continue
    const old = base.ranks.find((rank) => !reused.has(rank.id) && normal(rank.name) === key)
    const fields = { name: item.name, public: item.public, ...(item.private ? { private: item.private } : {}), ...(item.note ? { note: item.note } : {}) }
    let rank: AddressRank
    if (old) {
      reused.add(old.id)
      const content = (value: { name: string; public: string; private?: string; note?: string }) => [value.name, value.public, value.private, value.note]
      rank = same(content(old), content(fields)) ? old : { ...(old.extra ? { extra: old.extra } : {}), id: old.id, ...fields, updatedAt: later(old.updatedAt) }
    } else rank = { id: make.id(), ...fields, updatedAt: make.now }
    ranks.push(rank)
    rankId.set(key, rank.id)
  }
  for (const rank of base.ranks) if (!reused.has(rank.id)) deleted.add(rank.id)

  // Figures: the file sets rank and names; everyone else is cleared.
  const wanted = new Map<string, Omit<AddressPerson, 'updatedAt'>>()
  const matched = new Set<string>()
  for (const item of data.people) {
    const figure = matchFigure(item.name, figures)
    if (!figure) {
      missing.add(item.name)
      continue
    }
    if (matched.has(figure.id)) continue
    matched.add(figure.id)
    const id = item.rank ? rankId.get(normal(item.rank)) : undefined
    wanted.set(figure.id, { entryId: figure.id, ...(id ? { rankId: id } : {}), ...(item.first ? { first: item.first } : {}), ...(item.last ? { last: item.last } : {}), changes: [] })
  }
  const content = (person: Omit<AddressPerson, 'updatedAt'>) => [person.rankId, person.first, person.last, person.changes]
  const people: AddressPerson[] = base.people.map((person) => {
    const target = wanted.get(person.entryId) ?? { entryId: person.entryId, changes: [] }
    wanted.delete(person.entryId)
    if (same(content(person), content(target))) return person
    return { ...(person.extra ? { extra: person.extra } : {}), ...target, updatedAt: later(person.updatedAt) }
  })
  for (const target of wanted.values()) people.push({ ...target, updatedAt: make.now })

  // Exceptions: all replaced. Changes from the tables have no chapter yet ("noch offen").
  for (const form of base.forms) deleted.add(form.id)
  const forms: AddressForm[] = []
  for (const item of data.forms) {
    const from = matchFigure(item.from, figures)
    const to = matchFigure(item.to, figures)
    if (!from) missing.add(item.from)
    if (!to) missing.add(item.to)
    if (!from || !to || from.id === to.id) continue
    if (forms.some((form) => form.from === from.id && form.to === to.id)) continue
    const changes: AddressChange[] = item.changes
      .filter((change) => change.label || change.public || change.private || change.note)
      .map((change) => ({ id: make.id(), ...change }))
    forms.push({
      id: make.id(),
      from: from.id,
      to: to.id,
      ...(item.public ? { public: item.public } : {}),
      ...(item.private ? { private: item.private } : {}),
      ...(item.note ? { note: item.note } : {}),
      changes,
      createdAt: make.now,
      updatedAt: make.now,
    })
  }

  const next: BookAddress = { ...base, ranks, people, forms }
  if (deleted.size) next.deleted = [...deleted]
  else delete next.deleted
  return { address: next, report: { ranks: ranks.length, people: matched.size, forms: forms.length, missing: [...missing].sort((a, b) => a.localeCompare(b)) } }
}
