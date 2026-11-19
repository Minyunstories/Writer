import { extraOf, isObject, json, readJson, str, withExtra } from '../lib/fileFields'
import type { FileData } from '../sync/hash'
import type { BookShelf } from '../types'

const KNOWN = ['pattern', 'starred']

/** shelf.json: pattern and star, then fields from a newer version. Undefined when there is nothing. */
export function shelfFile(shelf: BookShelf): string | undefined {
  const fields: Record<string, unknown> = {}
  if (shelf.pattern) fields.pattern = shelf.pattern
  if (shelf.starred) fields.starred = true
  const all = withExtra(fields, shelf.extra)
  return Object.keys(all).length ? json(all) : undefined
}

/** The shelf of a shelf.json, unknown fields and pattern ids included; null when the file is not an object. */
export function parseShelf(data: FileData | undefined): BookShelf | null {
  const raw = readJson(data)
  if (!isObject(raw)) return null
  const shelf: BookShelf = {}
  if (raw.starred === true) shelf.starred = true
  if (str(raw.pattern)) shelf.pattern = raw.pattern.trim()
  const extra = extraOf(raw, KNOWN)
  if (extra) shelf.extra = extra
  return shelf
}
