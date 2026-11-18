/** WordNet synonyms: meanings as [pos, meaning, ...words], and each word's meanings. */
export interface Thesaurus {
  s: string[][]
  w: Record<string, number[]>
}

export interface SynonymGroup {
  kind: string
  meaning: string
  words: string[]
}

const KINDS: Record<string, string> = { n: 'Nomen', v: 'Verb', a: 'Adjektiv', r: 'Adverb' }

/** The word and the forms it may come from: "running" → run, "raced" → race, "cities" → city. */
export function baseForms(word: string): string[] {
  const w = word.toLowerCase()
  const forms = [w]
  const add = (form: string) => {
    if (form.length > 1 && !forms.includes(form)) forms.push(form)
  }
  if (w.endsWith('ies')) add(`${w.slice(0, -3)}y`)
  if (w.endsWith('ied')) add(`${w.slice(0, -3)}y`)
  if (w.endsWith('es')) add(w.slice(0, -2))
  if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1))
  for (const ending of ['ing', 'ed', 'er', 'est']) {
    if (!w.endsWith(ending)) continue
    const stem = w.slice(0, -ending.length)
    add(stem)
    add(`${stem}e`)
    if (stem.length > 2 && stem.at(-1) === stem.at(-2)) add(stem.slice(0, -1))
  }
  if (w.endsWith('ly')) add(w.slice(0, -2))
  return forms
}

export function synonymGroups(thesaurus: Thesaurus, word: string): SynonymGroup[] {
  const groups: SynonymGroup[] = []
  const seen = new Set<number>()
  for (const form of baseForms(word)) {
    for (const index of Object.hasOwn(thesaurus.w, form) ? thesaurus.w[form] : []) {
      if (seen.has(index)) continue
      seen.add(index)
      const [pos, meaning, ...words] = thesaurus.s[index]
      const others = words.filter((other) => other.toLowerCase() !== form)
      if (others.length > 0) groups.push({ kind: KINDS[pos] ?? pos, meaning, words: others })
    }
  }
  return groups
}

/** "Quick" → "Speedy", "QUICK" → "SPEEDY". */
export function matchCase(original: string, replacement: string): string {
  if (original.length > 1 && original === original.toUpperCase() && original !== original.toLowerCase())
    return replacement.toUpperCase()
  if (original[0] && original[0] !== original[0].toLowerCase())
    return replacement[0].toUpperCase() + replacement.slice(1)
  return replacement
}

let loading: Promise<Thesaurus> | null = null

/** Loaded on first use only (several MB), then kept. */
export function loadThesaurus(): Promise<Thesaurus> {
  loading ??= fetch(new URL('thesaurus.json', document.baseURI)).then((response) => {
    if (!response.ok) throw new Error('Synonyme konnten nicht geladen werden.')
    return response.json() as Promise<Thesaurus>
  })
  loading.catch(() => {
    loading = null
  })
  return loading
}
