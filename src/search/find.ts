export interface FindOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function pattern(query: string, options: FindOptions): RegExp | null {
  if (!query) return null
  const body = escape(query)
  const source = options.wholeWord ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])` : body
  return new RegExp(source, `gu${options.caseSensitive ? '' : 'i'}`)
}

/** Every place the query appears in a text. */
export function findMatches(text: string, query: string, options: FindOptions): { from: number; to: number }[] {
  const regex = pattern(query, options)
  if (!regex) return []
  return [...text.matchAll(regex)].map((match) => ({ from: match.index!, to: match.index! + match[0].length }))
}

/** The text with every match replaced, and how many there were. */
export function replaceMatches(text: string, query: string, replacement: string, options: FindOptions): { text: string; count: number } {
  const regex = pattern(query, options)
  if (!regex) return { text, count: 0 }
  let count = 0
  const next = text.replace(regex, () => {
    count++
    return replacement
  })
  return { text: next, count }
}
