const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u

export function countWords(text: string): number {
  let count = 0
  for (const token of text.split(/[\s\u2014\u2013\u2026]+/)) {
    if (HAS_WORD_CHARACTER.test(token)) count++
  }
  return count
}

export function formatWordCount(count: number): string {
  return `${count.toLocaleString('de-DE')} ${count === 1 ? 'Wort' : 'Wörter'}`
}
