import type { Chapter, WikiEntry, WikiFolder } from '../types'
import { normalize } from '../vocabulary/knowledge'

export interface JumpHit {
  kind: 'chapter' | 'entry'
  id: string
  title: string
  /** „Kapitel 3“, „Wiki · Figuren“ or „Wiki“. */
  label: string
  /** The "also known as" that matched, when the name itself did not. */
  alias?: string
}

const LIMIT = 50

/**
 * How well a text fits the query: 0 the same, 1 starts with it, 2 a word starts with its first
 * word, 3 somewhere inside. Null unless every word of the query is in it.
 */
function score(text: string, query: string, words: string[]): number | null {
  const candidate = normalize(text)
  if (!words.every((word) => candidate.includes(word))) return null
  if (candidate === query) return 0
  if (candidate.startsWith(query)) return 1
  if (candidate.split(/[^\p{L}\p{N}]+/u).some((part) => part.startsWith(words[0]))) return 2
  return 3
}

/** Chapters (in book order) and wiki entries whose title, name or alias fits the query. */
export function searchJump(
  query: string,
  chapters: Pick<Chapter, 'id' | 'title'>[],
  entries: Pick<WikiEntry, 'id' | 'name' | 'aliases' | 'folderId'>[],
  folders: Pick<WikiFolder, 'id' | 'name'>[],
): JumpHit[] {
  const folderName = new Map(folders.map((folder) => [folder.id, folder.name]))
  const chapterHits: JumpHit[] = chapters.map((chapter, index) => ({ kind: 'chapter', id: chapter.id, title: chapter.title, label: `Kapitel ${index + 1}` }))
  const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name, 'de'))
  const entryHit = (entry: (typeof entries)[number]): JumpHit => {
    const folder = entry.folderId ? folderName.get(entry.folderId) : undefined
    return { kind: 'entry', id: entry.id, title: entry.name, label: folder ? `Wiki · ${folder}` : 'Wiki' }
  }

  const wanted = normalize(query)
  if (!wanted) return [...chapterHits, ...sortedEntries.map(entryHit)].slice(0, LIMIT)
  const words = wanted.split(' ')

  const scored: { hit: JumpHit; score: number; order: number }[] = []
  chapters.forEach((chapter, index) => {
    const value = score(chapter.title, wanted, words)
    if (value !== null) scored.push({ hit: chapterHits[index], score: value, order: index })
  })
  sortedEntries.forEach((entry, index) => {
    const order = chapters.length + index
    const byName = score(entry.name, wanted, words)
    if (byName !== null) {
      scored.push({ hit: entryHit(entry), score: byName, order })
      return
    }
    let best: { alias: string; score: number } | null = null
    for (const alias of entry.aliases) {
      const value = score(alias, wanted, words)
      if (value !== null && (best === null || value < best.score)) best = { alias, score: value }
    }
    if (best) scored.push({ hit: { ...entryHit(entry), alias: best.alias }, score: best.score, order })
  })
  return scored
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, LIMIT)
    .map(({ hit }) => hit)
}

/** Strg+O (Cmd+O): the quick jump. */
export function isJumpKey(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): boolean {
  return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'o'
}
