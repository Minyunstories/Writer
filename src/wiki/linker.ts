import type { WikiEntry } from '../types'

export interface LinkMatch {
  from: number
  to: number
  entryId: string
}

export interface Matcher {
  /** Finds linked names in text. Positions are shifted by offset. */
  find(text: string, offset?: number): LinkMatch[]
  /** Number of distinct names this matcher knows. */
  readonly size: number
}

type Linkable = Pick<WikiEntry, 'id' | 'name' | 'aliases' | 'autoLink' | 'createdAt'>

const WORD = '[\\p{L}\\p{N}_]'

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const NOTHING: Matcher = { find: () => [], size: 0 }

/**
 * Builds a matcher for entry names and aliases.
 * Whole words only, exact case, longest name first; with a shared name the older entry wins.
 */
export function buildMatcher(entries: Linkable[]): Matcher {
  const owner = new Map<string, string>()
  const ordered = [...entries].sort((a, b) => a.createdAt - b.createdAt)
  for (const entry of ordered) {
    if (!entry.autoLink) continue
    for (const raw of [entry.name, ...entry.aliases]) {
      const name = raw.trim()
      if (name && !owner.has(name)) owner.set(name, entry.id)
    }
  }
  if (owner.size === 0) return NOTHING

  const names = [...owner.keys()].sort((a, b) => b.length - a.length)
  const pattern = new RegExp(`(?<!${WORD})(?:${names.map(escapeRegExp).join('|')})(?!${WORD})`, 'gu')

  return {
    size: owner.size,
    find(text, offset = 0) {
      const found: LinkMatch[] = []
      pattern.lastIndex = 0
      for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        found.push({
          from: offset + match.index,
          to: offset + match.index + match[0].length,
          entryId: owner.get(match[0])!,
        })
      }
      return found
    },
  }
}
