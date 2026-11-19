import type { Chapter, ChapterComment, TrashItem } from '../types'
import { announceChange, db, newId } from './connection'
import { getChapter, listChapters } from './db'
import { trashChapter } from './trash'
import { autoVersion } from './versions'

/** A line that can become a chapter: exactly two # and a title. */
export function isSplitLine(line: string): boolean {
  return /^##[ \t]+\S/.test(line)
}

const titleOf = (line: string) =>
  line
    .replace(/^##[ \t]+/, '')
    .replace(/\*\*|==|\*/g, '')
    .trim()

/** Lines that hold nothing, at the very start: they go with the cut. */
const LEADING_BLANK = /^(?:[ \t]*\r?\n)+/

/**
 * Splits a chapter at a "## Title" line: everything from there becomes a new chapter right after
 * it, named after the line. Status, group, tags and date go along; comments follow their text; the
 * outline stays. Returns the new chapter, or null when the line is not a ## line.
 */
export async function splitChapter(chapterId: string, lineFrom: number): Promise<Chapter | null> {
  const chapter = await getChapter(chapterId)
  if (!chapter) return null
  const content = chapter.content
  if (lineFrom < 0 || lineFrom > content.length || (lineFrom > 0 && content[lineFrom - 1] !== '\n')) return null
  const end = content.indexOf('\n', lineFrom)
  const lineEnd = end < 0 ? content.length : end
  const line = content.slice(lineFrom, lineEnd).replace(/\r$/, '')
  if (!isSplitLine(line)) return null

  const before = content.slice(0, lineFrom).replace(/\s+$/, '')
  const rest = content.slice(lineEnd)
  const after = rest.replace(LEADING_BLANK, '')
  const afterStart = lineEnd + (rest.length - after.length)

  const stays: ChapterComment[] = []
  const moves: ChapterComment[] = []
  for (const comment of chapter.comments ?? []) {
    if (comment.from >= lineFrom) {
      const from = Math.max(0, comment.from - afterStart)
      moves.push({ ...comment, from, to: Math.max(from, comment.to - afterStart) })
    } else {
      stays.push({ ...comment, from: Math.min(comment.from, before.length), to: Math.min(comment.to, before.length) })
    }
  }

  await autoVersion(chapter, content, { label: 'Vor dem Teilen', always: true })
  const now = Date.now()
  const created: Chapter = {
    id: newId(),
    bookId: chapter.bookId,
    title: titleOf(line) || 'Neues Kapitel',
    content: after,
    ...(chapter.status ? { status: chapter.status } : {}),
    ...(chapter.group ? { group: chapter.group } : {}),
    ...(chapter.tags?.length ? { tags: [...chapter.tags] } : {}),
    ...(chapter.date ? { date: chapter.date } : {}),
    ...(moves.length ? { comments: moves } : {}),
    updatedAt: now,
  }
  const first: Chapter = { ...chapter, content: before, updatedAt: now }
  if (stays.length) first.comments = stays
  else delete first.comments

  const tx = (await db()).transaction(['books', 'chapters'], 'readwrite')
  const book = await tx.objectStore('books').get(chapter.bookId)
  await tx.objectStore('chapters').put(first)
  await tx.objectStore('chapters').put(created)
  if (book) {
    const order = book.chapterOrder.filter((id) => id !== created.id)
    const at = order.indexOf(chapter.id)
    order.splice(at < 0 ? order.length : at + 1, 0, created.id)
    await tx.objectStore('books').put({ ...book, chapterOrder: order, updatedAt: now })
  }
  await tx.done
  announceChange()
  return created
}

/**
 * Appends the next chapter (book order) under a "## Title" line and puts the next chapter in the
 * trash. Outlines are joined and tags combined; status, group and date stay those of the first.
 * Null when there is no next chapter.
 */
export async function mergeWithNext(chapterId: string): Promise<{ merged: Chapter; trashed: TrashItem } | null> {
  const chapter = await getChapter(chapterId)
  if (!chapter) return null
  const chapters = await listChapters(chapter.bookId)
  const next = chapters[chapters.findIndex((c) => c.id === chapterId) + 1]
  if (!next || chapters.findIndex((c) => c.id === chapterId) < 0) return null

  await autoVersion(chapter, chapter.content, { label: 'Vor dem Zusammenführen', always: true })
  const head = chapter.content.replace(/\s+$/, '')
  const prefix = `${head ? `${head}\n\n` : ''}## ${next.title}\n\n`
  const moved = (next.comments ?? []).map((comment) => ({ ...comment, from: comment.from + prefix.length, to: comment.to + prefix.length }))
  const comments = [...(chapter.comments ?? []), ...moved].sort((a, b) => a.from - b.from)
  const outline = [chapter.outline, next.outline].filter((text) => text?.trim()).join('\n\n')
  const tags = [...new Set([...(chapter.tags ?? []), ...(next.tags ?? [])])]

  const merged: Chapter = { ...chapter, content: prefix + next.content, updatedAt: Date.now() }
  if (comments.length) merged.comments = comments
  if (outline) merged.outline = outline
  if (tags.length) merged.tags = tags
  await (await db()).put('chapters', merged)
  announceChange()

  const trashed = await trashChapter(next.id)
  if (!trashed) return null
  return { merged, trashed }
}
