import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import type { CollectionItem } from '../types'

/** "//" at a word start, then the search word. Not after ":" or "/" (web addresses). */
const TRIGGER = /(?:^|[^:/\p{L}\p{N}])(\/\/([\p{L}\p{N}'’ -]{1,40}))$/u
const MAX_OPTIONS = 30

/** Typing "//word" offers items from the collection; picking one puts its text in place. */
export function collectionCompletionSource(items: () => CollectionItem[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos)
    const before = line.text.slice(0, context.pos - line.from)
    const match = TRIGGER.exec(before)
    if (!match) return null
    const query = match[2].trim().toLowerCase()
    if (!query) return null
    const from = context.pos - match[1].length
    const all = items()
    const matches = all.filter((item) =>
      [item.text, item.category, item.group ?? '', ...(item.tags ?? [])].some((field) => field.toLowerCase().includes(query)),
    )
    const options: Completion[] = [...matches, ...siblingsOf(all, matches, query)]
      .slice(0, MAX_OPTIONS)
      .map((item) => ({
        // Shown without markup; the text itself goes in as written.
        label: item.text.replace(/\*\*|__|==|[*_]/g, ''),
        detail: item.group ? `${item.category} · ${item.group}` : item.category,
        type: 'text',
        apply: item.text,
      }))
    if (options.length === 0) return null
    // The search word stays the filter, so the list keeps its order and is not re-ranked by label.
    return { from, options, filter: false }
  }
}

/**
 * When the search word is itself an entry ("//swift"), the other entries of its group are
 * alternatives too ("rapid", "breakneck" …). They come after the direct matches, in collection order.
 */
function siblingsOf(all: CollectionItem[], matches: CollectionItem[], query: string): CollectionItem[] {
  const key = (item: CollectionItem) => `${item.category}\u0000${item.group}`
  const groups = new Set(matches.filter((item) => item.group && item.text.trim().toLowerCase() === query).map(key))
  if (groups.size === 0) return []
  const shown = new Set(matches)
  return all.filter((item) => item.group && groups.has(key(item)) && !shown.has(item))
}
