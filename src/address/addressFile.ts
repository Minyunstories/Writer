import { extraOf, isObject, json, readJson, str, withExtra, type Raw } from '../lib/fileFields'
import type { FileData } from '../sync/hash'
import type { AddressChange, AddressForm, AddressPerson, AddressPersonChange, AddressRank, BookAddress } from '../types'

const TOP_KEYS = ['folder', 'ranks', 'people', 'forms', 'deleted']
const RANK_KEYS = ['id', 'name', 'public', 'private', 'note', 'updatedAt']
const PERSON_KEYS = ['entry', 'rank', 'first', 'last', 'changes', 'updatedAt']
const PERSON_CHANGE_KEYS = ['id', 'chapter', 'rank', 'first', 'last']
const FORM_KEYS = ['id', 'from', 'to', 'public', 'private', 'note', 'changes', 'createdAt', 'updatedAt']
const CHANGE_KEYS = ['id', 'chapter', 'label', 'public', 'private', 'note']

/** Only the fields that hold text. */
const filled = (fields: Record<string, string | undefined>): Raw => Object.fromEntries(Object.entries(fields).filter(([, value]) => value))

const byForm = (a: AddressForm, b: AddressForm) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)

/** address.json: ranks in the writer's order, people by entry, forms by creation. Undefined when there is nothing. */
export function addressFile(address: BookAddress): string | undefined {
  const { folder, ranks, people, forms, deleted } = address
  if (!folder && !ranks.length && !people.length && !forms.length && !deleted?.length) return undefined
  return json(
    withExtra(
      {
        ...(folder ? { folder } : {}),
        ranks: ranks.map((rank) =>
          withExtra({ id: rank.id, name: rank.name, public: rank.public, ...filled({ private: rank.private, note: rank.note }), updatedAt: rank.updatedAt }, rank.extra),
        ),
        people: [...people]
          .sort((a, b) => a.entryId.localeCompare(b.entryId))
          .map((person) =>
            withExtra(
              {
                entry: person.entryId,
                ...filled({ rank: person.rankId, first: person.first, last: person.last }),
                changes: person.changes.map((change) =>
                  withExtra({ id: change.id, chapter: change.chapterId, ...filled({ rank: change.rankId, first: change.first, last: change.last }) }, change.extra),
                ),
                updatedAt: person.updatedAt,
              },
              person.extra,
            ),
          ),
        forms: [...forms].sort(byForm).map((form) =>
          withExtra(
            {
              id: form.id,
              from: form.from,
              to: form.to,
              ...filled({ public: form.public, private: form.private, note: form.note }),
              changes: form.changes.map((change) =>
                withExtra(
                  { id: change.id, ...filled({ chapter: change.chapterId, label: change.label, public: change.public, private: change.private, note: change.note }) },
                  change.extra,
                ),
              ),
              createdAt: form.createdAt,
              updatedAt: form.updatedAt,
            },
            form.extra,
          ),
        ),
        ...(deleted?.length ? { deleted: [...deleted].sort() } : {}),
      },
      address.extra,
    ),
  )
}

/** Copies the text fields that are set, under new names. */
function texts<T>(raw: Raw, names: Record<string, keyof T>): Partial<T> {
  const result: Partial<T> = {}
  for (const [from, to] of Object.entries(names)) if (str(raw[from])) (result as Raw)[to as string] = raw[from]
  return result
}

function parseRank(raw: unknown): AddressRank[] {
  if (!isObject(raw) || !str(raw.id) || !str(raw.name)) return []
  const rank: AddressRank = { id: raw.id, name: raw.name, public: typeof raw.public === 'string' ? raw.public : '', ...texts<AddressRank>(raw, { private: 'private', note: 'note' }), updatedAt: Number(raw.updatedAt) || 0 }
  const extra = extraOf(raw, RANK_KEYS)
  return [extra ? { ...rank, extra } : rank]
}

function parsePersonChange(raw: unknown): AddressPersonChange[] {
  if (!isObject(raw) || !str(raw.id) || !str(raw.chapter)) return []
  const change: AddressPersonChange = { id: raw.id, chapterId: raw.chapter, ...texts<AddressPersonChange>(raw, { rank: 'rankId', first: 'first', last: 'last' }) }
  const extra = extraOf(raw, PERSON_CHANGE_KEYS)
  return [extra ? { ...change, extra } : change]
}

function parsePerson(raw: unknown): AddressPerson[] {
  if (!isObject(raw) || !str(raw.entry)) return []
  const person: AddressPerson = {
    entryId: raw.entry,
    ...texts<AddressPerson>(raw, { rank: 'rankId', first: 'first', last: 'last' }),
    changes: Array.isArray(raw.changes) ? raw.changes.flatMap(parsePersonChange) : [],
    updatedAt: Number(raw.updatedAt) || 0,
  }
  const extra = extraOf(raw, PERSON_KEYS)
  return [extra ? { ...person, extra } : person]
}

function parseChange(raw: unknown): AddressChange[] {
  if (!isObject(raw) || !str(raw.id)) return []
  const change: AddressChange = { id: raw.id, ...texts<AddressChange>(raw, { chapter: 'chapterId', label: 'label', public: 'public', private: 'private', note: 'note' }) }
  const extra = extraOf(raw, CHANGE_KEYS)
  return [extra ? { ...change, extra } : change]
}

function parseForm(raw: unknown): AddressForm[] {
  if (!isObject(raw) || !str(raw.id) || !str(raw.from) || !str(raw.to)) return []
  const form: AddressForm = {
    id: raw.id,
    from: raw.from,
    to: raw.to,
    ...texts<AddressForm>(raw, { public: 'public', private: 'private', note: 'note' }),
    changes: Array.isArray(raw.changes) ? raw.changes.flatMap(parseChange) : [],
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
  }
  const extra = extraOf(raw, FORM_KEYS)
  return [extra ? { ...form, extra } : form]
}

/** The usable content of an address.json; null when it is not an object. Tolerant of half-broken files. */
export function parseAddress(data: FileData | undefined): BookAddress | null {
  const value = readJson(data)
  if (!isObject(value)) return null
  const address: BookAddress = {
    ...(str(value.folder) ? { folder: value.folder } : {}),
    ranks: Array.isArray(value.ranks) ? value.ranks.flatMap(parseRank) : [],
    people: Array.isArray(value.people) ? value.people.flatMap(parsePerson) : [],
    forms: Array.isArray(value.forms) ? value.forms.flatMap(parseForm) : [],
  }
  const deleted = Array.isArray(value.deleted) ? value.deleted.filter(str) : []
  if (deleted.length) address.deleted = deleted
  const extra = extraOf(value, TOP_KEYS)
  if (extra) address.extra = extra
  return address
}

/** The newer of two versions by updatedAt; a tie keeps mine. */
function newest<T extends { updatedAt: number }>(theirs: T[], mine: T[], key: (item: T) => string, gone: Set<string>): Map<string, T> {
  const result = new Map<string, T>()
  for (const item of [...theirs, ...mine]) {
    const id = key(item)
    if (gone.has(id)) continue
    const other = result.get(id)
    if (!other || other.updatedAt <= item.updatedAt) result.set(id, item)
  }
  return result
}

/** Both sides changed: everything from both; per rank, person and form the newer wins (a tie keeps mine); deletions stay. */
export function mergeAddress(mine: BookAddress, theirs: BookAddress): BookAddress {
  const deleted = [...new Set([...(mine.deleted ?? []), ...(theirs.deleted ?? [])])].sort()
  const gone = new Set(deleted)
  const ranks = newest(theirs.ranks, mine.ranks, (rank) => rank.id, gone)
  const order = [...mine.ranks.map((rank) => rank.id), ...theirs.ranks.map((rank) => rank.id)]
  const merged: BookAddress = {
    ranks: [...new Set(order)].flatMap((id) => ranks.get(id) ?? []),
    people: [...newest(theirs.people, mine.people, (person) => person.entryId, new Set()).values()].sort((a, b) => a.entryId.localeCompare(b.entryId)),
    forms: [...newest(theirs.forms, mine.forms, (form) => form.id, gone).values()].sort(byForm),
  }
  const folder = mine.folder ?? theirs.folder
  if (folder) merged.folder = folder
  if (deleted.length) merged.deleted = deleted
  const extra = { ...theirs.extra, ...mine.extra }
  if (Object.keys(extra).length) merged.extra = extra
  return merged
}
