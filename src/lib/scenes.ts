import { SEPARATOR } from '../editor/livePreview'
import { countWords } from './wordCount'

export interface Scene {
  /** Where the scene's text starts (after the break). */
  from: number
  /** Its first words, without markup. */
  preview: string
  words: number
}

const PREVIEW = 50

const plain = (line: string) => line.replace(/\*\*|__|==|[*_]|\[\[|\]\]/g, '').replace(/^#+\s*/, '').trim()

/** A chapter's scenes, separated by lines of "***" or "* * *". */
export function splitScenes(content: string): Scene[] {
  const scenes: Scene[] = []
  let start = 0
  let offset = 0
  const finish = (end: number) => {
    const text = content.slice(start, end)
    const first = text.split('\n').map(plain).find((line) => line !== '') ?? ''
    const preview = first.length > PREVIEW ? `${first.slice(0, PREVIEW).replace(/\s+\S*$/, '')}…` : first
    // Start at the first written line, not at the blank lines after a break.
    const lead = text.length - text.trimStart().length
    scenes.push({ from: Math.min(start + lead, end), preview, words: countWords(text) })
  }
  for (const line of content.split('\n')) {
    if (SEPARATOR.test(line)) {
      finish(offset)
      start = offset + line.length + 1
    }
    offset += line.length + 1
  }
  finish(content.length)
  return scenes
}
