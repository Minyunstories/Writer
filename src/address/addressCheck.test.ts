import { describe, expect, test } from 'vitest'
import type { BookAddress, WikiEntry } from '../types'
import { checkAddress, dialogueRanges } from './addressCheck'

const entry = (id: string, name: string): WikiEntry => ({
  id,
  bookId: 'b',
  folderId: 'chars',
  name,
  aliases: [],
  properties: [],
  imageIds: [],
  body: '',
  autoLink: true,
  createdAt: 0,
  updatedAt: 0,
})

const ida = entry('ida', 'Ida')
const tom = entry('tom', 'Tom Hale')
const mira = entry('mira', 'Mira Hale')
const pascal = entry('pascal', 'Pascal Berg')
const lea = entry('lea', 'Lea Brandt')
const nora = entry('nora', 'Nora Lind')
const ella = entry('ella', 'Ella Berg')
const ben = entry('ben', 'Ben Kranz')
const olaf = entry('olaf', 'Olaf Stein')
const figures = [ida, tom, mira, pascal, lea, nora, ella, ben, olaf]

const address: BookAddress = {
  ranks: [
    { id: 'king', name: 'King', public: 'Your Majesty / Sire', updatedAt: 1 },
    { id: 'duke', name: 'Duke', public: 'Your Grace / Lord {Nachname}', updatedAt: 1 },
    { id: 'duchess', name: 'Duchess', public: 'Your Grace / Lady {Nachname}', updatedAt: 1 },
    { id: 'knight', name: 'Knight', public: 'Sir {Vorname}', updatedAt: 1 },
    { id: 'warden', name: 'Warden', public: 'Warden {Nachname}', updatedAt: 1 },
    { id: 'clerk', name: 'Clerk', public: 'Mr {Nachname}', updatedAt: 1 },
    { id: 'lord', name: 'Landed knight', public: 'Sir {Vorname} of {Nachname}', updatedAt: 1 },
    { id: 'daughter', name: "Baron's daughter", public: 'Miss {Nachname}', note: "Staff: 'Miss {Vorname}'", updatedAt: 1 },
  ],
  people: [
    { entryId: 'ida', rankId: 'king', changes: [], updatedAt: 1 },
    { entryId: 'tom', rankId: 'duke', changes: [], updatedAt: 1 },
    { entryId: 'mira', rankId: 'duchess', changes: [], updatedAt: 1 },
    { entryId: 'pascal', rankId: 'knight', changes: [], updatedAt: 1 },
    { entryId: 'lea', rankId: 'daughter', changes: [], updatedAt: 1 },
    { entryId: 'ben', rankId: 'clerk', changes: [], updatedAt: 1 },
    { entryId: 'olaf', rankId: 'lord', changes: [], updatedAt: 1 },
  ],
  forms: [
    { id: 'f1', from: 'tom', to: 'mira', private: 'Mira', changes: [], createdAt: 1, updatedAt: 1 },
    { id: 'f2', from: 'tom', to: 'lea', changes: [{ id: 'c1', label: 'Later', public: 'Lady Lea' }], createdAt: 1, updatedAt: 1 },
    { id: 'f3', from: 'ida', to: 'tom', note: "Possibly 'Old friend' in private", changes: [], createdAt: 1, updatedAt: 1 },
    { id: 'f4', from: 'ida', to: 'lea', private: 'Lea / my child', changes: [], createdAt: 1, updatedAt: 1 },
  ],
}

const run = (text: string, present: string[] = figures.map((figure) => figure.id)) =>
  checkAddress(text, { address, figures, present, chapterOrder: ['c1', 'c2'], chapterId: 'c1' })
const marked = (text: string, present?: string[]) => run(text, present).map((finding) => finding.text)

describe('dialogueRanges', () => {
  test('finds speech in typographic and straight quotes; apostrophes open nothing', () => {
    const text = 'She said, “It’s fine, Ma’am.” Then "Go," he said. Don\'t.'
    expect(dialogueRanges(text).map(({ from, to }) => text.slice(from, to))).toEqual(['It’s fine, Ma’am.', 'Go,'])
  })

  test('speech without a closing mark ends with its paragraph', () => {
    const text = '“First part\nNarration here.\n“Second.”'
    expect(dialogueRanges(text).map(({ from, to }) => text.slice(from, to))).toEqual(['First part', 'Second.'])
  })
})

describe('checkAddress with a name', () => {
  test('a form that fits nobody of that name is marked, with the forms of this chapter', () => {
    const [finding] = run('“Good day, Lady Brandt,” he said.')
    expect(finding.text).toBe('Lady Brandt')
    expect(finding.message).toBe('Für Lea Brandt passt das hier nicht. In diesem Kapitel: Miss Brandt · Lea · my child')
    // Only forms with a title are offered: no bare name, no endearment.
    expect(finding.suggestions).toEqual(['Miss Brandt'])
  })

  test('forms of the rank, of exceptions, of open changes and quoted in notes all count; case does not matter', () => {
    expect(marked('“Miss Brandt. Sir Pascal. Lord Hale. Lady Hale. Miss Lea. Lady Lea. miss brandt.”')).toEqual([])
  })

  test('a shared surname is fine when the form fits one of them', () => {
    expect(marked('“Lady Hale!”')).toEqual([])
    const [finding] = run('“Miss Hale!”')
    expect(finding.message).toBe('Passt hier zu niemandem. In diesem Kapitel – Mira Hale: Your Grace · Lady Hale · Mira; Tom Hale: Your Grace · Lord Hale')
    expect(finding.suggestions).toEqual(['Lady Hale', 'Lord Hale', 'Your Grace'])
  })

  test('titles from the ranks are known too', () => {
    expect(marked('“Warden Brandt.”')).toEqual(['Warden Brandt'])
  })

  test('no mark for narration, for words that are no figure, or when nothing is known about a figure', () => {
    expect(marked('Lady Brandt walked in.')).toEqual([])
    expect(marked('“Lady Luck is with us.”')).toEqual([])
    expect(marked('“Lady Nora.”')).toEqual([])
  })

  test('no mark when the name could also mean a figure nothing is known about', () => {
    expect(marked('“Lady Berg.”')).toEqual([])
  })
})

describe('checkAddress without a name', () => {
  test('fine when someone in the chapter is addressed so', () => {
    expect(marked('“Your Grace,” said Lea.', ['tom', 'lea'])).toEqual([])
    expect(marked('“your majesty” — “Sire!”', ['ida'])).toEqual([])
  })

  test('marked when nobody in the chapter is; names who would be', () => {
    const [finding] = run('“Your Grace,” said Lea.', ['lea', 'pascal'])
    expect(finding.text).toBe('Your Grace')
    expect(finding.message).toBe('Im Kapitel wird niemand so angesprochen. So heißen: Mira Hale, Tom Hale (kommen im Kapitel nicht vor).')
    expect(finding.suggestions).toEqual([])
  })

  test('a form nobody in the book has', () => {
    expect(run('“Your Excellency.”', ['ida'])[0].message).toBe('Im Kapitel wird niemand so angesprochen.')
  })

  test('without address data nothing is marked', () => {
    expect(checkAddress('“Lady Brandt, Your Grace.”', { address: undefined, figures, present: ['lea'], chapterOrder: [], chapterId: null })).toEqual([])
  })
})

describe('checkAddress stays quiet where it cannot be sure (review findings)', () => {
  test('a title must be written as a title: verbs and common words are no address', () => {
    expect(marked('“I miss Tom so much. Yes, sir. Tom is outside. Find the prince. Pascal will wait. I am no lady. Brandt knows.”')).toEqual([])
    expect(marked('“WE MISS TOM!”')).toEqual([])
    expect(marked('“He has to sire an heir. Take my queen.”', ['lea'])).toEqual([])
  })

  test('a dot is part of Mr., Mrs. and Ms. only, and does not change the form', () => {
    expect(marked('“Mr. Kranz. Mr Kranz.”')).toEqual([])
    expect(marked('“Lady. Brandt.”')).toEqual([])
  })

  test('titles come from the start of a rank’s form only; a longer form counts from its beginning', () => {
    expect(marked('“He is a friend of Brandt’s. The lands of Hale are wide.”')).toEqual([])
    expect(marked('“Welcome, Sir Olaf of Stein. Sir Olaf!”')).toEqual([])
  })

  test('a figure named by its first or last name alone counts as in the chapter', () => {
    expect(marked('“Your Grace,” said the maid. Tom nodded.', [])).toEqual([])
  })

  test('a title before a name nothing is known about hides the honorific in it too', () => {
    expect(marked('“My Lady Berg, welcome. My Lady Rowena.”', ['lea'])).toEqual([])
  })
})
