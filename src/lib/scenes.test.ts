import { expect, test } from 'vitest'
import { splitScenes } from './scenes'

test('scene breaks split a chapter into scenes with their start, first words and length', () => {
  const text = 'The storm came.\nNobody slept.\n\n***\n\nMorning. The boats were gone.\n\n* * *\n\n'
  expect(splitScenes(text)).toEqual([
    { from: 0, preview: 'The storm came.', words: 5 },
    { from: 36, preview: 'Morning. The boats were gone.', words: 5 },
    { from: 74, preview: '', words: 0 },
  ])
  expect(splitScenes('Just one scene.')).toEqual([{ from: 0, preview: 'Just one scene.', words: 3 }])
})

test('long first lines are shortened, markup is left out', () => {
  expect(splitScenes('**Mira** watched the sea until the lamps went out and the harbour was dark and still.')[0].preview).toBe('Mira watched the sea until the lamps went out and…')
})
