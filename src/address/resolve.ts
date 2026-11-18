import type { AddressChange, AddressForm, AddressRank, BookAddress, WikiEntry, WikiFolder } from '../types'

/** Folder names that hold the figures when the writer has not chosen a folder. */
const FIGURE_FOLDERS = ['characters', 'charaktere', 'figuren', 'personen']

/** The folder whose entries count as figures; null for all entries. */
export function figureFolderId(address: BookAddress | undefined, folders: WikiFolder[]): string | null {
  const chosen = address?.folder
  if (chosen === '*') return null
  if (chosen && folders.some((folder) => folder.id === chosen)) return chosen
  return folders.find((folder) => !folder.parentId && FIGURE_FOLDERS.includes(folder.name.trim().toLowerCase()))?.id ?? null
}

/** The figures: entries in the figure folder or below it, by name. */
export function figuresOf(address: BookAddress | undefined, entries: WikiEntry[], folders: WikiFolder[]): WikiEntry[] {
  const root = figureFolderId(address, folders)
  const parent = new Map(folders.map((folder) => [folder.id, folder.parentId]))
  const inside = (folderId: string | null) => {
    const seen = new Set<string>()
    for (let current = folderId; current && !seen.has(current); current = parent.get(current) ?? null) {
      if (current === root) return true
      seen.add(current)
    }
    return false
  }
  return entries.filter((entry) => root === null || inside(entry.folderId)).sort((a, b) => a.name.localeCompare(b.name))
}

/** Index of a chapter in the book's order; -1 for none or a deleted chapter. */
const at = (chapterOrder: string[], chapterId: string | null | undefined) => (chapterId ? chapterOrder.indexOf(chapterId) : -1)

/** A figure's rank and names as they are in a chapter (null: before any change). */
export function personAt(
  address: BookAddress | undefined,
  entry: WikiEntry,
  chapterOrder: string[],
  chapterId: string | null,
): { rank?: AddressRank; first: string; last: string } {
  const person = address?.people.find((item) => item.entryId === entry.id)
  let rankId = person?.rankId
  let first = person?.first
  let last = person?.last
  const current = at(chapterOrder, chapterId)
  const changes = (person?.changes ?? [])
    .filter((change) => at(chapterOrder, change.chapterId) >= 0 && at(chapterOrder, change.chapterId) <= current)
    .sort((a, b) => at(chapterOrder, a.chapterId) - at(chapterOrder, b.chapterId))
  for (const change of changes) {
    if (change.rankId) rankId = change.rankId
    if (change.first) first = change.first
    if (change.last) last = change.last
  }
  const words = entry.name.trim().split(/\s+/).filter(Boolean)
  const rank = rankId ? address?.ranks.find((item) => item.id === rankId) : undefined
  return { ...(rank ? { rank } : {}), first: first || words[0] || '', last: last || words[words.length - 1] || '' }
}

/** Puts the names in; a missing name leaves its placeholder visible. */
export function fill(text: string, person: { first: string; last: string }): string {
  return text.replace(/\{Vorname\}/g, (match) => person.first || match).replace(/\{Nachname\}/g, (match) => person.last || match)
}

/** The form for one direction: the newest when two devices made one each. */
export function formOf(address: BookAddress | undefined, from: string, to: string): AddressForm | undefined {
  return (address?.forms ?? []).filter((form) => form.from === from && form.to === to).sort((a, b) => b.updatedAt - a.updatedAt)[0]
}

/** Has a rank (now or from a chapter on) or takes part in a form. */
export function involved(address: BookAddress | undefined, entryId: string): boolean {
  const person = address?.people.find((item) => item.entryId === entryId)
  if (person?.rankId || person?.changes.some((change) => change.rankId)) return true
  return (address?.forms ?? []).some((form) => form.from === entryId || form.to === entryId)
}

export type AddressNote = { source: string; text: string }

export interface Resolved {
  public: string
  private: string
  source: 'rule' | 'form' | 'none'
  rankName?: string
  notes: AddressNote[]
  /** Changes without a chapter ("noch offen") or whose chapter was deleted. */
  pending: AddressChange[]
}

/** How `from` addresses `to` in a chapter (null: before any change). */
export function resolveAddress(address: BookAddress | undefined, from: WikiEntry, to: WikiEntry, chapterOrder: string[], chapterId: string | null): Resolved {
  const person = personAt(address, to, chapterOrder, chapterId)
  const form = formOf(address, from.id, to.id)
  const notes: AddressNote[] = []
  let publicText = person.rank?.public ?? ''
  let privateText = person.rank?.private ?? ''
  if (person.rank?.note) notes.push({ source: `Regel: ${person.rank.name}`, text: person.rank.note })
  if (form) {
    if (form.public) publicText = form.public
    if (form.private) privateText = form.private
    if (form.note) notes.push({ source: 'Abweichung', text: form.note })
  }
  const current = at(chapterOrder, chapterId)
  const changes = form?.changes ?? []
  const dated = changes
    .filter((change) => at(chapterOrder, change.chapterId) >= 0)
    .sort((a, b) => at(chapterOrder, a.chapterId) - at(chapterOrder, b.chapterId))
  for (const change of dated) {
    if (at(chapterOrder, change.chapterId) > current) continue
    if (change.public) publicText = change.public
    if (change.private) privateText = change.private
    if (change.note) notes.push({ source: change.label || 'Wechsel', text: change.note })
  }
  if (!person.rank && !form) return { public: '', private: '', source: 'none', notes, pending: [] }
  const resolvedPublic = fill(publicText, person)
  return {
    public: resolvedPublic,
    private: privateText ? fill(privateText, person) : resolvedPublic,
    source: form ? 'form' : 'rule',
    ...(person.rank ? { rankName: person.rank.name } : {}),
    notes,
    pending: changes.filter((change) => at(chapterOrder, change.chapterId) < 0),
  }
}

/** The address at the start and at every chapter where something changes, in chapter order. */
export function addressHistory(
  address: BookAddress | undefined,
  from: WikiEntry,
  to: WikiEntry,
  chapterOrder: string[],
): { chapterId: string | null; public: string; private: string; label?: string }[] {
  const form = formOf(address, from.id, to.id)
  const person = address?.people.find((item) => item.entryId === to.id)
  const points = new Set<string>()
  for (const change of [...(form?.changes ?? []), ...(person?.changes ?? [])]) if (change.chapterId && chapterOrder.includes(change.chapterId)) points.add(change.chapterId)
  const history: { chapterId: string | null; public: string; private: string; label?: string }[] = []
  for (const chapterId of [null, ...chapterOrder.filter((id) => points.has(id))]) {
    const resolved = resolveAddress(address, from, to, chapterOrder, chapterId)
    const previous = history[history.length - 1]
    if (previous && previous.public === resolved.public && previous.private === resolved.private) continue
    const label = (form?.changes ?? []).filter((change) => change.chapterId === chapterId && change.label).map((change) => change.label).join(', ')
    history.push({ chapterId, ...(label ? { label } : {}), public: resolved.public, private: resolved.private })
  }
  return history
}
