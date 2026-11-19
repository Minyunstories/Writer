import { ChangeSet, Text } from '@codemirror/state'
import { expect, test } from 'vitest'
import { minimalChanges } from './minimalChanges'

const apply = (before: string, after: string) => {
  const changes = minimalChanges(before, after)
  const doc = Text.of(before.split('\n'))
  return { result: ChangeSet.of(changes, doc.length).apply(doc).toString(), changes }
}

test('nothing changed, nothing to do', () => {
  expect(minimalChanges('same', 'same')).toEqual([])
})

test('text added at the end is one insertion there', () => {
  const before = 'Mira closed the door.'
  const after = `${before}\n\n## Der Winter\n\nSnow came early.`
  const { result, changes } = apply(before, after)
  expect(result).toBe(after)
  expect(changes).toEqual([{ from: before.length, to: before.length, insert: '\n\n## Der Winter\n\nSnow came early.' }])
})

test('a name replaced in several places changes only those places', () => {
  const before = 'Mira smiled. Lea waited. Then Mira left.'
  const after = 'Mirabel smiled. Lea waited. Then Mirabel left.'
  const { result, changes } = apply(before, after)
  expect(result).toBe(after)
  expect(changes.length).toBe(2)
})

test('very different texts become one replacement, and still the right text', () => {
  const before = 'a'.repeat(5000)
  const after = 'b'.repeat(5000)
  const { result, changes } = apply(before, after)
  expect(result).toBe(after)
  expect(changes.length).toBe(1)
})

test('shorter and longer texts, deletions and insertions mixed', () => {
  for (const [before, after] of [
    ['Hello world', 'Hello'],
    ['Hello', 'Hello world'],
    ['abc', ''],
    ['', 'abc'],
    ['The cat sat.', 'The dog sat down.'],
  ]) {
    expect(apply(before, after).result).toBe(after)
  }
})
