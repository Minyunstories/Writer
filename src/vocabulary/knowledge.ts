import { isModuleOn } from '../modules/modules'
import type { Book, BookVocabulary, VocabWord, WikiEntry } from '../types'

/** For comparing words: no case, no accents, single spaces. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// Spaces, punctuation, quote marks and the Markdown marks for italic, bold and highlight (hidden while writing).
const EDGE = `\\s.,;:!?…"'„“”‚‘’»«()\\[\\]—–\\-*_=~`
const EDGES = new RegExp(`^[${EDGE}]+|[${EDGE}]+$`, 'gu')

/** A selection as a word: what surrounds it removed, line breaks and runs of spaces made single spaces. */
export function cleanCapture(text: string): string {
  return text.replace(EDGES, '').replace(/\s+/g, ' ')
}

export function findWord(words: VocabWord[], text: string): VocabWord | undefined {
  const wanted = normalize(text)
  return words.find((word) => normalize(word.word) === wanted)
}

/** Words whose word, translation or note contains the query, alphabetically by word. */
export function searchWords(words: VocabWord[], query: string): VocabWord[] {
  const wanted = normalize(query)
  return words
    .filter((word) => !wanted || [word.word, word.translation, word.note ?? ''].some((field) => normalize(field).includes(wanted)))
    .sort((a, b) => normalize(a.word).localeCompare(normalize(b.word)) || a.word.localeCompare(b.word))
}

/** The figures learning the language that still exist in the wiki, by name. */
export function activeLearners(vocabulary: BookVocabulary | undefined, entries: WikiEntry[]): WikiEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  return (vocabulary?.learners ?? [])
    .filter((learner) => !learner.removed)
    .flatMap((learner) => byId.get(learner.entryId) ?? [])
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type WordState = { kind: 'known' } | { kind: 'later'; chapterId: string } | { kind: 'unknown' } | { kind: 'chapterGone' }

/** Whether a learner knows a word in the given chapter. */
export function wordState(word: VocabWord, learnerId: string, chapterOrder: string[], currentChapterId: string): WordState {
  const known = word.known.find((item) => item.entryId === learnerId)
  if (!known) return { kind: 'unknown' }
  const from = chapterOrder.indexOf(known.chapterId)
  if (from < 0) return { kind: 'chapterGone' }
  return from <= chapterOrder.indexOf(currentChapterId) ? { kind: 'known' } : { kind: 'later', chapterId: known.chapterId }
}

/** What the spell check accepts besides its word list: wiki names, and the vocabulary while the module is on. */
export function spellingNames(book: Book, entries: WikiEntry[]): string[] {
  const names = entries.flatMap((entry) => [entry.name, ...entry.aliases])
  if (!isModuleOn(book, 'vocabulary')) return names
  return [...names, ...(book.vocabulary?.words ?? []).map((word) => word.word)]
}
