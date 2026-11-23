import { expect, test } from 'vitest'
import { renameScene, splitScenes } from './scenes'

test('scene breaks split a chapter into scenes with their start, first words and length', () => {
  const text = 'The storm came.\nNobody slept.\n\n***\n\nMorning. The boats were gone.\n\n* * *\n\n'
  expect(splitScenes(text)).toEqual([
    { start: 0, from: 0, preview: 'The storm came.', words: 5 },
    { start: 31, from: 36, preview: 'Morning. The boats were gone.', words: 5 },
    { start: 67, from: 74, preview: '', words: 0 },
  ])
  expect(splitScenes('Just one scene.')).toEqual([{ start: 0, from: 0, preview: 'Just one scene.', words: 3 }])
})

test('long first lines are shortened, markup is left out', () => {
  expect(splitScenes('**Mira** watched the sea until the lamps went out and the harbour was dark and still.')[0].preview).toBe('Mira watched the sea until the lamps went out and…')
})

test('a name after the stars belongs to the scene that follows; its words are not counted', () => {
  const text = 'The storm came.\n\n*** Ankunft am Hafen\n\nMorning came.'
  expect(splitScenes(text)).toEqual([
    { start: 0, from: 0, preview: 'The storm came.', words: 3 },
    { start: 17, from: 39, preview: 'Morning came.', words: 2, name: 'Ankunft am Hafen' },
  ])
})

test('a named line before any text names the first scene and starts no empty one', () => {
  const text = '*** Abschied\n\nThe storm came.\n\n***\n\nMorning came.'
  expect(splitScenes(text)).toEqual([
    { start: 0, from: 14, preview: 'The storm came.', words: 3, name: 'Abschied' },
    { start: 31, from: 36, preview: 'Morning came.', words: 2 },
  ])
  expect(splitScenes('\n\n*** Abschied\n\nThe storm came.')).toEqual([{ start: 0, from: 16, preview: 'The storm came.', words: 3, name: 'Abschied' }])
  // Plain stars at the top stay what they were: an empty first scene.
  expect(splitScenes('***\n\nMorning came.').map((scene) => scene.preview)).toEqual(['', 'Morning came.'])
  // After text, a named line is a break.
  expect(splitScenes('Rain fell.\n*** Nacht\nMorning came.').map((scene) => [scene.preview, scene.name])).toEqual([
    ['Rain fell.', undefined],
    ['Morning came.', 'Nacht'],
  ])
})

const apply = (text: string, change: { from: number; to: number; insert: string } | null) =>
  change ? text.slice(0, change.from) + change.insert + text.slice(change.to) : null

test('naming a scene writes the name after its stars, as they were typed', () => {
  expect(apply('A.\n\n***\n\nB.', renameScene('A.\n\n***\n\nB.', 1, 'Ankunft'))).toBe('A.\n\n*** Ankunft\n\nB.')
  expect(apply('A.\n\n* * *\n\nB.', renameScene('A.\n\n* * *\n\nB.', 1, 'Ankunft'))).toBe('A.\n\n* * * Ankunft\n\nB.')
  expect(apply('A.\n\n*** Alt\n\nB.', renameScene('A.\n\n*** Alt\n\nB.', 1, '  Neu\nZeile '))).toBe('A.\n\n*** Neu Zeile\n\nB.')
  expect(apply('A.\n\n*** Alt\n\nB.', renameScene('A.\n\n*** Alt\n\nB.', 1, '  '))).toBe('A.\n\n***\n\nB.')
})

test('the first scene gets its name in a line at the top, and loses it again with that line', () => {
  const text = 'A.\n\n***\n\nB.'
  const named = apply(text, renameScene(text, 0, 'Abschied'))!
  expect(named).toBe('*** Abschied\n\nA.\n\n***\n\nB.')
  expect(splitScenes(named)[0].name).toBe('Abschied')
  expect(apply(named, renameScene(named, 0, 'Neu'))).toBe('*** Neu\n\nA.\n\n***\n\nB.')
  expect(apply(named, renameScene(named, 0, ''))).toBe(text)
  expect(apply('\n\nA.\n***\nB.', renameScene('\n\nA.\n***\nB.', 0, 'Abschied'))).toBe('\n\n*** Abschied\n\nA.\n***\nB.')
  // An empty first scene: the name goes above the break.
  expect(apply('***\n\nB.', renameScene('***\n\nB.', 0, 'Leer'))).toBe('*** Leer\n\n***\n\nB.')
})

test('nothing changes when there is nothing to change or the name would not survive', () => {
  expect(renameScene('A.\n\n***\n\nB.', 0, '')).toBeNull()
  expect(renameScene('A.\n\n*** Alt\n\nB.', 1, 'Alt')).toBeNull()
  expect(renameScene('A.\n\n***\n\nB.', 2, 'Zu weit')).toBeNull()
  expect(renameScene('A.\n\n***\n\nB.', -1, 'Zu weit')).toBeNull()
  expect(renameScene('A.\n\n***\n\nB.', 1, '* * *')).toBeNull()
})

test('each scene knows where it starts, with its break or name line', () => {
  expect(splitScenes('*** Abschied\n\nRain fell.\n\n*** Nacht\n\nThe storm came.').map((scene) => scene.start)).toEqual([0, 26])
})

test('taking the name from an empty first scene lets it go; the named scene below keeps its name', () => {
  const text = '*** Eins\n\n*** Zwei\n\nRain fell.'
  const changed = apply(text, renameScene(text, 0, ''))!
  expect(changed).toBe('*** Zwei\n\nRain fell.')
  expect(splitScenes(changed).map((scene) => [scene.name, scene.preview])).toEqual([['Zwei', 'Rain fell.']])
})

test('stars at the start of a new name are left out (they would read as part of the break)', () => {
  expect(apply('A.\n\n***\n\nB.', renameScene('A.\n\n***\n\nB.', 1, '* Nachts'))).toBe('A.\n\n*** Nachts\n\nB.')
  expect(apply('A.\n\n***\n\nB.', renameScene('A.\n\n***\n\nB.', 1, '*Nachts*'))).toBe('A.\n\n*** *Nachts*\n\nB.')
})
