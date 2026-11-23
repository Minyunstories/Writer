import type { Book } from '../types'

export type ModuleId = 'vocabulary' | 'address' | 'sketches'

/** The modules this app version knows, in the order their tabs appear. `drawer: false`: no tab in the module drawer. */
export const MODULES: { id: ModuleId; name: string; tab: string; drawer?: false }[] = [
  { id: 'vocabulary', name: 'Vokabelheft', tab: 'Vokabeln' },
  { id: 'address', name: 'Anreden', tab: 'Anreden' },
  { id: 'sketches', name: 'Skizzen', tab: 'Skizzen', drawer: false },
]

export function isModuleOn(book: Pick<Book, 'modules'>, id: ModuleId): boolean {
  return book.modules?.[id] === true
}

/** The known modules switched on for a book, in tab order. */
export function activeModules(book: Pick<Book, 'modules'>): ModuleId[] {
  return MODULES.filter((module) => isModuleOn(book, module.id)).map((module) => module.id)
}

/** The switched-on modules that have a tab in the drawer under the chapter. */
export function drawerModules(book: Pick<Book, 'modules'>): ModuleId[] {
  return MODULES.filter((module) => module.drawer !== false && isModuleOn(book, module.id)).map((module) => module.id)
}
