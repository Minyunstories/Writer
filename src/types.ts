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
  /** The writer's order of wiki folders and entries: folder id (or "_root") to ids. */
  wikiOrder?: Record<string, string[]>
  /** Wiki entries marked with a star, e.g. main characters. */
  wikiStars?: string[]
  /** The notepad: ideas waiting for a better place, newest first. */
  notes?: BookNote[]
  /** Spelling and grammar check: English variant, words that are right, ignored spots. */
  spelling?: BookSpelling
  /** Relationships between wiki entries, and the kinds the writer defined. */
  relations?: BookRelations
}

/** A kind of relationship, named from each side: "Lehrer von" / "Schüler von". No backward name: the same both ways. */
export interface RelationType {
  id: string
  forward: string
  backward?: string
}

/** "from" is <forward> "to"; seen from "to", it is <backward>. */
export interface Relation {
  id: string
  from: string
  to: string
  typeId: string
  note?: string
  createdAt: number
  updatedAt: number
}

export interface BookRelations {
  types: RelationType[]
  relations: Relation[]
  /** Ids of deleted types and relations, so a sync does not bring them back. */
  deleted?: string[]
}

export type EnglishDialect = 'american' | 'british' | 'australian' | 'canadian'

export interface BookSpelling {
  dialect?: EnglishDialect
  /** Words the check accepts, e.g. invented names or a character's way of speaking. */
  words?: string[]
  /** Spots the writer chose to ignore, as Harper's context hashes. */
  ignored?: string[]
  /** Harper rules switched off for this book. */
  rules?: string[]
}

export interface BookNote {
  id: string
  text: string
  /** Where the idea came up. */
  chapterId?: string
  from?: number
  done: boolean
  createdAt: number
  updatedAt: number
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
  /** How far the chapter is. Missing when not set. */
  status?: ChapterStatus
  /** Comments on parts of the text. Missing when there are none. */
  comments?: ChapterComment[]
  updatedAt: number
}

/** A comment on a stretch of chapter text. The quote finds the place again if the text moved. */
export interface ChapterComment {
  id: string
  from: number
  to: number
  quote: string
  text: string
  done: boolean
  createdAt: number
  updatedAt: number
}

export type ChapterStatus = 'idea' | 'draft' | 'revision' | 'done'

export type ZoomArea = 'editor' | 'wiki' | 'outline' | 'panel' | 'manuscript'

export interface WikiFolder {
  id: string
  bookId: string
  parentId: string | null
  name: string
  /** Field names every entry in this folder (and below) shows. Only used on top-level folders. */
  template?: string[]
  /** Colour of the folder in the wiki, chosen by the writer. Only used on top-level folders. */
  color?: string
  /** Starred property blocks every entry in this folder shows, in order. */
  templateBlocks?: string[]
  /** Template field to its starred block; fields not listed stand outside any block. */
  templateGroups?: Record<string, string>
  createdAt: number
}

export interface WikiProperty {
  id: string
  key: string
  value: string
  /** The block the property stands in, e.g. "Aussehen". Missing: outside any block. */
  group?: string
}

export interface WikiEntry {
  id: string
  bookId: string
  folderId: string | null
  name: string
  aliases: string[]
  properties: WikiProperty[]
  /** This entry's own property blocks, in order (starred blocks come from the folder). */
  blocks?: string[]
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

/** One phrase, word or beat in the collection shared by all books. */
export interface CollectionItem {
  id: string
  text: string
  category: string
  group?: string
  tags?: string[]
  note?: string
  /** Where it was taken from the writing. */
  source?: { bookId: string; bookTitle: string; chapterId: string; offset: number }
  createdAt: number
  updatedAt: number
}

export interface CollectionGuide {
  title: string
  rules: string[]
  selfcheck: string[]
  /** Short explanation per category. */
  notes?: Record<string, string>
}

/** The collection: shared by all books, synchronised in a file of its own. */
export interface Collection {
  items: CollectionItem[]
  /** Ids of deleted items, so a sync does not bring them back. */
  deleted?: string[]
  guide?: CollectionGuide
}

/** A saved state of a chapter's text. */
export interface ChapterVersion {
  id: string
  bookId: string
  chapterId: string
  content: string
  createdAt: number
  /** The writer's name for it. Named versions are kept and synchronised. */
  label?: string
  /** Made by the app (when the chapter was opened, before replacing). Kept on this device only. */
  auto: boolean
}
