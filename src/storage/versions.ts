import type { Chapter, ChapterVersion } from '../types'
import { announceChange, db, newId } from './connection'

/** Automatic versions are at least this far apart. */
export const AUTO_GAP = 10 * 60 * 1000
/** Automatic versions kept per chapter; named ones are never removed by the app. */
export const MAX_AUTO = 20

export const VERSION_EVENT = 'mw:versions'
const changed = (chapterId: string) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(VERSION_EVENT, { detail: chapterId }))
}

/** Newest first. */
export async function listVersions(chapterId: string): Promise<ChapterVersion[]> {
  const versions = await (await db()).getAllFromIndex('versions', 'chapterId', chapterId)
  return versions.sort((a, b) => b.createdAt - a.createdAt)
}

type ChapterRef = Pick<Chapter, 'id' | 'bookId'>

/** A version the writer asked for, optionally with a name. Synchronised. */
export async function saveVersion(chapter: ChapterRef, content: string, label?: string): Promise<ChapterVersion> {
  const tx = (await db()).transaction('versions', 'readwrite')
  const newest = Math.max(0, ...(await tx.store.index('chapterId').getAll(chapter.id)).map((v) => v.createdAt))
  // Strictly after the newest, so the order is always clear.
  const version: ChapterVersion = { id: newId(), bookId: chapter.bookId, chapterId: chapter.id, content, createdAt: Math.max(Date.now(), newest + 1), auto: false }
  if (label?.trim()) version.label = label.trim()
  await tx.store.put(version)
  await tx.done
  announceChange()
  changed(chapter.id)
  return version
}

/**
 * A safety copy made by the app. Skipped for empty text, for text equal to the newest version and,
 * unless `always`, when the last automatic one is recent. Only the newest automatic ones are kept.
 */
export async function autoVersion(
  chapter: ChapterRef,
  content: string,
  options: { now?: number; label?: string; always?: boolean } = {},
): Promise<ChapterVersion | null> {
  if (!content.trim()) return null
  const now = options.now ?? Date.now()
  const tx = (await db()).transaction('versions', 'readwrite')
  const versions = (await tx.store.index('chapterId').getAll(chapter.id)).sort((a, b) => b.createdAt - a.createdAt)
  const lastAuto = versions.find((version) => version.auto)
  if (versions[0]?.content === content || (!options.always && lastAuto && now - lastAuto.createdAt < AUTO_GAP)) {
    await tx.done
    return null
  }
  const createdAt = Math.max(now, (versions[0]?.createdAt ?? 0) + 1)
  const version: ChapterVersion = { id: newId(), bookId: chapter.bookId, chapterId: chapter.id, content, createdAt, auto: true }
  if (options.label) version.label = options.label
  await tx.store.put(version)
  for (const old of versions.filter((v) => v.auto).slice(MAX_AUTO - 1)) await tx.store.delete(old.id)
  await tx.done
  changed(chapter.id)
  return version
}

export async function renameVersion(id: string, label: string): Promise<void> {
  const tx = (await db()).transaction('versions', 'readwrite')
  const version = await tx.store.get(id)
  if (version) {
    const next: ChapterVersion = { ...version }
    if (label.trim()) next.label = label.trim()
    else delete next.label
    await tx.store.put(next)
  }
  await tx.done
  if (version) {
    if (!version.auto) announceChange()
    changed(version.chapterId)
  }
}

export async function deleteVersion(id: string): Promise<void> {
  const tx = (await db()).transaction('versions', 'readwrite')
  const version = await tx.store.get(id)
  await tx.store.delete(id)
  await tx.done
  if (version) {
    if (!version.auto) announceChange()
    changed(version.chapterId)
  }
}
