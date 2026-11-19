import type { BookAddress, WikiEntry } from '../types'
import { fill, personAt, resolveAddress } from './resolve'

/**
 * A cautious check of forms of address in dialogue. The app cannot tell who speaks to whom, so a form counts
 * as right when it fits anybody in the chapter, from anybody, publicly or privately, before or after an open
 * change. Only what surely fits nobody is marked.
 */
export interface AddressFinding {
  from: number
  to: number
  text: string
  message: string
  /** Forms to put in instead, titled ones with the same name first. */
  suggestions: string[]
}

export interface AddressCheckContext {
  address: BookAddress | undefined
  figures: WikiEntry[]
  /** Figures named in the chapter (entry ids). */
  present: string[]
  chapterOrder: string[]
  chapterId: string | null
}

// Opening marks: English and German opening quotes and the straight double quote (escaped on purpose).
const OPEN = new Set(['\u201C', '\u201E', '\u0022'])

/** The stretches of direct speech: between quotation marks, or up to the end of the paragraph. */
export function dialogueRanges(text: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = []
  let start = -1
  let opener = ''
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '\n') {
      if (start >= 0 && index > start) ranges.push({ from: start, to: index })
      start = -1
      continue
    }
    if (start < 0) {
      if (OPEN.has(char)) {
        start = index + 1
        opener = char
      }
      continue
    }
    const closes = char === '”' || (char === '"' && opener === '"') || (char === '“' && opener === '„')
    if (closes) {
      if (index > start) ranges.push({ from: start, to: index })
      start = -1
    }
  }
  if (start >= 0 && text.length > start) ranges.push({ from: start, to: text.length })
  return ranges
}

// Titles are matched as written ("Lady", not "lady"): a verb ("I miss Tom") or a common word stays out.
const TITLES = ['High Mage', 'Mage', 'Sir', 'Lady', 'Lord', 'Miss', 'Mistress', 'Master', 'Mister', 'Madam', 'Dame', 'Prince', 'Princess']
/** Abbreviations that may carry a dot. */
const ABBREVIATIONS = ['Mrs', 'Mr', 'Ms']
const HONORIFICS = [
  'Your Royal Highness',
  'Your Highness',
  'Your Majesty',
  'Your Grace',
  'Your Excellency',
  'Your Lordship',
  'Your Ladyship',
  'Sire',
  'My Lord',
  'My Lady',
  'My Liege',
  "Ma'am",
  'Madam',
  'My King',
  'My Queen',
  'My Prince',
  'My Princess',
]

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** For comparing: no case, no dots (Mr. = Mr), one kind of apostrophe, single spaces. */
const normal = (text: string) => text.replace(/’/g, "'").replace(/\./g, '').replace(/\s+/g, ' ').trim().toLowerCase()
const byLength = (a: string, b: string) => b.length - a.length

/** Alternatives of a form ("Your Grace / Lady {Nachname}" → two), filled for the figure. */
const alternatives = (text: string | undefined, person: { first: string; last: string }) =>
  text ? fill(text, person).split('/').map((part) => part.trim()).filter(Boolean) : []

/** Forms named in a note in single or double quotation marks ('Lady Lea'). */
function quoted(note: string, person: { first: string; last: string }): string[] {
  const found: string[] = []
  for (const match of fill(note, person).matchAll(/(?:^|[\s(/:,–-])['‘"“]([^'’"”]+?)['’"”](?=$|[\s.,;:)/!?–-])/g)) found.push(match[1].trim())
  return found
}

interface Known {
  /** Everything that counts as right (normalised). */
  valid: string[]
  /** What this chapter's forms are, to show. */
  shown: string[]
  first: string
  last: string
}

/** A phrase fits when a valid form is the phrase or begins with it ("Sir Olaf" of "Sir Olaf of Stein"). */
const fitsIn = (valid: string[], phrase: string) => valid.some((form) => form === phrase || form.startsWith(`${phrase} `))

export function checkAddress(text: string, context: AddressCheckContext): AddressFinding[] {
  const { address, figures, chapterOrder, chapterId } = context
  if (!address || (!address.ranks.length && !address.forms.length)) return []

  // Everything per figure once per run: names, who has a form towards whom.
  const byId = new Map(figures.map((figure) => [figure.id, figure]))
  const people = new Map(figures.map((figure) => [figure.id, personAt(address, figure, chapterOrder, chapterId)]))
  const speakersOf = new Map<string, Set<string>>()
  for (const form of address.forms) {
    if (!byId.has(form.from) || form.from === form.to) continue
    const set = speakersOf.get(form.to) ?? new Set<string>()
    set.add(form.from)
    speakersOf.set(form.to, set)
  }
  const byName = new Map<string, WikiEntry[]>()
  for (const figure of figures) {
    const { first, last } = people.get(figure.id)!
    for (const part of new Set([first, last].filter(Boolean).map(normal))) byName.set(part, [...(byName.get(part) ?? []), figure])
  }

  // In the chapter: named by the editor's matcher, or by first or last name as a capitalised word.
  const words = new Set([...text.matchAll(/\p{Lu}[\p{L}'’-]*/gu)].map((match) => normal(match[0].replace(/['’]s$/, ''))))
  const present = new Set(context.present)
  for (const figure of figures) {
    const { first, last } = people.get(figure.id)!
    if ([first, last].some((part) => part.length > 1 && words.has(normal(part)))) present.add(figure.id)
  }

  const cache = new Map<string, Known>()
  const known = (figure: WikiEntry): Known => {
    const cached = cache.get(figure.id)
    if (cached) return cached
    const person = people.get(figure.id)!
    const valid = new Set<string>()
    const shown: string[] = []
    const add = (forms: string[], show: boolean) => {
      for (const form of forms) {
        valid.add(normal(form))
        if (show && !shown.some((item) => normal(item) === normal(form))) shown.push(form)
      }
    }
    const speakers = speakersOf.get(figure.id) ?? new Set<string>()
    if (person.rank || speakers.size) {
      add(alternatives(person.rank?.public, person), true)
      add(alternatives(person.rank?.private, person), true)
      if (person.rank?.note) add(quoted(person.rank.note, person), false)
      for (const speakerId of speakers) {
        const resolved = resolveAddress(address, byId.get(speakerId)!, figure, chapterOrder, chapterId)
        add(alternatives(resolved.public, person), true)
        add(alternatives(resolved.private, person), true)
        for (const note of resolved.notes) add(quoted(note.text, person), false)
        for (const change of resolved.pending) {
          add([...alternatives(change.public, person), ...alternatives(change.private, person)], false)
          if (change.note) add(quoted(change.note, person), false)
        }
      }
    }
    const result = { valid: [...valid], shown, first: person.first, last: person.last }
    cache.set(figure.id, result)
    return result
  }

  // Titles before a name: the usual ones and what a rank's form starts with before its first placeholder.
  const titles = new Set(TITLES)
  for (const rank of address.ranks)
    for (const part of [rank.public, rank.private ?? ''].flatMap((form) => form.split('/'))) {
      const lead = /^\s*(\p{Lu}[\p{L}' ]*?)\s*\{(?:Vorname|Nachname)\}/u.exec(part)
      if (lead && !ABBREVIATIONS.includes(lead[1].replace(/\.$/, ''))) titles.add(lead[1].replace(/\.$/, ''))
    }
  const titleSource = [`(?:${ABBREVIATIONS.join('|')})\\.?`, ...[...titles].sort(byLength).map(escape)].join('|')
  const named = new RegExp(`(?<![\\p{L}])(?:${titleSource})\\s+(\\p{Lu}\\p{L}*(?:['’-]\\p{L}+)*)`, 'gu')
  const bare = new RegExp(`(?<![\\p{L}])(?:${HONORIFICS.sort(byLength).map((item) => escape(item).replace("'", "['’]")).join('|')})(?![\\p{L}])`, 'gu')

  const findings: AddressFinding[] = []
  for (const range of dialogueRanges(text)) {
    const speech = text.slice(range.from, range.to)
    const taken: [number, number][] = []

    for (const match of speech.matchAll(named)) {
      const word = match[1].replace(/['’]s$/, '')
      const phrase = match[0].slice(0, match[0].length - (match[1].length - word.length))
      const start = range.from + match.index!
      // Any title with a name: an honorific inside it ("My Lady Rowena") is not checked on its own.
      taken.push([start, start + phrase.length])
      const candidates = [...(byName.get(normal(word)) ?? [])].sort((a, b) => a.name.localeCompare(b.name))
      if (!candidates.length) continue
      const infos = candidates.map((figure) => ({ figure, info: known(figure) }))
      // Nothing known about one of them: it could be meant, so say nothing.
      if (infos.some(({ info }) => info.valid.length === 0)) continue
      if (infos.some(({ info }) => fitsIn(info.valid, normal(phrase)))) continue
      const message =
        infos.length === 1
          ? `Für ${infos[0].figure.name} passt das hier nicht. In diesem Kapitel: ${infos[0].info.shown.join(' · ')}`
          : `Passt hier zu niemandem. In diesem Kapitel – ${infos.map(({ figure, info }) => `${figure.name}: ${info.shown.join(' · ')}`).join('; ')}`
      // Offered instead: forms with a title – not a bare name, not an endearment ("my dear").
      const titled = infos.flatMap(({ info }) =>
        info.shown.filter((form) => /^\p{Lu}/u.test(form) && ![info.first, info.last].some((part) => normal(part) === normal(form))),
      )
      const unique = titled.filter((form, index) => titled.findIndex((other) => normal(other) === normal(form)) === index)
      const withName = (form: string) => normal(form).split(' ').includes(normal(word))
      findings.push({ from: start, to: start + phrase.length, text: phrase, message, suggestions: [...unique.filter(withName), ...unique.filter((form) => !withName(form))].slice(0, 4) })
    }

    for (const match of speech.matchAll(bare)) {
      const start = range.from + match.index!
      const end = start + match[0].length
      if (taken.some(([from, to]) => start < to && end > from)) continue
      const phrase = normal(match[0])
      const fits = (figure: WikiEntry) => fitsIn(known(figure).valid, phrase)
      if (figures.some((figure) => present.has(figure.id) && fits(figure))) continue
      const elsewhere = figures
        .filter((figure) => !present.has(figure.id) && fits(figure))
        .map((figure) => figure.name)
        .sort((a, b) => a.localeCompare(b))
      findings.push({
        from: start,
        to: end,
        text: match[0],
        message: `Im Kapitel wird niemand so angesprochen.${elsewhere.length ? ` So heißen: ${elsewhere.join(', ')} (kommen im Kapitel nicht vor).` : ''}`,
        suggestions: [],
      })
    }
  }
  return findings.sort((a, b) => a.from - b.from)
}
