/**
 * A scene break: a line of *** (or * * *), maybe with the scene's name after a space ("*** Arrival").
 * Stars glued to a word ("***Wow!***") are bold italic text, not a break.
 */
// Any spaces count between the stars (pasted text often has non-breaking ones). The name starts and ends
// with a visible character, so long runs of spaces cannot make the pattern slow.
const SCENE_BREAK = /^\s*(\*(?:[^\S\n]*\*){2,})(?:[^\S\n]+(\S(?:[^\n]*\S)?))?[^\S\n]*$/

export function isSceneBreak(line: string): boolean {
  return SCENE_BREAK.test(line)
}

/** The stars as typed and the name, if the line is a scene break. */
export function parseSceneBreak(line: string): { stars: string; name?: string } | null {
  const match = SCENE_BREAK.exec(line)
  if (!match) return null
  const name = match[2]?.trim()
  return name ? { stars: match[1], name } : { stars: match[1] }
}

/** The text with every scene name replaced by spaces, so positions stay the same (for the spell check). */
export function maskSceneNames(text: string): string {
  if (!text.includes('*')) return text
  return text
    .split('\n')
    .map((line) => {
      const match = SCENE_BREAK.exec(line)
      if (!match?.[2]) return line
      const at = line.lastIndexOf(match[2])
      return line.slice(0, at) + ' '.repeat(match[2].length) + line.slice(at + match[2].length)
    })
    .join('\n')
}
