import { extraOf, isObject, json, readJson, str, withExtra } from '../lib/fileFields'
import type { FileData } from '../sync/hash'
import type { CustomStamp, StampLibrary } from '../types'
import { sanitizeSvg } from './sanitizeSvg'

const TOP_KEYS = ['stamps', 'deleted']
const STAMP_KEYS = ['id', 'name', 'svg', 'updatedAt']

const byName = (a: CustomStamp, b: CustomStamp) => a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id)

/** stamps/stamps.json: own stamps for all books, by name. Null when there is nothing to keep. */
export function stampsFile(library: StampLibrary): string | null {
  if (!library.stamps.length && !library.deleted?.length) return null
  return json(
    withExtra(
      {
        stamps: [...library.stamps].sort(byName).map((stamp) => withExtra({ id: stamp.id, name: stamp.name, svg: stamp.svg, updatedAt: stamp.updatedAt }, stamp.extra)),
        ...(library.deleted?.length ? { deleted: [...library.deleted].sort() } : {}),
      },
      library.extra,
    ),
  )
}

/** The own stamps of a file, cleaned again (the file may have been edited elsewhere); null when it is not an object. */
export function parseStamps(data: FileData | undefined): StampLibrary | null {
  const value = readJson(data)
  if (!isObject(value)) return null
  const stamps = (Array.isArray(value.stamps) ? value.stamps : []).flatMap((raw): CustomStamp[] => {
    if (!isObject(raw) || !str(raw.id) || !str(raw.name) || !str(raw.svg)) return []
    const clean = sanitizeSvg(raw.svg)
    if (!clean) return []
    const stamp: CustomStamp = { id: raw.id, name: raw.name, svg: clean.svg, updatedAt: Number(raw.updatedAt) || 0 }
    const extra = extraOf(raw, STAMP_KEYS)
    return [extra ? { ...stamp, extra } : stamp]
  })
  const library: StampLibrary = { stamps }
  const deleted = Array.isArray(value.deleted) ? value.deleted.filter(str) : []
  if (deleted.length) library.deleted = deleted
  const extra = extraOf(value, TOP_KEYS)
  if (extra) library.extra = extra
  return library
}

/** Both devices' stamps: removed ones stay removed, the newer version of a stamp wins. */
export function mergeStamps(local: StampLibrary, remote: StampLibrary): StampLibrary {
  const deleted = new Set([...(local.deleted ?? []), ...(remote.deleted ?? [])])
  const stamps = new Map<string, CustomStamp>()
  for (const stamp of [...local.stamps, ...remote.stamps]) {
    if (deleted.has(stamp.id)) continue
    const known = stamps.get(stamp.id)
    if (!known || stamp.updatedAt > known.updatedAt) stamps.set(stamp.id, stamp)
  }
  const merged: StampLibrary = { ...(local.extra ?? remote.extra ? { extra: local.extra ?? remote.extra } : {}), stamps: [...stamps.values()].sort(byName) }
  if (deleted.size) merged.deleted = [...deleted].sort()
  return merged
}
