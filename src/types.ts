export type FontId = 'literata' | 'inter' | 'courier-prime'

export interface Book {
  id: string
  title: string
  font: FontId
  chapterOrder: string[]
  createdAt: number
  updatedAt: number
}

export interface Chapter {
  id: string
  bookId: string
  title: string
  content: string
  /** Free-text note shown in the outline. Missing on chapters created before the outline existed. */
  outline?: string
  updatedAt: number
}

export type ZoomArea = 'editor' | 'wiki' | 'outline' | 'panel'

export interface WikiFolder {
  id: string
  bookId: string
  parentId: string | null
  name: string
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
