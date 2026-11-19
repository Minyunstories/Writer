/** A word that comes back within a few sentences. Words of one group are the same word, linked in a chain. */
export interface Repeat {
  from: number
  to: number
  group: number
}

/** How many words apart two of the same word may be and still count as a repeat. */
export const REPEAT_WINDOW = 50

const WORD = /\p{L}+(?:['’]\p{L}+)*/gu

/** English words that repeat in any prose; marking them would only be noise. "said" stays invisible on purpose. */
const FILLER = new Set(
  (
    'the and but nor yet for she than then that this these those there here not too also only even still just very all any some each ' +
    'every both either neither such own same other more most much many few you your yours yourself yourselves him his himself her ' +
    'hers herself its itself our ours ourselves they them their theirs themselves who whom whose which what when where why how was ' +
    'were are been being have has had having does did done doing will would shall should can could may might must into onto upon ' +
    'about above below over under after before through between against among around from with without off out again said ' +
    'myself because while though although until toward towards across behind along within down like'
  ).split(' '),
)

/** The word without a possessive 's; null for contractions ("don't"), which are left alone. */
function bare(word: string): string | null {
  const stripped = word.replace(/['’][sS]$/, '')
  return /['’]/.test(stripped) ? null : stripped
}

/**
 * "star", "hop": one syllable ending in one vowel and one consonant (not w, x, y). Such a word doubles
 * its last letter before -ed/-ing (starred, hopping), so "stared" and "hoped" come from "stare" and
 * "hope", never from it.
 */
function doublesBeforeEnding(stem: string): boolean {
  return /^[^aeiou]*[aeiou][^aeiouwxy]$/.test(stem)
}

/** The word and the simple forms it may come from: walked, walks, walking → walk; boxes → box; cities → city. */
export function formsOf(word: string): string[] {
  const w = word.toLowerCase()
  const forms = [w]
  const add = (form: string) => {
    if (form.length >= 3 && !forms.includes(form)) forms.push(form)
  }
  if (w.endsWith('ies') || w.endsWith('ied')) add(`${w.slice(0, -3)}y`)
  if (w.endsWith('es')) add(w.slice(0, -2))
  if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1))
  for (const ending of ['ed', 'ing']) {
    if (!w.endsWith(ending)) continue
    const stem = w.slice(0, -ending.length)
    if (stem.length < 3) continue
    if (!doublesBeforeEnding(stem)) add(stem)
    add(`${stem}e`)
    if (stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1))
  }
  return forms
}

/**
 * Words that come back within REPEAT_WINDOW words, in text order. Filler words, short words and every
 * word of the given names (wiki names and aliases, exact spelling) are never marked.
 */
export function findRepeats(text: string, names: readonly string[]): Repeat[] {
  const nameWords = new Set<string>()
  for (const name of names) {
    for (const match of name.matchAll(WORD)) {
      const word = bare(match[0])
      if (word) nameWords.add(word)
    }
  }

  const places: { from: number; to: number }[] = []
  const marked: boolean[] = []
  const parent: number[] = []
  const root = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]]
      index = parent[index]
    }
    return index
  }
  // For every form, its latest place: a word only needs to look back at the latest one of each of its
  // forms, because a chain of the same word within the window links everything in between.
  const latest = new Map<string, { number: number; place: number }>()

  let number = -1
  for (const match of text.matchAll(WORD)) {
    number++
    const word = bare(match[0])
    if (!word || word.length < 3 || FILLER.has(word.toLowerCase()) || nameWords.has(word)) continue
    const place = places.length
    places.push({ from: match.index, to: match.index + word.length })
    marked.push(false)
    parent.push(place)
    for (const form of formsOf(word)) {
      const last = latest.get(form)
      if (last && number - last.number <= REPEAT_WINDOW) {
        marked[place] = true
        marked[last.place] = true
        parent[root(place)] = root(last.place)
      }
      latest.set(form, { number, place })
    }
  }

  return places.flatMap((place, index) => (marked[index] ? [{ ...place, group: root(index) }] : []))
}
