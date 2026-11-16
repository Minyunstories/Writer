export type FontId = 'literata' | 'inter' | 'courier-prime'

export interface Book {
  id: string
  title: string
  font: FontId
  chapterOrder: string[]
  createdAt: number
  updatedAt: number
  /** Cover colour on the shelf. Missing: derived from the id (see coverOf). */
  cover?: string
  /** Colour of ==highlighted== text. Missing: copper. */
  highlight?: string
  /** Where text was last changed, so the book reopens there. */
  place?: BookPlace
}

export interface BookPlace {
  chapterId: string
  /** Character offset in the chapter text. */
  offset: number
  /** When it was recorded; the newer place wins between devices. */
  at: number
}

export interface Chapter {
  id: string
  bookId: string
  title: string
  content: string
  /** Free-text note shown in the outline. Missing on chapters created before the outline existed. */
  outline?: string
  /** Free tags shown in the outline, e.g. a point of view. Missing when there are none. */
  tags?: string[]
  /** Free-text date on the outline timeline, e.g. "März 1204". Missing when empty. */
  date?: string
  updatedAt: number
}

export type ZoomArea = 'editor' | 'wiki' | 'outline' | 'panel'

export interface WikiFolder {
  id: string
  bookId: string
  parentId: string | null
  name: string
  /** Field names every entry in this folder (and below) shows. Only used on top-level folders. */
  template?: string[]
  createdAt: number
}

export interface WikiProperty {
  id: string
  key: string
  value: string
}

export interface WikiEntry {
  id: string
  bookId: string
  folderId: string | null
  name: string
  aliases: string[]
  properties: WikiProperty[]
  imageIds: string[]
  body: string
  autoLink: boolean
  createdAt: number
  updatedAt: number
}

export interface WikiImage {
  id: string
  bookId: string
  entryId: string
  type: string
  data: ArrayBuffer
  width: number
  height: number
}
