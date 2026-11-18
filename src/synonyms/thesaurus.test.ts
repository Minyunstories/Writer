import { expect, test } from 'vitest'
// @ts-expect-error plain build script without types
import { parseData } from '../../scripts/thesaurus.mjs'
import { baseForms, matchCase, synonymGroups, type Thesaurus } from './thesaurus'

const sample = `  1 This software and database is being provided to you
00001740 00 a 03 able 0 capable 0 up_to(a) 0 000 | having the necessary means or skill; "able to swim"
00002098 00 a 01 unable 0 000 | not having the necessary means
00003000 00 s 02 quick 0 speedy 0 000 | accomplished rapidly; "a quick look"
`

test('the build script keeps meanings with more than one word', () => {
  expect(parseData(sample)).toEqual([
    ['a', 'having the necessary means or skill', 'able', 'capable', 'up to'],
    ['a', 'accomplished rapidly', 'quick', 'speedy'],
  ])
})

const thesaurus: Thesaurus = {
  s: [
    ['v', 'move fast', 'run', 'race', 'dash'],
    ['n', 'a score in baseball', 'run', 'tally'],
    ['a', 'accomplished rapidly', 'quick', 'speedy'],
  ],
  w: { run: [0, 1], race: [0], dash: [0], tally: [1], quick: [2], speedy: [2] },
}

test('synonyms come grouped by meaning, without the word itself', () => {
  expect(synonymGroups(thesaurus, 'run')).toEqual([
    { kind: 'Verb', meaning: 'move fast', words: ['race', 'dash'] },
    { kind: 'Nomen', meaning: 'a score in baseball', words: ['tally'] },
  ])
})

test('inflected words find their base form', () => {
  expect(baseForms('running')).toContain('run')
  expect(baseForms('Raced')).toContain('race')
  expect(synonymGroups(thesaurus, 'Running')[0].words).toEqual(['race', 'dash'])
  expect(synonymGroups(thesaurus, 'nonsense')).toEqual([])
})

test('a replacement keeps the capital letter of the word it replaces', () => {
  expect(matchCase('Quick', 'speedy')).toBe('Speedy')
  expect(matchCase('quick', 'speedy')).toBe('speedy')
  expect(matchCase('QUICK', 'speedy')).toBe('SPEEDY')
})

test('words that are also names of built-in things are looked up safely', () => {
  expect(synonymGroups(thesaurus, 'constructor')).toEqual([])
})
