import type { Chapter, ChapterComment } from '../types'
import { announceChange, db, newId } from './connection'

export const COMMENTS_EVENT = 'mw:comments'
const tell = (chapterId: string) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(COMMENTS_EVENT, { detail: chapterId }))
}

/** Changes a chapter's comments inside one transaction; the text is left alone. */
async function changeComments(chapterId: string, change: (comments: ChapterComment[]) => ChapterComment[], quiet = false): Promise<Chapter | null> {
  const tx = (await db()).transaction('chapters', 'readwrite')
  const chapter = await tx.store.get(chapterId)
  if (!chapter) {
    await tx.done
    return null
  }
  const comments = change(chapter.comments ?? [])
  const next: Chapter = { ...chapter }
  if (comments.length > 0) next.comments = comments
  else delete next.comments
  await tx.store.put(next)
  await tx.done
  announceChange()
  if (!quiet) tell(chapterId)
  return next
}

export async function addComment(chapterId: string, place: { from: number; to: number; quote: string; text: string }): Promise<ChapterComment> {
  const now = Date.now()
  const comment: ChapterComment = { id: newId(), from: place.from, to: place.to, quote: place.quote, text: place.text.trim(), done: false, createdAt: now, updatedAt: now }
  await changeComments(chapterId, (comments) => [...comments, comment].sort((a, b) => a.from - b.from))
  return comment
}

export async function updateComment(chapterId: string, id: string, patch: Partial<Pick<ChapterComment, 'text' | 'done'>>): Promise<void> {
  await changeComments(chapterId, (comments) =>
    comments.map((comment) =>
      comment.id === id ? { ...comment, ...(patch.text !== undefined ? { text: patch.text.trim() } : {}), ...(patch.done !== undefined ? { done: patch.done } : {}), updatedAt: Date.now() } : comment,
    ),
  )
}

export async function deleteComment(chapterId: string, id: string): Promise<void> {
  await changeComments(chapterId, (comments) => comments.filter((comment) => comment.id !== id))
}

/** Where the comments are now that the text changed; does not count as changing the comments. */
export async function placeComments(chapterId: string, places: { id: string; from: number; to: number; quote: string }[]): Promise<void> {
  const byId = new Map(places.map((place) => [place.id, place]))
  await changeComments(chapterId, (comments) =>
    comments
      .map((comment) => {
        const place = byId.get(comment.id)
        return place ? { ...comment, from: place.from, to: place.to, quote: place.quote } : comment
      })
      .sort((a, b) => a.from - b.from),
    true,
  )
}

/** The comment's stretch in this text: where it was, else the nearest place with its words, else kept in range. */
export function resolveAnchor(content: string, comment: Pick<ChapterComment, 'from' | 'to' | 'quote'>): { from: number; to: number } {
  if (comment.quote && content.slice(comment.from, comment.to) === comment.quote) return { from: comment.from, to: comment.to }
  if (comment.quote) {
    let best = -1
    for (let at = content.indexOf(comment.quote); at >= 0; at = content.indexOf(comment.quote, at + 1)) {
      if (best < 0 || Math.abs(at - comment.from) < Math.abs(best - comment.from)) best = at
    }
    if (best >= 0) return { from: best, to: best + comment.quote.length }
  }
  const from = Math.min(comment.from, content.length)
  return { from, to: Math.min(Math.max(comment.to, from), content.length) }
}
