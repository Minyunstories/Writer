import type { FileData } from '../sync/hash'
import type { BookModules } from '../types'

const decoder = new TextDecoder()

/** modules.json: the switched-on modules, sorted. Undefined when none is on. */
export function modulesFile(modules: BookModules): string | undefined {
  const on = Object.keys(modules)
    .filter((id) => modules[id] === true)
    .sort()
  if (!on.length) return undefined
  return `${JSON.stringify(Object.fromEntries(on.map((id) => [id, true])), null, 2)}\n`
}

/** The switched-on modules of a modules.json, unknown ones included; null when the file is not an object. */
export function parseModules(data: FileData | undefined): BookModules | null {
  if (data === undefined) return null
  let value: unknown
  try {
    value = JSON.parse(typeof data === 'string' ? data : decoder.decode(data))
  } catch {
    return null
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result: BookModules = {}
  for (const [id, on] of Object.entries(value)) if (on === true) result[id] = true
  return result
}
