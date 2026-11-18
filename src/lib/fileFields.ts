import type { FileData } from '../sync/hash'

const decoder = new TextDecoder()
export type Raw = Record<string, unknown>

export const isObject = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value)
export const str = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/** The JSON value of a file, or undefined when it is missing or not JSON. */
export function readJson(data: FileData | undefined): unknown {
  if (data === undefined) return undefined
  try {
    return JSON.parse(typeof data === 'string' ? data : decoder.decode(data))
  } catch {
    return undefined
  }
}

/** The fields of an object this version does not know, or undefined when there are none. */
export function extraOf(raw: Raw, known: string[]): Record<string, unknown> | undefined {
  const rest = Object.entries(raw).filter(([key]) => !known.includes(key))
  return rest.length ? Object.fromEntries(rest) : undefined
}

/** Known fields first, then unknown ones that do not clash with them. */
export function withExtra(fields: Raw, extra: Record<string, unknown> | undefined): Raw {
  if (!extra) return fields
  const rest = Object.entries(extra).filter(([key]) => !(key in fields))
  return { ...fields, ...Object.fromEntries(rest) }
}

export const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`
