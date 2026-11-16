import type { Book, BookPlace } from '../types'

/** Cover colours offered on the shelf. */
export const COVERS = [
  { name: 'Weinrot', color: '#6e2a26' },
  { name: 'Tannengrün', color: '#2d4636' },
  { name: 'Nachtblau', color: '#283650' },
  { name: 'Ocker', color: '#7d5f26' },
  { name: 'Pflaume', color: '#4b2c45' },
  { name: 'Rost', color: '#8a4325' },
  { name: 'Petrol', color: '#1f4a4f' },
  { name: 'Schiefer', color: '#3c4048' },
  { name: 'Moos', color: '#4d5a2b' },
  { name: 'Sand', color: '#8c7b5a' },
] as const

/** Highlight colours; the first is the default. */
export const HIGHLIGHTS = [
  { name: 'Kupfer', color: 'rgba(213, 141, 98, 0.30)' },
  { name: 'Gold', color: 'rgba(217, 178, 106, 0.45)' },
  { name: 'Rosé', color: 'rgba(214, 128, 128, 0.40)' },
  { name: 'Salbei', color: 'rgba(143, 184, 150, 0.40)' },
  { name: 'Himmel', color: 'rgba(128, 166, 214, 0.40)' },
  { name: 'Lavendel', color: 'rgba(170, 140, 210, 0.40)' },
] as const

export const MAX_DATE_LENGTH = 40

const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i

/** True for a colour this app writes: #rgb, #rrggbb or rgb()/rgba(). Anything else is ignored. */
export function isColor(value: unknown): value is string {
  return typeof value === 'string' && COLOR.test(value.trim())
}

/** The cover colour; books without one get a fixed colour derived from their id. */
export function coverOf(book: Pick<Book, 'id' | 'cover'>): string {
  if (book.cover && isColor(book.cover)) return book.cover
  let hash = 0
  for (const char of book.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return COVERS[hash % COVERS.length].color
}

export function highlightOf(book: Pick<Book, 'highlight'>): string {
  return book.highlight && isColor(book.highlight) ? book.highlight : HIGHLIGHTS[0].color
}

/** A date as stored: trimmed, one line, at most 40 characters; undefined when empty. */
export function cleanDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/\s+/g, ' ').trim().slice(0, MAX_DATE_LENGTH).trim()
  return cleaned || undefined
}

/** A place read from a file or another device; undefined unless every field is usable. */
export function cleanPlace(value: unknown): BookPlace | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { chapterId, offset, at } = value as Record<string, unknown>
  if (typeof chapterId !== 'string' || !chapterId) return undefined
  if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) return undefined
  if (typeof at !== 'number' || !Number.isFinite(at)) return undefined
  return { chapterId, offset: Math.floor(offset), at }
}
