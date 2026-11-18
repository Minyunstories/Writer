import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Book, Chapter, Collection, WikiEntry, WikiFolder, WikiImage } from '../types'

let DB_NAME = 'minyunwriter'
const DB_VERSION = 4
const FALLBACK_TITLE = 'Unbenannt'

export interface Schema extends DBSchema {
  books: { key: string; value: Book }
  chapters: { key: string; value: Chapter; indexes: { bookId: string } }
  wikiFolders: { key: string; value: WikiFolder; indexes: { bookId: string } }
  wikiEntries: { key: string; value: WikiEntry; indexes: { bookId: string } }
  wikiImages: { key: string; value: WikiImage; indexes: { bookId: string; entryId: string } }
  /** What was last synchronised: path to Git blob hash. A single record with id 'state'. */
  syncState: { key: string; value: { id: string; repository?: string; base: Record<string, string> } }
  /** Data shared by all books, one record per kind; for now only the collection (id 'collection'). */
  shared: { key: string; value: Collection & { id: string } }
}

/** Thrown when a chapter's stored text is not the text the caller last saw. */
export class ConflictError extends Error {
  constructor() {
    super('Chapter content changed elsewhere')
    this.name = 'ConflictError'
  }
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null

export function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    const opening = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore('books', { keyPath: 'id' })
          const chapters = database.createObjectStore('chapters', { keyPath: 'id' })
          chapters.createIndex('bookId', 'bookId')
        }
        if (oldVersion < 2) {
          database.createObjectStore('wikiFolders', { keyPath: 'id' }).createIndex('bookId', 'bookId')
          database.createObjectStore('wikiEntries', { keyPath: 'id' }).createIndex('bookId', 'bookId')
          const images = database.createObjectStore('wikiImages', { keyPath: 'id' })
          images.createIndex('bookId', 'bookId')
          images.createIndex('entryId', 'entryId')
        }
        if (oldVersion < 3) {
          database.createObjectStore('syncState', { keyPath: 'id' })
        }
        if (oldVersion < 4) {
          database.createObjectStore('shared', { keyPath: 'id' })
        }
      },
      // A newer version of the app wants to upgrade: step aside.
      blocking(_current, _blocked, event) {
        ;(event.target as IDBDatabase | null)?.close()
        if (dbPromise === opening) dbPromise = null
      },
      // The browser closed the connection: reconnect on the next call.
      terminated() {
        if (dbPromise === opening) dbPromise = null
      },
    })
    dbPromise = opening
    // A failed open must not be cached, or every later call fails too.
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null
    })
  }
  return dbPromise
}

export async function resetDatabaseForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close()
  dbPromise = null
  await deleteDB(DB_NAME)
}

/** Tests only: switch to another database, to play a second device. */
export async function useDatabaseForTests(name: string): Promise<void> {
  if (dbPromise) (await dbPromise).close()
  dbPromise = null
  DB_NAME = name
}

export const CHANGED_EVENT = 'mw:changed'
export const SYNCED_EVENT = 'mw:synced'

/** Tells the rest of the app that something was written by the writer (not by a sync run). */
export function announceChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGED_EVENT))
}

export function cleanTitle(title: string): string {
  return title.trim() || FALLBACK_TITLE
}

/** Trims names, drops empty ones and repeats (the first one stays). */
export function cleanList(list: string[]): string[] {
  const seen = new Set<string>()
  for (const item of list) {
    const trimmed = item.trim()
    if (trimmed) seen.add(trimmed)
  }
  return [...seen]
}

export function newId(): string {
  return crypto.randomUUID()
}
