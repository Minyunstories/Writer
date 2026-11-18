import type { FileData } from '../sync/hash'
import type { BookVocabulary, VocabKnown, VocabLearner, VocabWord } from '../types'

const decoder = new TextDecoder()
type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/** The fields of an object this version does not know, or undefined when there are none. */
function extraOf(raw: Raw, known: string[]): Record<string, unknown> | undefined {
  const rest = Object.entries(raw).filter(([key]) => !known.includes(key))
  return rest.length ? Object.fromEntries(rest) : undefined
}

/** Known fields first, then unknown ones that do not clash with them. */
function withExtra(fields: Raw, extra: Record<string, unknown> | undefined): Raw {
  if (!extra) return fields
  const rest = Object.entries(extra).filter(([key]) => !(key in fields))
  return { ...fields, ...Object.fromEntries(rest) }
}

const LEARNER_KEYS = ['entry', 'removed', 'updatedAt']
const WORD_KEYS = ['id', 'word', 'translation', 'note', 'known', 'createdAt', 'updatedAt']
const KNOWN_KEYS = ['entry', 'chapter']
const TOP_KEYS = ['learners', 'words', 'deleted']

/** vocabulary.json: learners by entry, words by creation, deletions sorted. Undefined when there is nothing. */
export function vocabularyFile(vocabulary: BookVocabulary): string | undefined {
  const { learners, words, deleted } = vocabulary
  if (!learners.length && !words.length && !deleted?.length) return undefined
  const value = withExtra(
    {
      learners: [...learners]
        .sort((a, b) => a.entryId.localeCompare(b.entryId))
        .map((learner) => withExtra({ entry: learner.entryId, ...(learner.removed ? { removed: true } : {}), updatedAt: learner.updatedAt }, learner.extra)),
      words: [...words]
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        .map((word) =>
          withExtra(
            {
              id: word.id,
              word: word.word,
              translation: word.translation,
              ...(word.note ? { note: word.note } : {}),
              known: [...word.known]
                .sort((a, b) => a.entryId.localeCompare(b.entryId))
                .map((known) => withExtra({ entry: known.entryId, chapter: known.chapterId }, known.extra)),
              createdAt: word.createdAt,
              updatedAt: word.updatedAt,
            },
            word.extra,
          ),
        ),
      ...(deleted?.length ? { deleted: [...deleted].sort() } : {}),
    },
    vocabulary.extra,
  )
  return `${JSON.stringify(value, null, 2)}\n`
}

function parseKnown(raw: unknown): VocabKnown[] {
  if (!isObject(raw) || !str(raw.entry) || !str(raw.chapter)) return []
  const known: VocabKnown = { entryId: raw.entry, chapterId: raw.chapter }
  const extra = extraOf(raw, KNOWN_KEYS)
  if (extra) known.extra = extra
  return [known]
}

function parseWord(raw: unknown): VocabWord[] {
  if (!isObject(raw) || !str(raw.id) || !str(raw.word)) return []
  const word: VocabWord = {
    id: raw.id,
    word: raw.word,
    translation: typeof raw.translation === 'string' ? raw.translation : '',
    known: Array.isArray(raw.known) ? raw.known.flatMap(parseKnown) : [],
    createdAt: Number(raw.createdAt) || 0,
    updatedAt: Number(raw.updatedAt) || 0,
  }
  if (str(raw.note)) word.note = raw.note
  const extra = extraOf(raw, WORD_KEYS)
  if (extra) word.extra = extra
  return [word]
}

function parseLearner(raw: unknown): VocabLearner[] {
  if (!isObject(raw) || !str(raw.entry)) return []
  const learner: VocabLearner = { entryId: raw.entry, updatedAt: Number(raw.updatedAt) || 0 }
  if (raw.removed === true) learner.removed = true
  const extra = extraOf(raw, LEARNER_KEYS)
  if (extra) learner.extra = extra
  return [learner]
}

/** The usable content of a vocabulary.json; null when it is not an object. Tolerant of half-broken files. */
export function parseVocabulary(data: FileData | undefined): BookVocabulary | null {
  if (data === undefined) return null
  let value: unknown
  try {
    value = JSON.parse(typeof data === 'string' ? data : decoder.decode(data))
  } catch {
    return null
  }
  if (!isObject(value)) return null
  const vocabulary: BookVocabulary = {
    learners: Array.isArray(value.learners) ? value.learners.flatMap(parseLearner) : [],
    words: Array.isArray(value.words) ? value.words.flatMap(parseWord) : [],
  }
  const deleted = Array.isArray(value.deleted) ? value.deleted.filter(str) : []
  if (deleted.length) vocabulary.deleted = deleted
  const extra = extraOf(value, TOP_KEYS)
  if (extra) vocabulary.extra = extra
  return vocabulary
}

/** Both sides changed: everything from both; per word and per learner the newer wins (a tie keeps mine); deletions stay. */
export function mergeVocabulary(mine: BookVocabulary, theirs: BookVocabulary): BookVocabulary {
  const deleted = [...new Set([...(mine.deleted ?? []), ...(theirs.deleted ?? [])])].sort()
  const gone = new Set(deleted)
  const words = new Map<string, VocabWord>()
  for (const word of [...theirs.words, ...mine.words]) {
    if (gone.has(word.id)) continue
    const other = words.get(word.id)
    if (!other || other.updatedAt <= word.updatedAt) words.set(word.id, word)
  }
  const learners = new Map<string, VocabLearner>()
  for (const learner of [...theirs.learners, ...mine.learners]) {
    const other = learners.get(learner.entryId)
    if (!other || other.updatedAt <= learner.updatedAt) learners.set(learner.entryId, learner)
  }
  const merged: BookVocabulary = {
    learners: [...learners.values()].sort((a, b) => a.entryId.localeCompare(b.entryId)),
    words: [...words.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
  }
  if (deleted.length) merged.deleted = deleted
  const extra = { ...theirs.extra, ...mine.extra }
  if (Object.keys(extra).length) merged.extra = extra
  return merged
}
