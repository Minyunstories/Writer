import { expect, test } from 'vitest'
import { maskSceneNames, parseSceneBreak } from './sceneBreak'

test('a line of stars is a scene break, with or without a name after a space', () => {
  expect(parseSceneBreak('***')).toEqual({ stars: '***' })
  expect(parseSceneBreak(' * * * ')).toEqual({ stars: '* * *' })
  expect(parseSceneBreak('****')).toEqual({ stars: '****' })
  expect(parseSceneBreak('*** Ankunft am Hafen')).toEqual({ stars: '***', name: 'Ankunft am Hafen' })
  expect(parseSceneBreak('* * *   Der Brief  ')).toEqual({ stars: '* * *', name: 'Der Brief' })
  expect(parseSceneBreak('*** *Nachts*')).toEqual({ stars: '***', name: '*Nachts*' })
  expect(parseSceneBreak('***   ')).toEqual({ stars: '***' })
})

test('bold and italic text, lists and stars inside a sentence are no scene breaks', () => {
  for (const line of ['***Wow!*** she said.', '**', '** Zwei', 'Text *** im Satz', '* Punkt', '', '   ']) {
    expect(parseSceneBreak(line)).toBeNull()
  }
})

test('masking keeps every position and blanks only the names', () => {
  const text = 'The storm came.\n\n*** Ankunft\n\nRain fell.\n***\n'
  const masked = maskSceneNames(text)
  expect(masked).toHaveLength(text.length)
  expect(masked).toBe('The storm came.\n\n***        \n\nRain fell.\n***\n')
  expect(maskSceneNames('Rain fell.')).toBe('Rain fell.')
})

test('stars with non-breaking spaces between them (pasted text) are breaks too', () => {
  expect(parseSceneBreak('* * *')).toEqual({ stars: '* * *' })
  expect(parseSceneBreak('* * * Ankunft')).toEqual({ stars: '* * *', name: 'Ankunft' })
})

test('long lines of spaces never make the check slow', () => {
  const started = performance.now()
  parseSceneBreak(`*** ${' \t'.repeat(2000)} x`)
  parseSceneBreak(`***${' '.repeat(2000)}\r${' '.repeat(2000)}x`)
  expect(performance.now() - started).toBeLessThan(200)
})
