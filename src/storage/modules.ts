import type { ModuleId } from '../modules/modules'
import type { Book } from '../types'
import { announceChange, db } from './connection'

/** Switches a module on or off for one book. Off only hides it: the module's data stays. */
export async function setModule(bookId: string, id: ModuleId, on: boolean): Promise<Book> {
  const tx = (await db()).transaction('books', 'readwrite')
  const current = await tx.store.get(bookId)
  if (!current) throw new Error(`Book not found: ${bookId}`)
  const modules = { ...current.modules }
  if (on) modules[id] = true
  else delete modules[id]
  const next: Book = { ...current, modules }
  if (!Object.keys(modules).length) delete next.modules
  await tx.store.put(next)
  await tx.done
  announceChange()
  return next
}
