import type { Chapter, WikiEntry, WikiFolder } from '../types'
import type { Matcher } from './linker'

export interface Mention {
  chapterId: string
  count: number
  /** Where the first mention is in the chapter text. */
  first: { from: number; to: number }
}

/** The chapters that mention an entry, in chapter order. Same rule as the links in the text. */
export function mentionsOf(entryId: string, chapters: Chapter[], matcher: Matcher): Mention[] {
  const found: Mention[] = []
  for (const chapter of chapters) {
    const own = matcher.find(chapter.content).filter((match) => match.entryId === entryId)
    if (own.length > 0) found.push({ chapterId: chapter.id, count: own.length, first: { from: own[0].from, to: own[0].to } })
  }
  return found
}

/** The entries a chapter mentions, each once, in order of first appearance. */
export function entriesIn(chapter: Chapter, matcher: Matcher): string[] {
  return [...new Set(matcher.find(chapter.content).map((match) => match.entryId))]
}

/** The top-level folder a folder belongs to (itself if it is one). */
export function topFolderOf(folderId: string | null, folders: WikiFolder[]): WikiFolder | null {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  let current = folderId ? byId.get(folderId) : undefined
  const seen = new Set<string>()
  while (current?.parentId && byId.has(current.parentId) && !seen.has(current.id)) {
    seen.add(current.id)
    current = byId.get(current.parentId)
  }
  return current ?? null
}

/** The template fields an entry shows: those of its top-level folder. */
export function effectiveTemplate(entry: Pick<WikiEntry, 'folderId'>, folders: WikiFolder[]): string[] {
  return topFolderOf(entry.folderId, folders)?.template ?? []
}

/** Entries grouped by their top-level folder: folders by name, entries without a folder last. */
export function groupByTopFolder(
  entryIds: string[],
  entries: WikiEntry[],
  folders: WikiFolder[],
): { folder: WikiFolder | null; entries: WikiEntry[] }[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const groups = new Map<string | null, { folder: WikiFolder | null; entries: WikiEntry[] }>()
  for (const id of entryIds) {
    const entry = byId.get(id)
    if (!entry) continue
    const top = topFolderOf(entry.folderId, folders)
    const key = top?.id ?? null
    if (!groups.has(key)) groups.set(key, { folder: top, entries: [] })
    groups.get(key)!.entries.push(entry)
  }
  return [...groups.values()].sort((a, b) => {
    if (!a.folder) return 1
    if (!b.folder) return -1
    return a.folder.name.localeCompare(b.folder.name, 'de')
  })
}
