import type { BookVocabulary, VocabKnown, VocabWord } from '../types'
import { cleanCapture, findWord } from '../vocabulary/knowledge'
import { announceChange, db, newId } from './connection'

const empty = (): BookVocabulary => ({ learners: [], words: [] })
type KnownInput = { entryId: string; chapterId: string }

/**
 * Changes the vocabulary of one book in a single transaction. The update returns the new
 * vocabulary, or null to leave everything as it is.
 */
async function change(bookId: string, update: (vocabulary: BookVocabulary) => BookVocabulary | null): Promise<boolean> {
  const tx = (await db()).transaction('books', 'readwrite')
  const book = await tx.store.get(bookId)
  const next = book ? update(book.vocabulary ?? empty()) : null
  if (book && next) await tx.store.put({ ...book, vocabulary: next })
  await tx.done
  if (book && next) announceChange()
  return !!(book && next)
}

/** Everyone who knows a word is a learner: missing ones are added, removed ones come back. */
function withLearners(vocabulary: BookVocabulary, entryIds: string[], now: number): BookVocabulary {
  let learners = vocabulary.learners
  for (const entryId of new Set(entryIds)) {
    const current = learners.find((learner) => learner.entryId === entryId)
    if (current && !current.removed) continue
    const revived = { ...current, entryId, updatedAt: now }
    delete revived.removed
    learners = [...learners.filter((learner) => learner.entryId !== entryId), revived]
  }
  return learners === vocabulary.learners ? vocabulary : { ...vocabulary, learners }
}

const cleanKnown = (known: KnownInput[], previous: VocabKnown[] = []): VocabKnown[] => {
  const seen = new Set<string>()
  return known.flatMap((item) => {
    if (!item.entryId || !item.chapterId || seen.has(item.entryId)) return []
    seen.add(item.entryId)
    const before = previous.find((old) => old.entryId === item.entryId)
    return [{ ...(before?.extra ? { extra: before.extra } : {}), entryId: item.entryId, chapterId: item.chapterId }]
  })
}

const knownKey = (known: VocabKnown[]) =>
  known
    .map((item) => `${item.entryId}\u0000${item.chapterId}`)
    .sort()
    .join('\u0001')

function sameWordContent(a: VocabWord, b: VocabWord): boolean {
  return a.word === b.word && a.translation === b.translation && (a.note ?? '') === (b.note ?? '') && knownKey(a.known) === knownKey(b.known)
}

export async function addWord(bookId: string, input: { word: string; translation?: string; note?: string; known?: KnownInput[] }): Promise<VocabWord> {
  const text = input.word.trim()
  if (!text) throw new Error('A word needs text')
  const now = Date.now()
  const word: VocabWord = { id: newId(), word: text, translation: input.translation?.trim() ?? '', known: cleanKnown(input.known ?? []), createdAt: now, updatedAt: now }
  if (input.note?.trim()) word.note = input.note.trim()
  await change(bookId, (vocabulary) =>
    withLearners({ ...vocabulary, words: [...vocabulary.words, word] }, word.known.map((item) => item.entryId), now),
  )
  return word
}

export async function updateWord(
  bookId: string,
  id: string,
  patch: { word?: string; translation?: string; note?: string; known?: KnownInput[] },
): Promise<void> {
  const now = Date.now()
  await change(bookId, (vocabulary) => {
    const current = vocabulary.words.find((word) => word.id === id)
    if (!current) return null
    const next: VocabWord = { ...current }
    if (patch.word !== undefined && patch.word.trim()) next.word = patch.word.trim()
    if (patch.translation !== undefined) next.translation = patch.translation.trim()
    if (patch.note !== undefined) {
      if (patch.note.trim()) next.note = patch.note.trim()
      else delete next.note
    }
    if (patch.known) next.known = cleanKnown(patch.known, current.known)
    // Nothing changed: no new time stamp, so this copy cannot win over an edit made on the other device.
    if (sameWordContent(current, next)) return null
    next.updatedAt = Math.max(now, current.updatedAt + 1)
    const words = vocabulary.words.map((word) => (word.id === id ? next : word))
    // Only figures newly added here become learners; one taken off the list stays off.
    const before = new Set(current.known.map((item) => item.entryId))
    return withLearners({ ...vocabulary, words }, next.known.map((item) => item.entryId).filter((entryId) => !before.has(entryId)), now)
  })
}

export async function deleteWord(bookId: string, id: string): Promise<void> {
  await change(bookId, (vocabulary) => ({
    ...vocabulary,
    words: vocabulary.words.filter((word) => word.id !== id),
    deleted: [...new Set([...(vocabulary.deleted ?? []), id])],
  }))
}

/** Adds a figure to the learners or takes it off. What it knows stays stored either way. */
export async function setLearner(bookId: string, entryId: string, learning: boolean): Promise<void> {
  const now = Date.now()
  await change(bookId, (vocabulary) => {
    if (learning) return withLearners(vocabulary, [entryId], now)
    const current = vocabulary.learners.find((learner) => learner.entryId === entryId)
    if (!current || current.removed) return null
    return {
      ...vocabulary,
      learners: vocabulary.learners.map((learner) => (learner.entryId === entryId ? { ...learner, removed: true, updatedAt: now } : learner)),
    }
  })
}

/**
 * Takes marked text into the vocabulary book. A word that is already there is not added twice:
 * it is returned, and the learner is added with this chapter unless it already knows the word.
 * Null when the selection holds no word.
 */
export async function captureWord(bookId: string, text: string, learner?: KnownInput): Promise<{ word: VocabWord; created: boolean } | null> {
  const cleaned = cleanCapture(text)
  if (!cleaned) return null
  const now = Date.now()
  let result: { word: VocabWord; created: boolean } | null = null
  await change(bookId, (vocabulary) => {
    const existing = findWord(vocabulary.words, cleaned)
    if (!existing) {
      const word: VocabWord = { id: newId(), word: cleaned, translation: '', known: learner ? cleanKnown([learner]) : [], createdAt: now, updatedAt: now }
      result = { word, created: true }
      return withLearners({ ...vocabulary, words: [...vocabulary.words, word] }, word.known.map((item) => item.entryId), now)
    }
    result = { word: existing, created: false }
    if (!learner || existing.known.some((item) => item.entryId === learner.entryId)) return null
    const word: VocabWord = { ...existing, known: [...existing.known, ...cleanKnown([learner])], updatedAt: Math.max(now, existing.updatedAt + 1) }
    result = { word, created: false }
    const words = vocabulary.words.map((item) => (item.id === word.id ? word : item))
    return withLearners({ ...vocabulary, words }, [learner.entryId], now)
  })
  return result
}
