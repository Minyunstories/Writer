import type { WikiEntry, WikiFolder } from '../types'

/** Key of the top level in Book.wikiOrder. */
export const ROOT_KEY = '_root'

/** Where a folder's children are listed in Book.wikiOrder. */
export function orderKey(parentId: string | null): string {
  return parentId ?? ROOT_KEY
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'de')

/**
 * The folders and entries directly inside a folder (null: the top level), in the writer's
 * order: listed ids first as listed, anything not listed after them, alphabetically.
 * Items whose folder no longer exists count as top level, so nothing is ever hidden.
 */
export function orderedChildren(
  parentId: string | null,
  folders: WikiFolder[],
  entries: WikiEntry[],
  order?: Record<string, string[]>,
): { folders: WikiFolder[]; entries: WikiEntry[] } {
  const folderIds = new Set(folders.map((folder) => folder.id))
  const inside = (parent: string | null) =>
    parentId === null ? !parent || !folderIds.has(parent) : parent === parentId
  const listed = order?.[orderKey(parentId)] ?? []
  const rank = new Map(listed.map((id, index) => [id, index]))
  const sort = <T extends { id: string; name: string }>(items: T[]) =>
    [...items].sort((a, b) => {
      const ra = rank.get(a.id)
      const rb = rank.get(b.id)
      if (ra !== undefined && rb !== undefined) return ra - rb
      if (ra !== undefined) return -1
      if (rb !== undefined) return 1
      return byName(a, b)
    })
  return {
    folders: sort(folders.filter((folder) => inside(folder.parentId))),
    entries: sort(entries.filter((entry) => inside(entry.folderId))),
  }
}
