import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { baseForms } from '../synonyms/thesaurus'
import type { CollectionItem } from '../types'

/** "//" at a word start, then the search word. Not after ":" or "/" (web addresses). */
const TRIGGER = /(?:^|[^:/\p{L}\p{N}])(\/\/([\p{L}\p{N}'’ -]{1,40}))$/u
const MAX_OPTIONS = 30
const LETTER = /[\p{L}\p{N}]/u

/** A suggestion; `used` marks one that already stands in the chapter. */
export type CollectionCompletion = Completion & { used?: boolean }

/** Does one of the field's words begin with the search word? */
export function startsWord(field: string, query: string): boolean {
  const text = field === field.toLowerCase() ? field : field.toLowerCase()
  for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + 1))
    if (at === 0 || !LETTER.test(text[at - 1])) return true
  return false
}

/** The forms a word may come from, three letters or longer ("walking" → walk). */
export function formsOf(word: string): string[] {
  return baseForms(word.replace(/’/g, "'")).filter((form) => form.length >= 3)
}

const groupKey = (item: CollectionItem) => `${item.category}\u0000${item.group}`
const add = (index: Map<string, Set<string>>, word: string, key: string) => {
  const keys = index.get(word) ?? new Set<string>()
  keys.add(key)
  index.set(word, keys)
}

/**
 * Which words lead to which groups: each name of a group before the brackets ("fast / quick (…)" → fast,
 * quick) and each entry of it, as written and – for single words – in their base forms.
 * Built once per collection list.
 */
const indexes = new WeakMap<CollectionItem[], Map<string, Set<string>>>()
function groupIndex(items: CollectionItem[]): Map<string, Set<string>> {
  const cached = indexes.get(items)
  if (cached) return cached
  const index = new Map<string, Set<string>>()
  const words = (text: string, key: string) => {
    const word = text.trim().toLowerCase()
    if (!word) return
    add(index, word, key)
    if (!/\s/.test(word)) for (const form of formsOf(word)) add(index, `~${form}`, key)
  }
  for (const item of items) {
    if (!item.group) continue
    const key = groupKey(item)
    if (!index.has(`#${key}`)) {
      index.set(`#${key}`, new Set())
      for (const name of item.group.split('(')[0].split('/')) words(name, key)
    }
    words(item.text.replace(/\*\*|__|==|[*_]/g, ''), key)
  }
  indexes.set(items, index)
  return index
}

/** The groups that belong to the search word: named after it or holding it as an entry, also in another form. */
export function groupsFor(items: CollectionItem[], query: string): Set<string> {
  const index = groupIndex(items)
  const keys = new Set(index.get(query) ?? [])
  if (!/\s/.test(query)) for (const form of formsOf(query)) for (const key of index.get(`~${form}`) ?? []) keys.add(key)
  return keys
}

/** How often the text stands in the (lower-cased) chapter as a whole word or phrase. */
export function countIn(chapter: string, text: string): number {
  const plain = text.replace(/\*\*|__|==|[*_]/g, '').trim().toLowerCase()
  if (!plain) return 0
  let count = 0
  for (let at = chapter.indexOf(plain); at !== -1; at = chapter.indexOf(plain, at + 1)) {
    const end = at + plain.length
    if ((at === 0 || !LETTER.test(chapter[at - 1])) && (end === chapter.length || !LETTER.test(chapter[end]))) count++
  }
  return count
}

/** The searchable fields of each item, lower-cased once per collection list. */
const searchable = new WeakMap<CollectionItem[], { text: string; other: string[] }[]>()
function fieldsOf(items: CollectionItem[]) {
  const cached = searchable.get(items)
  if (cached) return cached
  const fields = items.map((item) => ({
    text: item.text.toLowerCase(),
    // Explanations in brackets („(things, spaces)“) do not count.
    other: [item.category, (item.group ?? '').split('(')[0], ...(item.tags ?? [])].map((field) => field.toLowerCase()),
  }))
  searchable.set(items, fields)
  return fields
}

/**
 * Typing "//word" offers items from the collection; picking one puts its text in place.
 * Only word starts match. First come the groups for the word (named after it, also inflected,
 * or holding it as an entry), then entries whose text matches, then category and tag matches.
 */
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
    const groups = groupsFor(all, query)
    const groupOrder = [...groups]
    const fields = fieldsOf(all)
    const ranked: CollectionItem[][] = [[], [], []]
    all.forEach((item, i) => {
      if (item.group && groups.has(groupKey(item))) ranked[0].push(item)
      else if (startsWord(fields[i].text, query)) ranked[1].push(item)
      else if (fields[i].other.some((field) => startsWord(field, query))) ranked[2].push(item)
    })
    // Within the first step the groups stay together, in the order they first appear.
    ranked[0].sort((a, b) => groupOrder.indexOf(groupKey(a)) - groupOrder.indexOf(groupKey(b)))
    const chapter = (context.state.doc.sliceString(0, from) + context.state.doc.sliceString(context.pos)).toLowerCase()
    const options: CollectionCompletion[] = ranked
      .flat()
      .slice(0, MAX_OPTIONS)
      .map((item) => {
        const where = item.group ? `${item.category} · ${item.group}` : item.category
        const times = countIn(chapter, item.text)
        return {
          // Shown without markup; the text itself goes in as written.
          label: item.text.replace(/\*\*|__|==|[*_]/g, ''),
          detail: times ? `${times}× im Kapitel · ${where}` : where,
          type: 'text',
          apply: item.text,
          ...(times ? { used: true } : {}),
        }
      })
    if (options.length === 0) return null
    // The search word stays the filter, so the list keeps its order and is not re-ranked by label.
    return { from, options, filter: false }
  }
}
