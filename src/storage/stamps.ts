import { sanitizeSvg } from '../sketches/sanitizeSvg'
import type { CustomStamp, StampLibrary } from '../types'
import { announceChange, db, newId } from './connection'

/** Own stamps of the sketches module: one record in the shared store, for all books. */
export const STAMPS_ID = 'stamps'

async function read(): Promise<StampLibrary> {
  const stored = await (await db()).get('shared', STAMPS_ID)
  if (!stored || !('stamps' in stored)) return { stamps: [] }
  const { id: _id, ...library } = stored
  return library as StampLibrary
}

/** Changes the library in a single transaction; null leaves it as it is. */
async function change(update: (library: StampLibrary) => StampLibrary | null): Promise<void> {
  const tx = (await db()).transaction('shared', 'readwrite')
  const stored = await tx.store.get(STAMPS_ID)
  const library: StampLibrary = stored && 'stamps' in stored ? (({ id: _id, ...rest }) => rest as StampLibrary)(stored) : { stamps: [] }
  const next = update(library)
  if (next) await tx.store.put({ ...next, id: STAMPS_ID })
  await tx.done
  if (next) announceChange()
}

export async function listStamps(): Promise<CustomStamp[]> {
  return [...(await read()).stamps].sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/** Adds an own stamp from SVG text; null when nothing drawable is left after cleaning. */
export async function addCustomStamp(name: string, svg: string): Promise<CustomStamp | null> {
  const clean = sanitizeSvg(svg)
  if (!clean) return null
  const stamp: CustomStamp = { id: newId(), name: name.trim() || 'Stempel', svg: clean.svg, updatedAt: Date.now() }
  await change((library) => ({ ...library, stamps: [...library.stamps, stamp] }))
  return stamp
}

export async function renameCustomStamp(id: string, name: string): Promise<void> {
  const text = name.trim()
  await change((library) => {
    const old = library.stamps.find((stamp) => stamp.id === id)
    if (!old || !text || old.name === text) return null
    return { ...library, stamps: library.stamps.map((stamp) => (stamp.id === id ? { ...stamp, name: text, updatedAt: Math.max(Date.now(), stamp.updatedAt + 1) } : stamp)) }
  })
}

/** Deletes an own stamp; its id stays as a tombstone. Placed copies in sketches keep a grey placeholder. */
export async function deleteCustomStamp(id: string): Promise<void> {
  await change((library) =>
    library.stamps.some((stamp) => stamp.id === id)
      ? { ...library, stamps: library.stamps.filter((stamp) => stamp.id !== id), deleted: [...new Set([...(library.deleted ?? []), id])] }
      : null,
  )
}
