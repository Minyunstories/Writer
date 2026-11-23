import { isSceneBreak } from './sceneBreak'

const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u

/** Words of a text; the names of scenes (after ***) are not part of it. */
export function countWords(text: string): number {
  const counted = text.includes('*') ? text.split('\n').filter((line) => !isSceneBreak(line)).join('\n') : text
  let count = 0
  for (const token of counted.split(/[\s\u2014\u2013\u2026]+/)) {
    if (HAS_WORD_CHARACTER.test(token)) count++
  }
  return count
}

export function formatWordCount(count: number): string {
  return `${count.toLocaleString('de-DE')} ${count === 1 ? 'Wort' : 'Wörter'}`
}
