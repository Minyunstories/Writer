import type { ReactNode } from 'react'

/** **bold** and *italic*, as used in the catalogue's rules. Everything else stays plain text. */
export function inlineMarkdown(source: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*/g
  let last = 0
  for (const match of source.matchAll(pattern)) {
    if (match.index > last) parts.push(source.slice(last, match.index))
    parts.push(match[1] !== undefined ? <strong key={match.index}>{match[1]}</strong> : <em key={match.index}>{match[2]}</em>)
    last = match.index + match[0].length
  }
  if (last < source.length) parts.push(source.slice(last))
  return parts
}
