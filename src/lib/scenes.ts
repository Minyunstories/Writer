import { parseSceneBreak } from './sceneBreak'
import { countWords } from './wordCount'

export interface Scene {
  /** Where the scene begins, with its break or name line (0 for the first). */
  start: number
  /** Where the scene's text starts (after the break). */
  from: number
  /** Its first words, without markup. */
  preview: string
  words: number
  /** The name after the stars ("*** Arrival"), if it has one. */
  name?: string
}

const PREVIEW = 50

const plain = (line: string) => line.replace(/\*\*|__|==|[*_]|\[\[|\]\]/g, '').replace(/^#+\s*/, '').trim()

interface Marker {
  /** The line, without its line break. */
  from: number
  to: number
  stars: string
  name?: string
  /** A named line before any text: it names the first scene and is no break. */
  leading: boolean
}

/** The lines that start scenes: the breaks, and a named line at the very top. */
function markers(content: string): Marker[] {
  const found: Marker[] = []
  let offset = 0
  let text = false
  for (const line of content.split('\n')) {
    const scene = parseSceneBreak(line)
    if (scene) {
      const leading = !text && !!scene.name && found.length === 0
      found.push({ from: offset, to: offset + line.length, stars: scene.stars, ...(scene.name ? { name: scene.name } : {}), leading })
    } else if (line.trim()) text = true
    offset += line.length + 1
  }
  return found
}

/** A chapter's scenes, separated by lines of "***" or "* * *" (maybe with a name after the stars). */
export function splitScenes(content: string): Scene[] {
  const scenes: Scene[] = []
  const finish = (begin: number, start: number, end: number, name: string | undefined) => {
    const text = content.slice(start, end)
    const first = text.split('\n').map(plain).find((line) => line !== '') ?? ''
    const preview = first.length > PREVIEW ? `${first.slice(0, PREVIEW).replace(/\s+\S*$/, '')}…` : first
    // Start at the first written line, not at the blank lines after a break.
    const lead = text.length - text.trimStart().length
    scenes.push({ start: begin, from: Math.min(start + lead, end), preview, words: countWords(text), ...(name ? { name } : {}) })
  }
  let begin = 0
  let start = 0
  let name: string | undefined
  for (const marker of markers(content)) {
    if (!marker.leading) {
      finish(begin, start, marker.from, name)
      begin = marker.from
    }
    start = marker.to + 1
    name = marker.name
  }
  finish(begin, start, content.length, name)
  return scenes
}

/**
 * The change that gives a scene a new name (or none, when it is empty). A break keeps its stars;
 * the first scene gets a line "*** Name" at the top, which goes again with its name.
 * Null when nothing would change.
 */
export function renameScene(content: string, index: number, name: string): { from: number; to: number; insert: string } | null {
  // Stars in front of the name ("* Night") would read as part of the break.
  const clean = name.replace(/\s+/g, ' ').trim().replace(/^(?:\*+ )+/, '')
  const all = markers(content)
  const breaks = all.filter((marker) => !marker.leading)
  if (index < 0 || index > breaks.length) return null
  const marker = index === 0 ? all.find((candidate) => candidate.leading) : breaks[index - 1]
  // A name of only stars would read back as more stars.
  const survives = (stars: string) => parseSceneBreak(`${stars} ${clean}`)?.name === clean

  if (!marker) {
    if (!clean || !survives('***')) return null
    const at = splitScenes(content)[0].from
    return { from: at, to: at, insert: `*** ${clean}\n\n` }
  }
  if ((marker.name ?? '') === clean) return null
  if (!clean && marker.leading) {
    // The line goes, with the blank lines after it. (Was the first scene empty, it goes with it; a named
    // break right below then becomes the top line and keeps its name for its own text.)
    const after = /^\n(?:[ \t]*\n)*/.exec(content.slice(marker.to))
    return { from: marker.from, to: marker.to + (after?.[0].length ?? 0), insert: '' }
  }
  if (clean && !survives(marker.stars)) return null
  return { from: marker.from, to: marker.to, insert: clean ? `${marker.stars} ${clean}` : marker.stars }
}
