import type { Book } from '../types'

export type ModuleId = 'vocabulary' | 'address'

/** The modules this app version knows, in the order their tabs appear. */
export const MODULES: { id: ModuleId; name: string; tab: string }[] = [
  { id: 'vocabulary', name: 'Vokabelheft', tab: 'Vokabeln' },
  { id: 'address', name: 'Anreden', tab: 'Anreden' },
]

export function isModuleOn(book: Pick<Book, 'modules'>, id: ModuleId): boolean {
  return book.modules?.[id] === true
}

/** The known modules switched on for a book, in tab order. */
export function activeModules(book: Pick<Book, 'modules'>): ModuleId[] {
  return MODULES.filter((module) => isModuleOn(book, module.id)).map((module) => module.id)
}
